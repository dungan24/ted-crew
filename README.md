# Ted Crew MCP Server

Claude Code, Gemini CLI, Codex CLI를 하나의 MCP 서버로 통합하여 **AI 메쉬 네트워크**를 구성합니다.
각 AI가 나머지 둘을 크루(crew)로 호출할 수 있으며, 자기 자신 호출은 자동 차단됩니다.

```
         ┌── ask_codex ──→ Codex ──┐
Claude ──┤                         ├── ask_claude ──→ Claude
         └── ask_gemini ─→ Gemini ─┘
                             │
                             └── ask_codex ──→ Codex
```

## 사전 요구사항

- [Claude Code](https://claude.ai/code) CLI
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- [Codex CLI](https://github.com/openai/codex)

## 설치

### Claude Code (`~/.claude/settings.json`)

```json
{
  "mcpServers": {
    "ted-crew": {
      "command": "npx",
      "args": ["-y", "ted-crew"]
    }
  }
}
```

### Gemini CLI (`~/.gemini/settings.json`)

```json
{
  "mcpServers": {
    "ted-crew": {
      "command": "npx",
      "args": ["-y", "ted-crew"],
      "env": { "TED_CREW_PROVIDER": "gemini" },
      "trust": true
    }
  }
}
```

### Codex CLI (`~/.codex/config.toml`)

```toml
[mcp_servers.ted-crew]
command = "npx"
args = ["-y", "ted-crew"]
env = { "TED_CREW_PROVIDER" = "codex" }
```

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "ted-crew": {
      "command": "npx",
      "args": ["-y", "ted-crew"]
    }
  }
}
```

### Windsurf (`~/.codeium/windsurf/mcp_config.json`)

```json
{
  "mcpServers": {
    "ted-crew": {
      "command": "npx",
      "args": ["-y", "ted-crew"],
      "disabled": false
    }
  }
}
```

### Cline / VS Code Copilot

```json
{
  "mcpServers": {
    "ted-crew": {
      "command": "npx",
      "args": ["-y", "ted-crew"]
    }
  }
}
```

## Provider 설정

환경변수 `TED_CREW_PROVIDER`로 호출자를 지정합니다.
서버는 자기 자신에 해당하는 도구를 자동으로 숨겨 무한 루프를 방지합니다.

| Provider | 숨김 | 노출 도구 |
|----------|------|----------|
| `claude` (기본) | `ask_claude` | `ask_gemini`, `ask_codex`, jobs |
| `gemini` | `ask_gemini` | `ask_codex`, `ask_claude`, jobs |
| `codex` | `ask_codex` | `ask_gemini`, `ask_claude`, jobs |

IDE 기반 클라이언트(Cursor, Windsurf, Cline 등)는 `TED_CREW_PROVIDER` 없이 기본값 `claude`로 사용하면 됩니다.

## 사용 시나리오

### 1. 병렬 코드 리뷰

두 AI가 다른 시각으로 동시에 리뷰:

```
ask_gemini(prompt: "아키텍처 관점에서 리뷰해줘", files: [...], background: true)
ask_codex(prompt: "코드 품질/버그 관점에서 리뷰해줘", model: "gpt-5.3-codex", reasoning_effort: "high", background: true)
→ wait_job으로 둘 다 완료 대기 → 결과 종합
```

### 2. 대규모 코드베이스 분석 → 구현

Gemini 1M 토큰으로 전체 구조 파악 후 Codex가 실행:

```
ask_gemini(prompt: "X 기능 어디 손대야 해?", directories: ["./src"], model: "gemini-2.5-pro")
→ 분석 결과 받아서
ask_codex(prompt: "분석 결과대로 수정해줘", model: "gpt-5.3-codex", reasoning_effort: "high", writable: true)
```

### 3. 다른 관점 의견 구하기

같은 문제를 다른 모델이 다른 각도로 분석:

```
ask_codex(prompt: "이 에러 왜 나는지 분석해줘 [에러 내용]", model: "gpt-5.3-codex", reasoning_effort: "xhigh")
```

### 4. 문서 생성 파이프라인

작문 특화 Gemini로 초안 → Claude가 맥락에 맞게 다듬기:

```
ask_gemini(prompt: "이 코드 읽고 README 초안 써줘", files: ["./src/index.ts"])
→ 초안 받아서 Claude가 프로젝트 맥락에 맞게 편집
```

### 5. 리서치 → 구현

Claude 컨텍스트를 아끼면서 리서치 아웃소싱:

```
ask_gemini(prompt: "React Query v5 staleTime vs gcTime 차이 정리해줘", model: "gemini-2.5-pro")
→ 결과 받아서 Claude가 실제 코드에 적용
```

### 핵심 원칙

| AI | 강점 |
|----|------|
| **Gemini** | 대규모 컨텍스트 분석(1M 토큰), 작문, 리서치 |
| **Codex** | 코드 실행/수정, 빌드/테스트, reasoning_effort 조절 |
| **Claude** | 오케스트레이터, 대화 맥락 유지, 최종 판단 |

---

## 도구

### `ask_gemini`

Gemini CLI로 작업을 위임합니다. 1M 토큰 컨텍스트, 디자인/작문/리서치에 적합합니다.

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `prompt` | string | O | 프롬프트 |
| `model` | string | | 모델 override |
| `files` | string[] | | 내용을 읽어 프롬프트에 주입할 파일 경로 |
| `directories` | string[] | | Gemini가 직접 스캔할 디렉토리 |
| `output_file` | string | | 응답을 저장할 파일 경로 |
| `working_directory` | string | | 작업 디렉토리 |
| `background` | boolean | | 백그라운드 실행 |
| `approval_mode` | string | | `yolo` / `auto_edit` / `plan` |

### `ask_codex`

Codex CLI로 작업을 위임합니다. `model`과 `reasoning_effort`로 동작을 직접 제어합니다.

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `prompt` | string | O | 프롬프트 |
| `model` | string | | 모델 override (기본: Codex CLI 기본값) |
| `reasoning_effort` | string | | `minimal` / `low` / `medium` / `high` / `xhigh` |
| `files` | string[] | | 컨텍스트 파일 경로 |
| `output_file` | string | | 응답 저장 파일 경로 |
| `working_directory` | string | | 작업 디렉토리 |
| `background` | boolean | | 백그라운드 실행 |
| `writable` | boolean | | 파일 수정 허용 |
| `timeout_ms` | number | | 포그라운드 타임아웃 ms (기본: 300,000) |

### `ask_claude`

Claude Code CLI로 작업을 위임합니다. 코드 생성, 디버깅, 리팩토링에 적합합니다.

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `prompt` | string | O | 프롬프트 |
| `model` | string | | `claude-opus-4-6` / `claude-sonnet-4-6` / `claude-haiku-4-5` |
| `files` | string[] | | 컨텍스트 파일 경로 |
| `output_file` | string | | 응답 저장 파일 경로 |
| `working_directory` | string | | 작업 디렉토리 |
| `background` | boolean | | 백그라운드 실행 |
| `allowed_tools` | string[] | | 허용 도구 (Read, Write, Edit, Bash 등) |

### Job 관리

백그라운드 실행된 작업을 관리합니다.

| 도구 | 설명 |
|------|------|
| `wait_job` | 완료까지 대기, stdout/stderr 전체 반환 |
| `check_job` | 상태 확인 (논블로킹), stdout 미리보기 500자 |
| `kill_job` | 강제 종료 |
| `list_jobs` | 목록 조회 (active/completed/failed/all 필터) |

## 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `TED_CREW_PROVIDER` | `claude` | 호출자 식별 (`claude` / `gemini` / `codex`) |
| `TED_CREW_MAX_STDOUT` | `10485760` | stdout 수집 상한 (10MB) |
| `TED_CREW_TIMEOUT` | `300000` | 포그라운드 기본 타임아웃 (5분) |

## 응답 자동 저장

응답이 500자를 초과하면 `.aidocs/ted-crew/{provider}-{날짜}-{시간}.md`에 자동 저장되고 요약만 반환됩니다.
`working_directory`를 지정하면 해당 프로젝트 아래에 저장됩니다.

## 스킬 설치

각 AI 클라이언트에 라우팅 가이드 스킬을 설치합니다.

```bash
npx ted-crew install-skills
```

또는 소스에서:

```bash
npm run install-skills
```

설치 위치:

| AI | 경로 |
|----|------|
| Claude Code | `~/.claude/skills/ted-crew/` |
| Gemini CLI | `~/.gemini/skills/ted-crew/` |
| Codex CLI | `~/.codex/skills/ted-crew/` |

## 프로젝트 구조

```
src/
├── index.ts                 # MCP 서버 엔트리, 도구 필터링
├── lib/
│   ├── constants.ts         # 공유 상수
│   ├── exchange.ts          # 응답 후처리 (파일 저장)
│   ├── parser.ts            # CLI 출력 파싱, 에러 감지
│   ├── prompt-builder.ts    # 프롬프트 가공
│   ├── spawner.ts           # CLI 프로세스 스폰
│   └── types.ts             # TypeScript 타입 정의
└── tools/
    ├── ask-claude.ts        # Claude Code CLI 호출
    ├── ask-codex.ts         # Codex CLI 호출
    ├── ask-gemini.ts        # Gemini CLI 호출
    └── jobs.ts              # 백그라운드 Job 관리
```

## 빌드

```bash
npm install
npm run build    # esbuild → dist/server.cjs
npm run dev      # watch 모드
```

## 라이선스

MIT
