/**
 * ask_codex — Codex CLI 호출 도구
 *
 * Codex CLI를 통해 작업을 위임한다.
 * 15개 프로필로 태스크별 최적 모델 자동 선택.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AskCodexInput } from "../lib/types.js";
import {
  parseCodexOutput,
  detectRateLimit,
  detectModelError,
} from "../lib/parser.js";
import { processResponse } from "../lib/exchange.js";
import { spawnForeground, spawnBackground } from "../lib/spawner.js";
import {
  wrapPromptForFileOutput,
  buildPromptWithFiles,
} from "../lib/prompt-builder.js";
import { createJob } from "./jobs.js";
import { DEFAULT_TIMEOUT } from "../lib/constants.js";

export async function handleAskCodex(input: AskCodexInput): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  let fullPrompt = buildPromptWithFiles(input.prompt, input.files);
  // output_file: 항상 텍스트 출력 모드 → Codex -o 플래그가 파일 저장 담당
  // (에이전트한테 "파일 써라" 지시하면 sandbox 제한으로 실패하므로)
  if (input.output_file) {
    fullPrompt = wrapPromptForFileOutput(fullPrompt, input.output_file, false);
  }

  // CLI 인자 구성: codex exec [options] - (stdin에서 프롬프트 읽기)
  const args: string[] = ["exec"];

  // 모델
  if (input.model) {
    args.push("-m", input.model);
  }

  // 작업 디렉토리
  if (input.working_directory) {
    args.push("-C", resolve(input.working_directory));
  }

  // writable에 따른 sandbox 모드
  if (input.writable) {
    args.push("--full-auto");
    // output_file이 workspace 밖이면 해당 디렉토리를 추가 writable로 등록
    if (input.output_file) {
      const outputDir = dirname(resolve(input.output_file));
      const workspace = resolve(input.working_directory || process.cwd());
      if (!outputDir.startsWith(workspace)) {
        args.push("--add-dir", outputDir);
      }
    }
  } else {
    args.push("-s", "read-only");
  }

  // 구조화된 JSONL 출력 (항상 사용 — stdout 파싱용)
  args.push("--json");

  // output_file: -o 플래그로 Codex CLI가 마지막 메시지를 직접 파일 저장
  // --json과 공존 가능 (stdout=JSONL, -o=plain text)
  if (input.output_file) {
    args.push("-o", resolve(input.output_file));
  }

  // reasoning effort
  if (input.reasoning_effort) {
    args.push("-c", `model_reasoning_effort="${input.reasoning_effort}"`);
  }

  // stdin에서 프롬프트 읽기
  args.push("-");

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
      const child = spawnBackground("codex", args, {
        cwd,
        stdinData: fullPrompt,
      });
      const job = createJob("codex", child, {
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
                provider: "codex",
                message: `Codex 작업이 백그라운드로 시작됨. check_job('${job.id}') 또는 wait_job('${job.id}')로 결과 확인.`,
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
            text: `Codex CLI 스폰 실패: ${(err as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }

  // --- 포그라운드 모드 ---
  // 타임아웃: 사용자 지정 > 전역 기본값(5분). 느린 모델(gpt-5.2 xhigh) 사용 시 timeout_ms 늘릴 것
  const timeout = input.timeout_ms ?? DEFAULT_TIMEOUT;

  try {
    const result = await spawnForeground("codex", args, {
      cwd,
      stdinData: fullPrompt,
      timeout,
    });

    // 에러 감지
    if (detectRateLimit(result.stdout, result.stderr)) {
      return {
        content: [
          {
            type: "text",
            text: `Codex rate limit 감지. 잠시 후 재시도하세요.\n\nstderr: ${result.stderr}`,
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
            text: `Codex 모델 에러: ${result.stderr || result.stdout}`,
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
            text: `Codex CLI 에러 (exit ${result.exitCode}):\n${result.stderr || result.stdout}`,
          },
        ],
        isError: true,
      };
    }

    // -o 모드: Codex CLI가 파일을 직접 저장했는지 mtime 비교로 확인
    if (input.output_file) {
      const outputPath = resolve(input.output_file);
      try {
        if (existsSync(outputPath)) {
          const mtimeAfter = statSync(outputPath).mtimeMs;
          if (mtimeAfter > outputFileMtimeBefore) {
            // -o가 파일을 갱신함 → 파일 읽어서 반환
            const saved = readFileSync(outputPath, "utf8");
            const lines = saved.split("\n").length;
            const preview = saved.slice(0, 500);
            return {
              content: [
                {
                  type: "text",
                  text: `[codex] 저장됨: ${outputPath}\n(${saved.length}자, ${lines}줄)\n\n--- preview ---\n${preview}`,
                },
              ],
            };
          }
        }
      } catch {
        // 파일 읽기 실패 → 아래 일반 파싱으로 fallback
      }
    }

    // JSONL 파싱 (fallback 또는 output_file 없는 경우)
    let response = parseCodexOutput(result.stdout);

    if (!response) {
      return {
        content: [
          {
            type: "text",
            text: `Codex 응답이 비어있습니다.\nstdout: ${result.stdout.slice(0, 500)}\nstderr: ${result.stderr.slice(0, 500)}`,
          },
        ],
        isError: true,
      };
    }

    // 응답 처리 (자동 파일 저장 or 직접 반환)
    const exchanged = processResponse(response, "codex", {
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
        : "Codex CLI가 설치되지 않았습니다. `npm install -g @openai/codex` 로 설치하세요.";
      return {
        content: [{ type: "text", text: msg }],
        isError: true,
      };
    }
    return {
      content: [
        { type: "text", text: `Codex CLI 실행 실패: ${error.message}` },
      ],
      isError: true,
    };
  }
}
