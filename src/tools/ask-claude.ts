/**
 * ask_claude — Claude Code CLI 호출 도구
 *
 * Claude Code CLI를 통해 작업을 위임한다.
 * Gemini/Codex에서 Claude를 크루로 활용할 때 사용.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AskClaudeInput } from "../lib/types.js";
import { buildPromptWithFiles } from "../lib/prompt-builder.js";
import { spawnForeground, spawnBackground } from "../lib/spawner.js";
import { createJob } from "./jobs.js";

export async function handleAskClaude(input: AskClaudeInput): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  const fullPrompt = buildPromptWithFiles(input.prompt, input.files);

  // CLI 인자 구성: claude -p --output-format text (stdin으로 프롬프트 전달)
  const args: string[] = ["-p", "--output-format", "text"];

  if (input.model) {
    args.push("--model", input.model);
  }

  if (input.allowed_tools && input.allowed_tools.length > 0) {
    for (const tool of input.allowed_tools) {
      args.push("--allowedTools", tool);
    }
  }

  const cwd = input.working_directory
    ? resolve(input.working_directory)
    : undefined;

  // --- 백그라운드 모드 ---
  if (input.background) {
    try {
      const child = spawnBackground("claude", args, {
        cwd,
        stdinData: fullPrompt,
      });
      const job = createJob("claude", child, {
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
                provider: "claude",
                message: `Claude 작업이 백그라운드로 시작됨. check_job('${job.id}') 또는 wait_job('${job.id}')로 결과 확인.`,
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
            text: `Claude CLI 스폰 실패: ${(err as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }

  // --- 포그라운드 모드 ---
  try {
    const result = await spawnForeground("claude", args, {
      cwd,
      stdinData: fullPrompt,
    });

    if (result.exitCode !== 0 && result.exitCode !== null) {
      return {
        content: [
          {
            type: "text",
            text: `Claude CLI 에러 (exit ${result.exitCode}):\n${result.stderr || result.stdout}`,
          },
        ],
        isError: true,
      };
    }

    const response = result.stdout.trim();

    if (!response) {
      return {
        content: [
          {
            type: "text",
            text: `Claude 응답이 비어있습니다.\nstdout: ${result.stdout.slice(0, 500)}\nstderr: ${result.stderr.slice(0, 500)}`,
          },
        ],
        isError: true,
      };
    }

    // output_file이 지정되면 파일로 저장
    if (input.output_file) {
      const { writeFileSync, mkdirSync } = await import("node:fs");
      const { dirname } = await import("node:path");
      const outputPath = resolve(input.output_file);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, response, "utf8");
      const lines = response.split("\n").length;
      const preview = response.slice(0, 500);
      return {
        content: [
          {
            type: "text",
            text: `[claude] 저장됨: ${outputPath}\n(${response.length}자, ${lines}줄)\n\n--- preview ---\n${preview}`,
          },
        ],
      };
    }

    return { content: [{ type: "text", text: response }] };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      const isCwd = cwd && !existsSync(cwd);
      const msg = isCwd
        ? `작업 디렉토리가 존재하지 않습니다: ${cwd}`
        : "Claude CLI가 설치되지 않았습니다. https://claude.ai/download 에서 설치하세요.";
      return {
        content: [{ type: "text", text: msg }],
        isError: true,
      };
    }
    return {
      content: [
        { type: "text", text: `Claude CLI 실행 실패: ${error.message}` },
      ],
      isError: true,
    };
  }
}
