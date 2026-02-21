/**
 * 백그라운드 작업 관리
 *
 * in-memory Map으로 Job을 관리한다. 서버 종료 시 모두 사라짐.
 */

import type { ChildProcess } from "node:child_process";
import type { Job, JobInfo, JobStatus, Provider } from "../lib/types.js";
import {
  MAX_STDOUT,
  MAX_STDERR,
  JOB_TTL_MS,
  JOB_GC_INTERVAL_MS,
} from "../lib/constants.js";

const jobs = new Map<string, Job>();

let idCounter = 0;

/** 짧은 ID 생성 */
function generateId(): string {
  idCounter++;
  return `job_${idCounter.toString(36).padStart(4, "0")}`;
}

/** 새 백그라운드 Job 생성 & stdout/stderr 수집 시작 */
export function createJob(
  provider: Provider,
  child: ChildProcess,
  meta: { prompt: string; model?: string },
): Job {
  const job: Job = {
    id: generateId(),
    provider,
    status: "running",
    pid: child.pid,
    prompt: meta.prompt.slice(0, 100),
    model: meta.model,
    startedAt: new Date(),
    stdout: "",
    stderr: "",
    childProcess: child,
  };

  // stdout/stderr 수집 (flag 패턴으로 endsWith 반복 호출 방지)
  let stdoutTruncated = false;
  let stderrTruncated = false;

  child.stdout?.on("data", (chunk: Buffer) => {
    if (!stdoutTruncated) {
      if (job.stdout.length < MAX_STDOUT) {
        job.stdout += chunk.toString();
      } else {
        job.stdout += "\n[truncated]";
        stdoutTruncated = true;
      }
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    if (!stderrTruncated) {
      if (job.stderr.length < MAX_STDERR) {
        job.stderr += chunk.toString();
      } else {
        job.stderr += "\n[stderr truncated]";
        stderrTruncated = true;
      }
    }
  });

  child.on("close", (code) => {
    job.exitCode = code;
    job.completedAt = new Date();
    // killed 상태는 killJob()에서 이미 설정됨 — close 이벤트에서 덮어쓰지 않음
    if (job.status !== "killed") {
      job.status = code === 0 ? "completed" : "failed";
    }
  });

  child.on("error", (err) => {
    job.error = err.message;
    job.completedAt = new Date();
    job.status = "failed";
  });

  jobs.set(job.id, job);
  return job;
}

/** Job → 직렬화 가능 정보 */
function toJobInfo(job: Job, includePreview = true): JobInfo {
  const info: JobInfo = {
    id: job.id,
    provider: job.provider,
    status: job.status,
    pid: job.pid,
    prompt: job.prompt,
    model: job.model,
    startedAt: job.startedAt.toISOString(),
    completedAt: job.completedAt?.toISOString(),
    exitCode: job.exitCode,
    error: job.error,
  };
  if (includePreview) {
    info.stdoutPreview = job.stdout.slice(0, 500);
  }
  return info;
}

/** Job 대기 (polling) */
export async function waitJob(
  jobId: string,
  timeoutMs: number = 300000,
): Promise<{ job: JobInfo; stdout: string; stderr: string } | null> {
  const job = jobs.get(jobId);
  if (!job) return null;

  if (job.status !== "running") {
    return { job: toJobInfo(job), stdout: job.stdout, stderr: job.stderr };
  }

  const deadline = Date.now() + timeoutMs;
  while (job.status === "running" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }

  if (job.status === "running") {
    // 타임아웃 — 프로세스는 그대로 두되 알림
    return {
      job: {
        ...toJobInfo(job),
        error: `wait timeout after ${timeoutMs}ms (job still running)`,
      },
      stdout: job.stdout,
      stderr: job.stderr,
    };
  }

  return { job: toJobInfo(job), stdout: job.stdout, stderr: job.stderr };
}

/** Job 상태 확인 (논블로킹) */
export function checkJob(jobId: string): JobInfo | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  return toJobInfo(job);
}

/** Job 종료 */
export async function killJob(jobId: string): Promise<JobInfo | null> {
  const job = jobs.get(jobId);
  if (!job) return null;

  if (job.status === "running" && job.childProcess) {
    if (process.platform === "win32") {
      // Windows: 프로세스 트리 강제 종료
      const { execSync } = await import("node:child_process");
      try {
        execSync(`taskkill /PID ${job.childProcess.pid} /T /F`, {
          stdio: "ignore",
        });
      } catch {
        // 이미 종료된 프로세스
      }
    } else {
      job.childProcess.kill("SIGTERM");
      const killTimer = setTimeout(() => {
        if (!job.childProcess!.killed && job.childProcess!.exitCode === null) {
          job.childProcess!.kill("SIGKILL");
        }
      }, 3000);
      killTimer.unref(); // 서버 종료 방해 안 하도록
    }
    job.status = "killed";
    job.completedAt = new Date();
  }

  return toJobInfo(job);
}

/** Job 목록 */
export function listJobs(
  statusFilter: "active" | "completed" | "failed" | "all" = "all",
  limit: number = 20,
): JobInfo[] {
  let result = Array.from(jobs.values());

  if (statusFilter !== "all") {
    if (statusFilter === "active") {
      result = result.filter((j) => j.status === "running");
    } else if (statusFilter === "completed") {
      result = result.filter((j) => j.status === "completed");
    } else if (statusFilter === "failed") {
      result = result.filter(
        (j) => j.status === "failed" || j.status === "killed",
      );
    }
  }

  // 최신 순 정렬
  result.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  return result.slice(0, limit).map((j) => toJobInfo(j, false));
}

// --- Job GC: 완료된 Job을 TTL 후 자동 정리 ---

const gcTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (
      job.status !== "running" &&
      job.completedAt &&
      now - job.completedAt.getTime() > JOB_TTL_MS
    ) {
      jobs.delete(id);
    }
  }
}, JOB_GC_INTERVAL_MS);

// 타이머가 프로세스 종료를 막지 않도록 unref
gcTimer.unref();
