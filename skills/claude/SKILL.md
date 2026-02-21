---
name: ted-crew
description: "Gemini/Codex 지능형 라우팅. 작업 성격에 따라 최적 AI + 모델 자동 선택. Triggers: 'gemini', 'codex', 'friend', '제미나이', '코덱스', '꼬봉', '위임', '시켜', '물어봐', '리뷰해줘', '분석해줘'."
allowed-tools: mcp__ted_crew__ask_gemini, mcp__ted_crew__ask_codex, mcp__ted_crew__wait_job, mcp__ted_crew__check_job, mcp__ted_crew__kill_job, mcp__ted_crew__list_jobs, Read, Glob
---

# Ted Crew Router — AI 크루 라우팅

Gemini CLI와 Codex CLI를 MCP 도구(ted-crew 서버)를 통해 호출할 때,
**작업 성격에 따라 최적의 AI + 모델을 선택**하는 라우팅 가이드.

> 모델명은 참고용입니다. 최신 모델은 각 서비스 공식 문서를 확인하세요.

---

## 라우팅 판단 기준

### Gemini 적합 (ask_gemini)

텍스트 중심 작업. **도구/파일시스템 직접 접근 불가** — `files` 파라미터로 컨텍스트 주입 필수.
**주의**: gemini-3 미만 모델은 tool use가 형편없음 — tool 필요한 작업엔 3+ 사용.

| 작업 | 추천 모델 | 폴백 |
|------|----------|------|
| UI/UX 디자인, 브레인스토밍 | `gemini-3-pro-preview` | `gemini-2.5-pro` |
| 코드 작성 | `gemini-3-flash-preview` | `gemini-2.5-flash` |
| 파일 탐색, 빠른 분석 | `gemini-2.5-flash-lite` | `gemini-2.5-flash` |
| 리서치, 자료조사 | `gemini-2.5-pro` | `gemini-2.5-flash` |
| 대규모 컨텍스트 분석 | `gemini-2.5-pro` | `gemini-2.5-flash` |

**gemini-3-pro-preview**: rate limit 걸리는 경우 많음 — 실패 시 2.5-pro로 폴백. gemini-3.1-* 계열은 현재 Gemini CLI(Code Assist 플랜)에서 미지원.

### Codex 적합 (ask_codex)

코드 실행/수정 가능. model + reasoning_effort로 직접 제어.

| 작업 | model | reasoning_effort | 비고 |
|------|-------|-----------------|------|
| 코드 작업 (대부분) | `gpt-5.3-codex` | `medium` ~ `high` | 빠름 |
| 코드 작업 (복잡) | `gpt-5.3-codex` | `xhigh` | 작업량에 따라 오래 걸릴 수 있음 |
| 아키텍처 검토, 비코딩 지식 | `gpt-5.2` | `xhigh` | 색다른 관점. 코드 작업 X |
| 리서치, 비기술 판단 | `gpt-5.2` | `xhigh` | 코드리뷰 목적 X |

**gpt-5.2 xhigh 주의**: 코딩 전용 모델이 아님. 아키텍처 설계 검토, 비코딩 지식, 리서치에만 사용. 코드 리뷰 목적으론 쓰지 말 것.

### 둘 다 가능할 때 판단 기준

```
파일 수정이 필요한가?
  → YES: Codex (writable=true)
  → NO: 의견/분석만 필요하면 Gemini가 비용 효율적

컨텍스트가 거대한가? (수십 개 파일)
  → YES: Gemini (1M 토큰) + directories 파라미터
  → NO: 둘 다 OK

속도가 중요한가?
  → YES: Gemini flash-lite 또는 Codex (reasoning_effort: "low")
  → NO: 품질 우선 모델 선택
```

---

## 호출 패턴

### 단일 호출

```
# Gemini에게 리서치 요청
ask_gemini(prompt: "이 주제 조사해줘", model: "gemini-2.5-pro")

# Codex에게 수정 요청
ask_codex(prompt: "이 버그 고쳐줘", model: "gpt-5.3-codex", reasoning_effort: "high", writable: true, working_directory: "/project")
```

### 병렬 호출

두 AI에게 동시에 다른 관점으로 시키기:

```
# Gemini: 설계 리뷰 / Codex: 코드 품질 분석
ask_gemini(prompt: "아키텍처 관점에서 리뷰", files: [...], background: true)
ask_codex(prompt: "코드 품질 분석", model: "gpt-5.2", reasoning_effort: "xhigh", background: true)
→ list_jobs로 둘 다 완료 대기 → 결과 종합
```

### 대규모 컨텍스트

```
# Gemini에게 디렉토리 통째로 분석 시키기
ask_gemini(prompt: "이 프로젝트 구조 분석해줘", directories: ["/project/src"], model: "gemini-2.5-pro")
```

---

## 응답 처리

- **500자 이하**: 직접 반환 (인라인)
- **500자 초과**: `.aidocs/ted-crew/{provider}-{날짜}-{시간}-{seq}.md` 자동 저장 → 요약만 반환
- 전체 내용이 필요하면 `Read` 도구로 저장된 파일 읽기

---

## 주의사항

1. **Gemini MCP 도구 사용**: gemini-2.5-pro 이상은 ted-crew MCP 도구(ask_claude 등) 호출 가능. 단 gemini-2.5-flash 이하는 tool use 불안정 — 도구 필요 작업엔 2.5-pro+ 사용
2. **Codex writable 판단은 caller 책임** — 분석만 필요하면 `writable: false` (기본)
3. **Gemini 서버 불안정** — 에러 시 폴백 모델로 재시도 고려
4. **working_directory 지정 권장** — 응답 파일이 프로젝트의 `.aidocs/ted-crew/`에 저장됨
