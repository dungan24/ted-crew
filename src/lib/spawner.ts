import { spawn, execSync, type ChildProcess } from "node:child_process";
import type { Provider, SpawnOptions, SpawnResult } from "./types.js";
import { MAX_STDOUT, MAX_STDERR, DEFAULT_TIMEOUT } from "./constants.js";

/** 활성 프로세스 추적 (서버 종료 시 정리용) */
const activeProcesses = new Set<ChildProcess>();

/** 프로세스 정리 — SIGTERM → 3초 후 SIGKILL */
function killProcess(child: ChildProcess): void {
  if (child.killed || child.exitCode !== null) return;
  if (process.platform === "win32") {
    // Windows: 프로세스 트리 강제 종료
    try {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" });
    } catch {
      // 이미 종료된 프로세스
    }
  } else {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed && child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 3000);
  }
}

/** 서버 종료 시 모든 자식 프로세스 정리 */
export function killAllProcesses(): void {
  for (const child of activeProcesses) {
    killProcess(child);
  }
  activeProcesses.clear();
}

/** CLI 명령어 구성 */
function buildCommand(provider: Provider): { cmd: string; baseArgs: string[] } {
  if (process.platform === "win32") {
    // Claude CLI는 네이티브 설치 — .cmd 래퍼 없이 직접 실행
    if (provider === "claude") {
      return { cmd: "claude", baseArgs: [] };
    }
    // npm 글로벌 패키지는 cmd /c xxx.cmd 패턴 (_wrap_cmd 래핑과 동일)
    return {
      cmd: "cmd",
      baseArgs: ["/c", `${provider}.cmd`],
    };
  }
  // macOS/Linux: 직접 실행
  return { cmd: provider, baseArgs: [] };
}

/** CLI 스폰 (포그라운드 — 완료까지 대기) */
export function spawnForeground(
  provider: Provider,
  args: string[],
  options: SpawnOptions = {},
): Promise<SpawnResult> {
  const { cmd, baseArgs } = buildCommand(provider);
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;

  return new Promise((resolve, reject) => {
    const stdinMode = options.stdinData
      ? ("pipe" as const)
      : ("ignore" as const);

    const child = spawn(cmd, [...baseArgs, ...args], {
      cwd: options.cwd,
      env: { ...process.env, MSYS_NO_PATHCONV: "1", ...options.env },
      shell: false,
      stdio: [stdinMode, "pipe", "pipe"],
      windowsHide: true,
    });

    if (options.stdinData && child.stdin) {
      child.stdin.on("error", () => {}); // EPIPE 무시
      child.stdin.end(options.stdinData);
    }

    activeProcesses.add(child);

    let stdout = "";
    let stderr = "";
    let settled = false;
    let stdoutTruncated = false;
    let stderrTruncated = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      if (!stdoutTruncated) {
        if (stdout.length < MAX_STDOUT) {
          stdout += chunk.toString();
        } else {
          stdout += "\n[truncated]";
          stdoutTruncated = true;
        }
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (!stderrTruncated) {
        if (stderr.length < MAX_STDERR) {
          stderr += chunk.toString();
        } else {
          stderr += "\n[stderr truncated]";
          stderrTruncated = true;
        }
      }
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        killProcess(child);
        activeProcesses.delete(child);
        resolve({
          stdout,
          stderr: stderr + "\n[timeout after " + timeout + "ms]",
          exitCode: null,
        });
      }
    }, timeout);

    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        activeProcesses.delete(child);
        resolve({ stdout, stderr, exitCode: code });
      }
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        activeProcesses.delete(child);
        reject(err);
      }
    });
  });
}

/** CLI 스폰 (백그라운드 — ChildProcess 반환, stdout/stderr 이벤트 외부 관리) */
export function spawnBackground(
  provider: Provider,
  args: string[],
  options: SpawnOptions = {},
): ChildProcess {
  const { cmd, baseArgs } = buildCommand(provider);

  const stdinMode = options.stdinData ? ("pipe" as const) : ("ignore" as const);

  const child = spawn(cmd, [...baseArgs, ...args], {
    cwd: options.cwd,
    env: { ...process.env, MSYS_NO_PATHCONV: "1", ...options.env },
    shell: false,
    stdio: [stdinMode, "pipe", "pipe"],
    windowsHide: true,
    detached: false,
  });

  if (options.stdinData && child.stdin) {
    child.stdin.on("error", () => {}); // EPIPE 무시
    child.stdin.end(options.stdinData);
  }

  activeProcesses.add(child);

  child.on("close", () => {
    activeProcesses.delete(child);
  });

  child.on("error", () => {
    activeProcesses.delete(child);
  });

  return child;
}
