import type { ChildProcess } from "node:child_process";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export type ApprovalMode = "yolo" | "auto_edit" | "plan";

// --- Tool Inputs ---

export interface AskGeminiInput {
  prompt: string;
  model?: string;
  files?: string[];
  directories?: string[];
  output_file?: string;
  working_directory?: string;
  background?: boolean;
  approval_mode?: ApprovalMode;
}

export interface AskCodexInput {
  prompt: string;
  model?: string;
  reasoning_effort?: ReasoningEffort;
  files?: string[];
  output_file?: string;
  working_directory?: string;
  background?: boolean;
  writable?: boolean;
  /** 포그라운드 타임아웃 (ms). 느린 모델(gpt-5.2 + xhigh) 사용 시 늘릴 것 */
  timeout_ms?: number;
}

export interface AskClaudeInput {
  prompt: string;
  model?: string;
  files?: string[];
  output_file?: string;
  working_directory?: string;
  background?: boolean;
  allowed_tools?: string[];
}

// --- Spawner ---

export type Provider = "gemini" | "codex" | "claude";

export interface SpawnOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
  stdinData?: string;
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

// --- Jobs ---

export type JobStatus = "running" | "completed" | "failed" | "killed";

export interface Job {
  id: string;
  provider: Provider;
  status: JobStatus;
  pid: number | undefined;
  prompt: string;
  model?: string;
  startedAt: Date;
  completedAt?: Date;
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  error?: string;
  childProcess: ChildProcess;
}

/** Job 정보에서 직렬화 불가 필드 제거 (MCP 응답용) */
export interface JobInfo {
  id: string;
  provider: Provider;
  status: JobStatus;
  pid: number | undefined;
  prompt: string;
  model?: string;
  startedAt: string;
  completedAt?: string;
  exitCode?: number | null;
  error?: string;
  /** stdout 앞 500자만 포함 (check_job에서 미리보기용) */
  stdoutPreview?: string;
}
