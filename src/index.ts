/**
 * Ted Crew MCP Server
 *
 * Gemini CLI와 Codex CLI를 MCP 도구로 통합하여
 * Claude Code, Gemini, Codex 모두가 서로를 크루로 활용할 수 있게 한다.
 *
 * 환경변수 TED_CREW_PROVIDER로 호출자를 지정하면
 * 자기 자신 도구를 자동으로 숨겨 무한 루프를 방지한다.
 *
 *   claude (기본) → ask_gemini + ask_codex + jobs
 *   gemini        → ask_codex + ask_claude + jobs
 *   codex         → ask_gemini + ask_claude + jobs
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { killAllProcesses } from "./lib/spawner.js";
import { handleAskGemini } from "./tools/ask-gemini.js";
import { handleAskCodex } from "./tools/ask-codex.js";
import { handleAskClaude } from "./tools/ask-claude.js";
import { waitJob, checkJob, killJob, listJobs } from "./tools/jobs.js";

// stderr로 로깅 (stdout은 MCP 프로토콜 전용)
const log = (...args: unknown[]) => console.error("[ted-crew]", ...args);

// --- 호출자 기반 도구 필터링 ---

type Provider = "claude" | "gemini" | "codex";

const provider = (process.env.TED_CREW_PROVIDER ?? "claude") as Provider;

/** 자기 자신 호출 방지: 호출자에 따라 노출할 도구 결정 */
const hiddenTools = new Set<string>();
if (provider === "claude") hiddenTools.add("ask_claude");
if (provider === "gemini") hiddenTools.add("ask_gemini");
if (provider === "codex") hiddenTools.add("ask_codex");

log(
  `Provider: ${provider}, hidden tools: [${[...hiddenTools].join(", ") || "none"}]`,
);

// --- 도구 정의 ---

const allTools = [
  {
    name: "ask_gemini",
    description:
      "Gemini CLI로 작업 위임. 1M 토큰 컨텍스트, 디자인/작문/리서치에 최적. files로 파일 내용을 prompt에 주입하거나, directories로 Gemini가 직접 디렉토리를 스캔하게 할 수 있다.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: { type: "string", description: "Gemini에게 보낼 프롬프트" },
        model: {
          type: "string",
          description: "모델 override (기본: Gemini CLI 기본값)",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description: "컨텍스트 파일 경로들 (내용을 읽어 prompt에 주입)",
        },
        directories: {
          type: "array",
          items: { type: "string" },
          description:
            "Gemini가 직접 스캔할 디렉토리들 (--include-directories)",
        },
        output_file: {
          type: "string",
          description: "응답을 저장할 파일 경로",
        },
        working_directory: { type: "string", description: "작업 디렉토리" },
        background: {
          type: "boolean",
          description: "백그라운드 실행 (기본: false)",
        },
        approval_mode: {
          type: "string",
          enum: ["yolo", "auto_edit", "plan"],
          description: "Gemini 승인 모드 (기본: yolo = 자동 승인)",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "ask_codex",
    description: `Codex CLI로 작업 위임. model과 reasoning_effort로 동작을 직접 제어한다.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: { type: "string", description: "Codex에게 보낼 프롬프트" },
        model: {
          type: "string",
          description: "모델 override (기본: Codex CLI 기본값)",
        },
        reasoning_effort: {
          type: "string",
          enum: ["minimal", "low", "medium", "high", "xhigh"],
          description: "추론 노력 수준",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description: "컨텍스트 파일 경로들",
        },
        output_file: {
          type: "string",
          description: "응답을 저장할 파일 경로",
        },
        working_directory: {
          type: "string",
          description: "작업 디렉토리 (-C 플래그)",
        },
        background: {
          type: "boolean",
          description: "백그라운드 실행 (기본: false)",
        },
        writable: {
          type: "boolean",
          description:
            "파일 수정 허용 여부. 코드 수정 필요 → true, 분석/의견만 → false(기본)",
        },
        timeout_ms: {
          type: "number",
          description:
            "포그라운드 타임아웃 (ms). 느린 모델(gpt-5.2 + xhigh) 사용 시 늘릴 것 (기본: 300000)",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "ask_claude",
    description: `Claude Code CLI로 작업 위임. Opus/Sonnet/Haiku 모델 선택 가능.

Claude Code는 코드 생성, 리팩토링, 디버깅, 테스트 작성에 강하다.
allowed_tools로 사용 가능한 도구를 제한할 수 있다.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: { type: "string", description: "Claude에게 보낼 프롬프트" },
        model: {
          type: "string",
          description:
            "모델 선택 (claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5)",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description: "컨텍스트 파일 경로들 (내용을 읽어 prompt에 주입)",
        },
        output_file: {
          type: "string",
          description: "응답을 저장할 파일 경로",
        },
        working_directory: {
          type: "string",
          description: "작업 디렉토리",
        },
        background: {
          type: "boolean",
          description: "백그라운드 실행 (기본: false)",
        },
        allowed_tools: {
          type: "array",
          items: { type: "string" },
          description:
            "허용 도구 목록 (Read, Write, Edit, Bash, Glob, Grep 등)",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "wait_job",
    description: "백그라운드 작업 완료 대기. 완료되면 전체 stdout/stderr 반환.",
    inputSchema: {
      type: "object" as const,
      properties: {
        job_id: { type: "string", description: "작업 ID" },
        timeout_ms: {
          type: "number",
          description: "대기 타임아웃 (기본: 300000ms = 5분)",
        },
      },
      required: ["job_id"],
    },
  },
  {
    name: "check_job",
    description:
      "백그라운드 작업 상태 확인 (논블로킹). stdout 미리보기 500자 포함.",
    inputSchema: {
      type: "object" as const,
      properties: {
        job_id: { type: "string", description: "작업 ID" },
      },
      required: ["job_id"],
    },
  },
  {
    name: "kill_job",
    description: "백그라운드 작업 강제 종료.",
    inputSchema: {
      type: "object" as const,
      properties: {
        job_id: { type: "string", description: "작업 ID" },
      },
      required: ["job_id"],
    },
  },
  {
    name: "list_jobs",
    description: "백그라운드 작업 목록 조회.",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["active", "completed", "failed", "all"],
          description: "필터 (기본: all)",
        },
        limit: { type: "number", description: "최대 반환 수 (기본: 20)" },
      },
    },
  },
];

// --- 서버 생성 ---

const server = new Server(
  { name: "ted-crew", version: "1.2.0" },
  { capabilities: { tools: {} } },
);

// --- 도구 목록 (필터링 적용) ---

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: allTools.filter((t) => !hiddenTools.has(t.name)),
}));

// --- 도구 실행 ---

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // 숨겨진 도구 호출 차단
  if (hiddenTools.has(name)) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Tool '${name}' is not available for provider '${provider}' (self-call prevention).`,
        },
      ],
      isError: true,
    };
  }

  switch (name) {
    case "ask_gemini":
      return handleAskGemini(args as Parameters<typeof handleAskGemini>[0]);

    case "ask_codex":
      return handleAskCodex(args as Parameters<typeof handleAskCodex>[0]);

    case "ask_claude":
      return handleAskClaude(args as Parameters<typeof handleAskClaude>[0]);

    case "wait_job": {
      const { job_id, timeout_ms } = args as {
        job_id: string;
        timeout_ms?: number;
      };
      const result = await waitJob(job_id, timeout_ms);
      if (!result) {
        return {
          content: [
            { type: "text" as const, text: `Job '${job_id}' not found.` },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { job: result.job, stdout: result.stdout, stderr: result.stderr },
              null,
              2,
            ),
          },
        ],
      };
    }

    case "check_job": {
      const { job_id } = args as { job_id: string };
      const info = checkJob(job_id);
      if (!info) {
        return {
          content: [
            { type: "text" as const, text: `Job '${job_id}' not found.` },
          ],
          isError: true,
        };
      }
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(info, null, 2) },
        ],
      };
    }

    case "kill_job": {
      const { job_id } = args as { job_id: string };
      const info = await killJob(job_id);
      if (!info) {
        return {
          content: [
            { type: "text" as const, text: `Job '${job_id}' not found.` },
          ],
          isError: true,
        };
      }
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(info, null, 2) },
        ],
      };
    }

    case "list_jobs": {
      const { status, limit } = (args ?? {}) as {
        status?: string;
        limit?: number;
      };
      const list = listJobs(
        status as "active" | "completed" | "failed" | "all",
        limit,
      );
      return {
        content: [
          {
            type: "text" as const,
            text:
              list.length === 0
                ? "No jobs found."
                : JSON.stringify(list, null, 2),
          },
        ],
      };
    }

    default:
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

// --- 서버 시작 ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("Ted Crew MCP server started (stdio transport)");
}

// --- 정리 ---

function cleanup() {
  log("Shutting down, killing child processes...");
  killAllProcesses();
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("uncaughtException", (err) => {
  log("Uncaught exception:", err);
  killAllProcesses();
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  log("Unhandled rejection:", err);
});

main().catch((err) => {
  log("Fatal error:", err);
  process.exit(1);
});
