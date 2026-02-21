#!/usr/bin/env node
/**
 * ted-crew 스킬 설치 스크립트
 *
 * 각 AI 클라이언트의 스킬 디렉토리에 SKILL.md를 복사합니다.
 *   Claude Code → ~/.claude/skills/ted-crew-router/
 *   Gemini CLI  → ~/.gemini/skills/ted-crew/
 *   Codex CLI   → ~/.codex/skills/ted-crew/
 */

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const home = homedir();
const skillsDir = new URL("../skills", import.meta.url).pathname.replace(
  /^\/([A-Z]:)/,
  "$1",
);

const targets = [
  {
    name: "Claude Code",
    src: join(skillsDir, "claude"),
    dest: join(home, ".claude", "skills", "ted-crew"),
  },
  {
    name: "Gemini CLI",
    src: join(skillsDir, "gemini"),
    dest: join(home, ".gemini", "skills", "ted-crew"),
  },
  {
    name: "Codex CLI",
    src: join(skillsDir, "codex"),
    dest: join(home, ".codex", "skills", "ted-crew"),
  },
];

let installed = 0;
let skipped = 0;

for (const { name, src, dest } of targets) {
  const srcFile = join(src, "SKILL.md");
  if (!existsSync(srcFile)) {
    console.warn(`[skip] ${name}: 소스 파일 없음 (${srcFile})`);
    skipped++;
    continue;
  }

  try {
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true, force: true });
    console.log(`[ok]   ${name} → ${dest}`);
    installed++;
  } catch (err) {
    console.error(`[fail] ${name}: ${err.message}`);
  }
}

console.log(`\n완료: ${installed}개 설치, ${skipped}개 건너뜀`);
if (installed > 0) {
  console.log("각 AI 클라이언트를 재시작하면 스킬이 활성화됩니다.");
}
