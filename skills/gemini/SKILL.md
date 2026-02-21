---
name: ted-crew
description: "Claude/Codex MCP 크루 호출. ask_claude, ask_codex, Job 관리. Triggers: 'claude', 'codex', '클로드', '코덱스', '위임', '시켜', '물어봐', '꼬봉'."
---

# Ted Crew — Gemini의 크루 호출 가이드

ted-crew MCP 서버가 제공하는 `ask_claude`, `ask_codex` 도구로 다른 AI를 크루로 호출한다.

> 모델명은 참고용입니다. 최신 모델은 각 서비스 공식 문서를 확인하세요.

---

## 라우팅 판단

### Claude 호출 (`ask_claude`)

파일 시스템 직접 접근 + 코딩 특화 작업에 유리.

| 작업 | 모델 |
|------|------|
| 코드 생성, 리팩토링 | `claude-sonnet-4-6` (기본) |
| 고난도 설계, 아키텍처 | `claude-opus-4-6` |
| 간단한 수정, 빠른 질문 | `claude-haiku-4-5` |

```
ask_claude(
  prompt: "...",
  model: "claude-sonnet-4-6",   # 생략 시 기본값
  files: ["/path/to/file"],     # 컨텍스트 파일
  allowed_tools: ["Read", "Write", "Edit", "Bash"]  # 도구 제한 (선택)
)
```

### Codex 호출 (`ask_codex`)

코드 실행/수정 가능. model + reasoning_effort로 직접 제어.

| 작업 | model | reasoning_effort | 비고 |
|------|-------|-----------------|------|
| 코드 작업 (대부분) | `gpt-5.3-codex` | `medium` ~ `high` | 빠름 |
| 코드 작업 (복잡) | `gpt-5.3-codex` | `xhigh` | 작업량에 따라 오래 걸릴 수 있음 |
| 아키텍처 검토, 비코딩 지식, 리서치 | `gpt-5.2` | `xhigh` | 색다른 관점 전용. 코드 작업 X |

**gpt-5.2 xhigh**: 코딩 전용 모델이 아님. 코드리뷰 목적으론 쓰지 말 것.

```
# 코드 수정
ask_codex(
  prompt: "...",
  model: "gpt-5.3-codex",
  reasoning_effort: "high",
  writable: true,
  working_directory: "/project"
)

# 아키텍처 검토 (색다른 관점)
ask_codex(
  prompt: "...",
  model: "gpt-5.2",
  reasoning_effort: "xhigh",
  timeout_ms: 900000
)
```

### 판단 기준

```
파일 수정이 필요한가?
  → YES: ask_codex (writable=true) 또는 ask_claude
  → NO: 분석/답변만이면 둘 다 OK

Claude vs Codex 선택:
  → 대화/설명/문서 → ask_claude
  → 코드 실행/빌드/테스트 → ask_codex
```

---

## Job 관리 (백그라운드)

`background: true`로 실행 후 Job 도구로 추적:

```
ask_claude(prompt: "...", background: true)  → job_0001 반환

check_job(job_id: "job_0001")   # 논블로킹 상태 확인
wait_job(job_id: "job_0001")    # 완료까지 대기
kill_job(job_id: "job_0001")    # 강제 종료
list_jobs(status: "all")        # 전체 목록
```

---

## 주의사항

- 응답 500자 초과 시 `.aidocs/ted-crew/` 자동 저장 → 요약만 반환됨
- `working_directory` 지정 권장 — 응답 파일이 해당 프로젝트에 저장됨
- Claude는 `allowed_tools` 미지정 시 모든 도구 사용 가능
