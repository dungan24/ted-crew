---
name: ted-crew
description: "Claude/Gemini MCP 크루 호출. ask_claude, ask_gemini, Job 관리. Triggers: 'claude', 'gemini', '클로드', '제미나이', '위임', '시켜', '물어봐', '꼬봉'."
---

# Ted Crew — Codex의 크루 호출 가이드

ted-crew MCP 서버가 제공하는 `ask_claude`, `ask_gemini` 도구로 다른 AI를 크루로 호출한다.

> 모델명은 참고용입니다. 최신 모델은 각 서비스 공식 문서를 확인하세요.

---

## 라우팅 판단

### Claude 호출 (`ask_claude`)

대화형 코딩 작업, 문서화, 설명이 필요한 작업에 유리.

| 작업 | 모델 |
|------|------|
| 코드 생성, 리팩토링 | `claude-sonnet-4-6` (기본) |
| 고난도 설계, 아키텍처 | `claude-opus-4-6` |
| 간단한 수정, 빠른 질문 | `claude-haiku-4-5` |

```
ask_claude(
  prompt: "...",
  model: "claude-sonnet-4-6",
  files: ["/path/to/file"],
  allowed_tools: ["Read", "Write", "Edit", "Bash"]
)
```

### Gemini 호출 (`ask_gemini`)

1M 토큰 컨텍스트. **gemini-3 미만은 tool use 형편없음** — tool 필요 작업엔 3+ 사용.

| 작업 | 추천 모델 | 폴백 |
|------|----------|------|
| UI/UX 디자인, 브레인스토밍 | `gemini-3-pro-preview` | `gemini-2.5-pro` |
| 코드 작성 | `gemini-3-flash-preview` | `gemini-2.5-flash` |
| 파일 탐색, 빠른 분석 | `gemini-2.5-flash-lite` | `gemini-2.5-flash` |
| 리서치, 자료조사 | `gemini-2.5-pro` | `gemini-3-pro-preview` |
| 대규모 컨텍스트 분석 | `gemini-2.5-pro` | `gemini-3-pro-preview` |

**gemini-3-pro / 3.1-pro**: rate limit 걸리는 경우 많음 → 2.5-pro로 폴백.

```
# 리서치 (대규모 컨텍스트)
ask_gemini(
  prompt: "...",
  model: "gemini-2.5-pro",
  directories: ["/project/src"]
)

# UI/UX 디자인
ask_gemini(
  prompt: "...",
  model: "gemini-3-pro-preview"
)
```

### 판단 기준

```
컨텍스트가 거대한가? (수십 개 파일, 전체 코드베이스)
  → YES: ask_gemini (1M 토큰) + directories 파라미터

UI/UX 디자인, 창의적 작업?
  → ask_gemini (gemini-3-pro-preview)

리서치, 자료조사?
  → ask_gemini (gemini-2.5-pro)

대화형, 단계별 코딩 작업?
  → ask_claude
```

---

## Job 관리 (백그라운드)

`background: true`로 실행 후 Job 도구로 추적:

```
ask_gemini(prompt: "...", background: true)  → job_0001 반환

check_job(job_id: "job_0001")   # 논블로킹 상태 확인
wait_job(job_id: "job_0001")    # 완료까지 대기
kill_job(job_id: "job_0001")    # 강제 종료
list_jobs(status: "all")        # 전체 목록
```

---

## 주의사항

- 응답 500자 초과 시 `.aidocs/ted-crew/` 자동 저장 → 요약만 반환됨
- `working_directory` 지정 권장 — 응답 파일이 해당 프로젝트에 저장됨
- Gemini는 MCP 도구 연결 안 됨 — 순수 텍스트 원샷 작업만 가능
- Gemini 서버 불안정 시 폴백 모델로 재시도 고려
