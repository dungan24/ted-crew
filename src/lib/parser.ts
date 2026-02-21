/**
 * CLI 출력 파서
 *
 * Gemini의 -o json 출력과 Codex exec 출력에서 실제 응답 텍스트를 추출한다.
 */

/** Gemini -o json 출력 파싱 */
export function parseGeminiOutput(
  stdout: string,
  format: "json" | "text",
): string {
  if (format === "text" || !stdout.trim()) {
    return stdout.trim();
  }

  try {
    // Gemini JSON 출력: 여러 줄에 걸친 JSON이나 JSONL일 수 있음
    // 마지막 유효 JSON 객체에서 텍스트 추출 시도
    const lines = stdout.trim().split("\n");

    // 전체를 하나의 JSON으로 파싱 시도
    try {
      const parsed = JSON.parse(stdout.trim());
      return extractGeminiText(parsed);
    } catch {
      // JSONL 형태: 마지막 줄부터 역순 파싱
    }

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        const text = extractGeminiText(parsed);
        if (text) return text;
      } catch {
        continue;
      }
    }

    // JSON 파싱 전부 실패 → 원본 반환
    return stdout.trim();
  } catch {
    return stdout.trim();
  }
}

/** Gemini JSON 객체에서 텍스트 추출 */
function extractGeminiText(obj: unknown): string {
  if (!obj || typeof obj !== "object") return "";

  const record = obj as Record<string, unknown>;

  // 직접 텍스트 필드
  if (typeof record.text === "string") return record.text;
  if (typeof record.response === "string") return record.response;
  if (typeof record.modelResponse === "string") return record.modelResponse;

  // 중첩 구조: candidates[].content.parts[].text
  if (Array.isArray(record.candidates)) {
    for (const candidate of record.candidates) {
      const c = candidate as Record<string, unknown>;
      const content = c.content as Record<string, unknown> | undefined;
      if (content && Array.isArray(content.parts)) {
        const texts = (content.parts as Array<Record<string, unknown>>)
          .filter((p) => typeof p.text === "string")
          .map((p) => p.text as string);
        if (texts.length > 0) return texts.join("\n");
      }
    }
  }

  // result 필드
  if (typeof record.result === "string") return record.result;

  return "";
}

/** Codex exec 출력 파싱 (--json JSONL 이벤트 스트림 지원) */
export function parseCodexOutput(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return "";

  const lines = trimmed.split("\n");
  const messages: string[] = [];

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      const event = JSON.parse(t) as Record<string, unknown>;

      // item.completed (agent_message)
      if (event.type === "item.completed") {
        const item = event.item as Record<string, unknown> | undefined;
        if (item?.type === "agent_message" && typeof item.text === "string") {
          messages.push(item.text);
          continue;
        }
      }

      // output_text
      if (event.type === "output_text" && typeof event.text === "string") {
        messages.push(event.text);
        continue;
      }

      // message with content (string or array)
      if (event.type === "message") {
        if (typeof event.content === "string") {
          messages.push(event.content);
          continue;
        }
        if (Array.isArray(event.content)) {
          for (const part of event.content as Record<string, unknown>[]) {
            if (part.type === "text" && typeof part.text === "string") {
              messages.push(part.text);
            }
          }
          continue;
        }
      }

      // 기존 fallback: 단순 필드 매칭
      if (typeof event.message === "string") {
        messages.push(event.message);
        continue;
      }
      if (typeof event.text === "string") {
        messages.push(event.text);
        continue;
      }
      if (typeof event.content === "string") {
        messages.push(event.content);
        continue;
      }
      if (typeof event.response === "string") {
        messages.push(event.response);
        continue;
      }
    } catch {
      // JSON이 아닌 줄은 무시
    }
  }

  return messages.length > 0 ? messages.join("\n") : trimmed;
}

/** Rate limit 감지 */
export function detectRateLimit(stdout: string, stderr: string): boolean {
  const combined = (stdout + " " + stderr).toLowerCase();
  return /429|rate.?limit|quota.?exceeded|too.?many.?requests/.test(combined);
}

/** 모델 에러 감지 */
export function detectModelError(stdout: string, stderr: string): boolean {
  const combined = (stdout + " " + stderr).toLowerCase();
  return /model.?not.?found|not.?supported|invalid.?model|unknown.?model/.test(
    combined,
  );
}
