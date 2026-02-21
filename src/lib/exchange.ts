/**
 * Exchange — 응답 파일 자동 저장
 *
 * 긴 응답을 .aidocs/ted-crew/ 에 저장하고 요약만 반환한다.
 * 컨텍스트 윈도우 절약이 핵심 목적.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { Provider } from "./types.js";

/** 응답 직접 반환 임계값 (이하면 직접 반환) */
const INLINE_THRESHOLD = 500;

/** 날짜 문자열: 20260220 */
function dateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** 시간 문자열: 1923 */
function timeStr(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${h}${min}`;
}

/** 파일명용 고유 ID (6자 hex) */
function nextSeq(): string {
  return randomBytes(3).toString("hex");
}

/** exchange 디렉토리 경로 결정 & 생성 */
function ensureExchangeDir(workingDirectory?: string): string {
  const base = workingDirectory ? resolve(workingDirectory) : process.cwd();
  const dir = join(base, ".aidocs", "ted-crew");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * output_file 저장 전 응답 정제 — 마크다운 코드 펜스 및 잡담 제거
 */
function sanitizeForFile(response: string): string {
  let text = response.trim();

  // 전체가 하나의 코드 펜스로 감싸진 경우: ```html\n...\n```
  const fencePattern = /^```\w*\s*\n([\s\S]*?)\n```\s*$/;
  const match = text.match(fencePattern);
  if (match) {
    return match[1].trim();
  }

  // 코드 펜스가 중간에 있는 경우 (앞뒤 잡담 포함):
  // "Here's the code:\n```html\n...\n```\nHope this helps!"
  const midFencePattern = /^[\s\S]*?```\w*\s*\n([\s\S]*?)\n```[\s\S]*$/;
  const midMatch = text.match(midFencePattern);
  if (midMatch && midMatch[1].length > text.length * 0.3) {
    return midMatch[1].trim();
  }

  return text;
}

/**
 * 에이전트(Gemini/Codex)가 직접 파일을 생성/수정했는지 감지.
 * 실행 전 mtime과 비교하여 판단한다.
 */
function detectAgentWrite(filePath: string, mtimeBefore: number): boolean {
  try {
    if (!existsSync(filePath)) return false;
    const stat = statSync(filePath);
    // mtime 또는 ctime 중 하나라도 변경되면 에이전트가 썼다고 판단
    // Windows NTFS mtime 해상도 보완을 위해 ctime도 확인
    return stat.mtimeMs > mtimeBefore || stat.ctimeMs > mtimeBefore;
  } catch {
    return false;
  }
}

export interface ExchangeResult {
  /** MCP에 반환할 텍스트 (요약 or 전체) */
  text: string;
  /** 파일에 저장했으면 경로, 아니면 undefined */
  savedTo?: string;
}

/**
 * 응답을 처리한다.
 *
 * - output_file 지정 시: 해당 경로에 저장 + 요약 반환
 * - 응답 > 500자: .aidocs/ted-crew/ 에 자동 저장 + 요약 반환
 * - 응답 <= 500자: 그대로 반환
 */
export function processResponse(
  response: string,
  provider: Provider,
  options: {
    outputFile?: string;
    workingDirectory?: string;
    /** 에이전트 실행 전 output_file 의 mtime (없었으면 0) */
    outputFileMtimeBefore?: number;
  } = {},
): ExchangeResult {
  // 1) output_file 직접 지정
  if (options.outputFile) {
    const filePath = resolve(options.outputFile);

    // 1a) 에이전트가 직접 파일을 썼는지 확인 (mtime 비교)
    const agentWrote = detectAgentWrite(
      filePath,
      options.outputFileMtimeBefore ?? 0,
    );
    if (agentWrote) {
      const content = readFileSync(filePath, "utf8");
      return {
        text: buildSummary(content, provider, filePath),
        savedTo: filePath,
      };
    }

    // 1b) 에이전트가 안 썼으면 응답 텍스트에서 추출하여 저장
    const dir = join(filePath, "..");
    mkdirSync(dir, { recursive: true });
    const sanitized = sanitizeForFile(response);
    writeFileSync(filePath, sanitized, "utf8");
    return {
      text: buildSummary(sanitized, provider, filePath),
      savedTo: filePath,
    };
  }

  // 2) 짧은 응답 → 직접 반환
  if (response.length <= INLINE_THRESHOLD) {
    return { text: response };
  }

  // 3) 긴 응답 → .aidocs/ted-crew/ 에 자동 저장
  const dir = ensureExchangeDir(options.workingDirectory);
  const filename = `${provider}-${dateStr()}-${timeStr()}-${nextSeq()}.md`;
  const filePath = join(dir, filename);
  writeFileSync(filePath, response, "utf8");

  return {
    text: buildSummary(response, provider, filePath),
    savedTo: filePath,
  };
}

/** 요약 텍스트 생성 */
function buildSummary(
  response: string,
  provider: Provider,
  filePath: string,
): string {
  const preview = response.slice(0, 300).trim();
  const lines = response.split("\n").length;

  return [
    `[${provider}] 응답 저장됨: ${filePath}`,
    `(${response.length}자, ${lines}줄)`,
    "",
    "--- preview ---",
    preview,
    preview.length < response.length ? "\n[...]" : "",
  ].join("\n");
}
