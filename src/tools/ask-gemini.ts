/**
 * ask_gemini — Gemini CLI 호출 도구
 *
 * Gemini CLI를 통해 작업을 위임한다.
 * 1M 토큰 컨텍스트, 디자인/작문/웹리서치에 최적화.
 */

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { AskGeminiInput } from "../lib/types.js";
import { detectRateLimit, detectModelError } from "../lib/parser.js";
import { processResponse } from "../lib/exchange.js";
import { spawnForeground, spawnBackground } from "../lib/spawner.js";
import {
  wrapPromptForFileOutput,
  buildPromptWithFiles,
} from "../lib/prompt-builder.js";
import { createJob } from "./jobs.js";

/** approval_mode → CLI 플래그 */
function approvalFlag(mode?: string): string[] {
  // --approval-mode 통일 형식 (--yolo 단축 플래그는 관리자 설정으로 차단될 수 있음)
  const m = mode || "auto_edit";
  return ["--approval-mode", m];
}

export async function handleAskGemini(input: AskGeminiInput): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  let fullPrompt = buildPromptWithFiles(input.prompt, input.files);
  const agentCanWrite =
    !input.approval_mode ||
    input.approval_mode === "yolo" ||
    input.approval_mode === "auto_edit";
  if (input.output_file) {
    fullPrompt = wrapPromptForFileOutput(
      fullPrompt,
      input.output_file,
      agentCanWrite,
    );
  }

  // CLI 인자 구성: -p "" 로 headless 트리거, 실제 프롬프트는 stdin으로 전달
  const args: string[] = [...approvalFlag(input.approval_mode), "-p", ""];

  if (input.model) {
    args.push("-m", input.model);
  }

  if (input.directories && input.directories.length > 0) {
    for (const dir of input.directories) {
      args.push("--include-directories", resolve(dir));
    }
  }

  const cwd = input.working_directory
    ? resolve(input.working_directory)
    : undefined;

  // output_file 실행 전 mtime 기록 (에이전트 직접 쓰기 감지용)
  let outputFileMtimeBefore = 0;
  if (input.output_file) {
    try {
      const p = resolve(input.output_file);
      if (existsSync(p)) {
        outputFileMtimeBefore = statSync(p).mtimeMs;
      }
    } catch {
      // 무시
    }
  }

  // --- 백그라운드 모드 ---
  if (input.background) {
    try {
      const child = spawnBackground("gemini", args, {
        cwd,
        stdinData: fullPrompt,
      });
      const job = createJob("gemini", child, {
        prompt: input.prompt,
        model: input.model,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "background_started",
                job_id: job.id,
                provider: "gemini",
                message: `Gemini 작업이 백그라운드로 시작됨. check_job('${job.id}') 또는 wait_job('${job.id}')로 결과 확인.`,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Gemini CLI 스폰 실패: ${(err as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }

  // --- 포그라운드 모드 ---
  try {
    const result = await spawnForeground("gemini", args, {
      cwd,
      stdinData: fullPrompt,
    });

    // 에러 감지
    if (detectRateLimit(result.stdout, result.stderr)) {
      return {
        content: [
          {
            type: "text",
            text: `Gemini rate limit 감지. 잠시 후 재시도하세요.\n\nstderr: ${result.stderr}`,
          },
        ],
        isError: true,
      };
    }

    if (detectModelError(result.stdout, result.stderr)) {
      return {
        content: [
          {
            type: "text",
            text: `Gemini 모델 에러: ${result.stderr || result.stdout}`,
          },
        ],
        isError: true,
      };
    }

    if (result.exitCode !== 0 && result.exitCode !== null) {
      return {
        content: [
          {
            type: "text",
            text: `Gemini CLI 에러 (exit ${result.exitCode}):\n${result.stderr || result.stdout}`,
          },
        ],
        isError: true,
      };
    }

    // 응답 파싱: -o json 제거했으므로 plain text로 처리
    const response = result.stdout.trim();

    if (!response) {
      return {
        content: [
          {
            type: "text",
            text: `Gemini 응답이 비어있습니다.\nstdout: ${result.stdout.slice(0, 500)}\nstderr: ${result.stderr.slice(0, 500)}`,
          },
        ],
        isError: true,
      };
    }

    // 응답 처리 (자동 파일 저장 or 직접 반환)
    const exchanged = processResponse(response, "gemini", {
      outputFile: input.output_file,
      workingDirectory: input.working_directory,
      outputFileMtimeBefore,
    });

    return { content: [{ type: "text", text: exchanged.text }] };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      // ENOENT: CLI 미설치 또는 잘못된 cwd 구분
      const isCwd = cwd && !existsSync(cwd);
      const msg = isCwd
        ? `작업 디렉토리가 존재하지 않습니다: ${cwd}`
        : "Gemini CLI가 설치되지 않았습니다. `npm install -g @google/gemini-cli` 로 설치하세요.";
      return {
        content: [{ type: "text", text: msg }],
        isError: true,
      };
    }
    return {
      content: [
        { type: "text", text: `Gemini CLI 실행 실패: ${error.message}` },
      ],
      isError: true,
    };
  }
}
