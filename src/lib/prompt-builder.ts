/**
 * 공통 프롬프트 빌더
 *
 * ask-gemini, ask-codex에서 동일하게 사용하는 프롬프트 가공 함수.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * output_file 지정 시 프롬프트 가드레일.
 *
 * 전략 2가지:
 * - agentWrite (yolo/auto_edit): 에이전트가 직접 파일을 쓰게 지시
 * - textOnly (plan/default): 텍스트 출력만 요청 (MCP가 저장)
 */
export function wrapPromptForFileOutput(
  prompt: string,
  outputFile: string,
  agentWrite: boolean,
): string {
  const ext = outputFile.split(".").pop()?.toLowerCase() || "";

  if (agentWrite) {
    // 에이전트가 직접 파일을 생성하도록 지시 (yolo/auto_edit 모드)
    return [
      `다음 작업을 수행해. 다른 파일을 읽지 말고 바로 실행해:`,
      `"${outputFile}" 파일을 생성해. 요구사항은 아래와 같아.`,
      ``,
      prompt,
      ``,
      `중요: 다른 파일 읽지 마. "${outputFile}" 파일 쓰기만 해. 바로 실행.`,
    ].join("\n");
  }

  // 텍스트 출력만 요청 (MCP가 저장)
  return [
    `다음 .${ext} 파일의 내용을 생성해. 순수 코드만 출력해:`,
    `- 마크다운 코드 펜스(\`\`\`) 사용 금지`,
    `- 설명, 인사, 대화 금지`,
    `- 파일 내용으로 바로 시작하고 끝내`,
    ``,
    prompt,
  ].join("\n");
}

/** 파일 내용을 프롬프트 앞에 주입 */
export function buildPromptWithFiles(
  prompt: string,
  files?: string[],
): string {
  if (!files || files.length === 0) return prompt;

  const fileContents = files
    .map((f) => {
      try {
        const content = readFileSync(resolve(f), "utf8");
        return `--- ${f} ---\n${content}\n---`;
      } catch (err) {
        return `--- ${f} ---\n[Error reading file: ${(err as Error).message}]\n---`;
      }
    })
    .join("\n\n");

  return `다음 파일들을 참고하세요:\n\n${fileContents}\n\n${prompt}`;
}
