# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ted Crew는 Claude Code, Gemini CLI, Codex CLI를 하나의 MCP(Model Context Protocol) 서버로 통합하는 **AI 메쉬 네트워크**입니다. 각 AI가 나머지를 크루로 호출할 수 있으며, `TED_CREW_PROVIDER` 환경변수로 호출자를 식별하여 자기 자신 호출을 자동 차단합니다.

## Build & Dev

```bash
npm run build    # esbuild → dist/server.cjs (단일 CJS 번들, 외부 의존성 없음)
npm run dev      # watch 모드
```

출력: `dist/server.cjs` — MCP 클라이언트(Claude, Gemini, Codex)가 stdio transport로 실행합니다.

## Architecture

### Provider별 도구 필터링 (무한 루프 방지)

`src/index.ts`에서 `TED_CREW_PROVIDER` 값에 따라 자기 자신 도구를 `hiddenTools`로 숨깁니다:
- `claude` (기본) → `ask_claude` 숨김
- `gemini` → `ask_gemini` 숨김
- `codex` → `ask_codex` 숨김

### 프롬프트 전달: stdin 파이핑

모든 도구(ask_gemini, ask_codex, ask_claude)는 프롬프트를 **CLI 인자가 아닌 stdin으로 전달**합니다. CLI 인자 길이 제한을 회피하고 보안성을 확보하기 위함입니다. `spawner.ts`에서 `stdinData` 옵션으로 처리합니다.

### 포그라운드 / 백그라운드 이중 모드

- **포그라운드** (`spawnForeground`): Promise 반환, 완료까지 대기, stdout/stderr 수집
- **백그라운드** (`spawnBackground`): ChildProcess 즉시 반환, `jobs.ts`의 Job 관리자가 추적
- 모든 도구에 `background` 파라미터가 있어 사용자가 모드를 선택합니다

### 응답 후처리 (`exchange.ts`)

컨텍스트 윈도우 최적화를 위해:
1. `output_file` 지정 시 → 에이전트가 직접 썼는지 mtime으로 감지, 아니면 MCP가 저장
2. 응답 > 500자 → `.aidocs/ted-crew/{provider}-{date}-{seq}.md`에 자동 저장, 요약만 반환
3. 응답 ≤ 500자 → 그대로 반환

### 프롬프트 빌드 전략 (`prompt-builder.ts`)

`output_file`과 `approval_mode`에 따라 2가지 전략:
- **agentWrite** (yolo/auto_edit): 에이전트가 직접 파일 생성하도록 지시
- **textOnly** (plan/default): 순수 텍스트만 출력하도록 지시, MCP가 저장

`files` 배열의 각 파일 내용을 읽어 프롬프트 앞에 컨텍스트로 주입합니다.

### CLI 출력 파싱 (`parser.ts`)

- **Codex**: JSONL 이벤트 스트림 파싱 (`item.completed`, `output_text`, `message` 타입)
- **Gemini**: plain text
- Rate limit (429) 및 모델 에러 자동 감지

### Job 관리 (`jobs.ts`)

- Job ID: `job_0001` 형식, 서버 세션 내 순차 증가
- stdout 10MB / stderr 1MB 수집 상한
- 완료된 Job은 1시간(JOB_TTL_MS) 후 GC가 자동 삭제 (GC 주기 10분)
- 서버 종료 시 활성 프로세스 SIGTERM → 3초 후 SIGKILL

## Key Conventions

- **TypeScript strict 모드** — `as any`, `@ts-ignore` 금지
- **환경변수 기반 설정** — `constants.ts`에서 `safeInt()`로 안전하게 파싱
- **Windows 호환** — `spawner.ts`에서 npm 글로벌 패키지는 `cmd /c xxx.cmd` 패턴, Claude는 네이티브 실행
- **에러 처리** — ENOENT 시 CLI 미설치 vs 잘못된 cwd 구분, rate limit과 모델 에러 정규식 감지
- **코드 주석/문서**: 한글 사용

## Environment Variables

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `TED_CREW_PROVIDER` | `claude` | 호출자 식별 |
| `TED_CREW_MAX_STDOUT` | `10485760` | stdout 수집 상한 (10MB) |
| `TED_CREW_TIMEOUT` | `300000` | 포그라운드 타임아웃 (5분) |
