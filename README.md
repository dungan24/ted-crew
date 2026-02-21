# Ted Crew MCP Server

Connect Claude Code, Gemini CLI, and Codex CLI as a single MCP server to form an **AI mesh network**.
Each AI can call the others as crew members — self-calls are automatically blocked to prevent infinite loops.

```
         ┌── ask_codex ──→ Codex ──┐
Claude ──┤                         ├── ask_claude ──→ Claude
         └── ask_gemini ─→ Gemini ─┘
                             │
                             └── ask_codex ──→ Codex
```

[한국어 README](README.ko.md)

## Prerequisites

- [Claude Code](https://claude.ai/code) CLI
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- [Codex CLI](https://github.com/openai/codex)

## Installation

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

## Provider Configuration

Set `TED_CREW_PROVIDER` to identify the caller. The server automatically hides the tool matching the caller to prevent infinite loops.

| Provider | Hidden | Exposed Tools |
|----------|--------|---------------|
| `claude` (default) | `ask_claude` | `ask_gemini`, `ask_codex`, jobs |
| `gemini` | `ask_gemini` | `ask_codex`, `ask_claude`, jobs |
| `codex` | `ask_codex` | `ask_gemini`, `ask_claude`, jobs |

IDE-based clients (Cursor, Windsurf, Cline, etc.) can omit `TED_CREW_PROVIDER` — they'll default to `claude`.

## Use Cases

### 1. Parallel Code Review

Two AIs review simultaneously from different angles:

```
ask_gemini(prompt: "Review from an architecture perspective", files: [...], background: true)
ask_codex(prompt: "Review for code quality and bugs", model: "gpt-5.3-codex", reasoning_effort: "high", background: true)
→ wait_job for both → synthesize results
```

### 2. Large Codebase Analysis → Implementation

Gemini's 1M token context maps the codebase, then Codex implements:

```
ask_gemini(prompt: "What files need to change for feature X?", directories: ["./src"], model: "gemini-2.5-pro")
→ feed results to
ask_codex(prompt: "Make the changes based on the analysis", model: "gpt-5.3-codex", reasoning_effort: "high", writable: true)
```

### 3. Second Opinion

Get a different perspective on the same problem:

```
ask_codex(prompt: "Why is this error happening? [error details]", model: "gpt-5.3-codex", reasoning_effort: "xhigh")
```

### 4. Documentation Pipeline

Draft with writing-focused Gemini → Claude refines with project context:

```
ask_gemini(prompt: "Read this code and write a README draft", files: ["./src/index.ts"])
→ Claude edits the draft to fit the project
```

### 5. Research → Implementation

Outsource research to preserve Claude's context window:

```
ask_gemini(prompt: "Summarize React Query v5 staleTime vs gcTime differences", model: "gemini-2.5-pro")
→ Claude applies the findings to actual code
```

### AI Strengths at a Glance

| AI | Strengths |
|----|-----------|
| **Gemini** | Large context analysis (1M tokens), writing, research |
| **Codex** | Code execution/editing, build/test, tunable reasoning_effort |
| **Claude** | Orchestrator, conversation context, final judgment |

---

## Tools

### `ask_gemini`

Delegates tasks to Gemini CLI. Best for 1M token context, writing, and research.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Prompt text |
| `model` | string | | Model override |
| `files` | string[] | | File paths to inject as context |
| `directories` | string[] | | Directories for Gemini to scan directly |
| `output_file` | string | | File path to save the response |
| `working_directory` | string | | Working directory |
| `background` | boolean | | Run in background |
| `approval_mode` | string | | `yolo` / `auto_edit` / `plan` |

### `ask_codex`

Delegates tasks to Codex CLI. Directly control behavior with `model` and `reasoning_effort`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Prompt text |
| `model` | string | | Model override (default: Codex CLI default) |
| `reasoning_effort` | string | | `minimal` / `low` / `medium` / `high` / `xhigh` |
| `files` | string[] | | Context file paths |
| `output_file` | string | | File path to save the response |
| `working_directory` | string | | Working directory |
| `background` | boolean | | Run in background |
| `writable` | boolean | | Allow file modifications |
| `timeout_ms` | number | | Foreground timeout in ms (default: 300,000) |

### `ask_claude`

Delegates tasks to Claude Code CLI. Best for code generation, debugging, and refactoring.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Prompt text |
| `model` | string | | `claude-opus-4-6` / `claude-sonnet-4-6` / `claude-haiku-4-5` |
| `files` | string[] | | Context file paths |
| `output_file` | string | | File path to save the response |
| `working_directory` | string | | Working directory |
| `background` | boolean | | Run in background |
| `allowed_tools` | string[] | | Allowed tools (Read, Write, Edit, Bash, etc.) |

### Job Management

Manage background jobs.

| Tool | Description |
|------|-------------|
| `wait_job` | Wait for completion, return full stdout/stderr |
| `check_job` | Non-blocking status check, 500-char stdout preview |
| `kill_job` | Force terminate |
| `list_jobs` | List jobs (filter: active/completed/failed/all) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TED_CREW_PROVIDER` | `claude` | Caller identity (`claude` / `gemini` / `codex`) |
| `TED_CREW_MAX_STDOUT` | `10485760` | stdout collection limit (10MB) |
| `TED_CREW_TIMEOUT` | `300000` | Default foreground timeout (5 min) |

## Auto-Save Responses

Responses longer than 500 characters are automatically saved to `.aidocs/ted-crew/{provider}-{date}-{time}.md` and only a summary is returned.
Specify `working_directory` to save under that project's directory.

## Install Skills

Install routing guide skills for each AI client:

```bash
npx ted-crew install-skills
```

Or from source:

```bash
npm run install-skills
```

Install locations:

| AI | Path |
|----|------|
| Claude Code | `~/.claude/skills/ted-crew/` |
| Gemini CLI | `~/.gemini/skills/ted-crew/` |
| Codex CLI | `~/.codex/skills/ted-crew/` |

## Project Structure

```
src/
├── index.ts                 # MCP server entry, tool filtering
├── lib/
│   ├── constants.ts         # Shared constants
│   ├── exchange.ts          # Response post-processing (file save)
│   ├── parser.ts            # CLI output parsing, error detection
│   ├── prompt-builder.ts    # Prompt construction
│   ├── spawner.ts           # CLI process spawning
│   └── types.ts             # TypeScript type definitions
└── tools/
    ├── ask-claude.ts        # Claude Code CLI caller
    ├── ask-codex.ts         # Codex CLI caller
    ├── ask-gemini.ts        # Gemini CLI caller
    └── jobs.ts              # Background job manager
```

## Build

```bash
npm install
npm run build    # esbuild → dist/server.cjs
npm run dev      # watch mode
```

## License

MIT
