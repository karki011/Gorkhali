# DeerFlow Ground-Truth Verification Report

Source: `git clone --depth 1 https://github.com/bytedance/deer-flow /tmp/deer-flow-research`
Date: 2026-06-03

---

## Claim Verification Table

| Claim | Verdict | Key Evidence |
|-------|---------|--------------|
| A: v2 collapsed to single `lead_agent` node via `make_lead_agent` | **VERIFIED** | `backend/langgraph.json`: `"graphs": {"lead_agent": "deerflow.agents:make_lead_agent"}`. Single graph, no Coordinator/Planner/Researcher/Reporter nodes. |
| B: specialization via Markdown skills lazy-loaded at `/mnt/skills/public/*/SKILL.md` | **VERIFIED with correction** | Skills live at `skills/public/*/SKILL.md` locally (host path), mounted as `/mnt/skills` in the sandbox. Loaded by `SkillStorage.load_skills(enabled_only=False)`. Progressive/lazy = skill SKILL.md files are read on-demand by the agent via file-read tools; `SummarizationMiddleware` rescues recently-loaded skill files from compression (`preserve_recent_skill_count`, `preserve_recent_skill_tokens`). NOT pre-loaded into system prompt. |
| C: subagents spawned via `task()` tool, capped at 3 concurrent by `SubagentLimitMiddleware` | **VERIFIED with correction** | `task_tool.py:186` defines `@tool("task")`. `SubagentLimitMiddleware` clamps to `[2, 4]` (not always 3): default is `MAX_CONCURRENT_SUBAGENTS=3` but configurable via `max_concurrent_subagents` and hard-clamped at 4 max. `agent.py:331-334`. Subagents run via `SubagentExecutor`; `task` tool is BLOCKED in subagents (`disallowed_tools=["task", ...]`) — no recursive nesting. |
| D: external agents via ACP — `invoke_acp_agent("codex" \| "claude_code", …)` | **VERIFIED with correction** | `invoke_acp_agent_tool.py:253` — tool is dynamically built from `config.yaml: acp_agents`. `codex` and `claude_code` are example agent names from prompt/docs, NOT hardcoded. The tool takes `agent: str` (configured name) + `prompt: str`. Requires `acp` Python package + agent binary on PATH (e.g. `codex-acp`). |
| E: `DynamicContextMiddleware` injects date + memory into first HumanMessage | **VERIFIED** | `dynamic_context_middleware.py:1-27` — injects `<system-reminder><memory>...</memory><current_date>...</current_date></system-reminder>` as a HumanMessage before the first user message. Date-change across midnight triggers a second lightweight update. System prompt stays fully static for prefix caching. |
| F: human gates = `ask_clarification` tool + `is_plan_mode` config flag | **VERIFIED with correction** | `ask_clarification` is a tool the LLM calls; `ClarificationMiddleware` intercepts it and issues `Command(goto=END)`, freezing the graph — code-enforced. `is_plan_mode` is a **run-level config flag** (not a config.yaml field) that enables `TodoMiddleware` for task tracking. These are separate concerns: clarification = human-in-loop gate; plan_mode = todo list management. |
| G: checkpointer memory/SQLite/Postgres; FastAPI+SSE; Next.js frontend | **VERIFIED** | `async_provider.py:6` — "Supported backends: memory, sqlite, postgres." SSE at `thread_runs.py:149,160,162` (`StreamingResponse`, `text/event-stream`). Frontend is Next.js (`frontend/`). |

---

## Actual Architecture

### Entry Point
- `backend/langgraph.json` → single graph `lead_agent` → `deerflow.agents:make_lead_agent`
- `backend/packages/harness/deerflow/agents/lead_agent/agent.py` — factory

### Graph Structure (agent.py)
Single LangGraph ReAct agent constructed via `langchain.agents.create_agent`. No sub-graphs. The "multi-agent" behavior comes entirely from the `task` tool calling `SubagentExecutor` out-of-band (background asyncio tasks), not from additional LangGraph nodes.

### Middleware Stack (agent.py, ordered at construction, ~line 256-340)
```
ThreadDataMiddleware          — thread_id injection
UploadsMiddleware             — file/image attachment handling
DanglingToolCallMiddleware    — patches missing ToolMessages before model sees history
SummarizationMiddleware       — context compression (EARLY, reduces tokens before others)
TodoMiddleware                — task tracking (only if is_plan_mode=True)
TitleMiddleware               — generates thread title after first exchange
MemoryMiddleware              — queues conversation for memory flush
ViewImageMiddleware           — injects image content (if model supports_vision)
DeferredToolFilterMiddleware  — hides MCP tool schemas until tool_search promotes them
SubagentLimitMiddleware       — truncates excess task() calls (only if subagent_enabled)
LoopDetectionMiddleware       — detects repetitive tool hashes, warns then strips tool_calls
SafetyFinishReasonMiddleware  — handles stop-reason edge cases
TokenUsageMiddleware          — tracks per-model-call token usage
DynamicContextMiddleware      — injects date+memory into first HumanMessage
ClarificationMiddleware       — intercepts ask_clarification → Command(goto=END)
ToolErrorHandlingMiddleware   — wraps tool execution errors
```

### Skills System
- Host path: `skills/public/<name>/SKILL.md` (YAML frontmatter + Markdown body)
- Container path: `/mnt/skills/public/<name>/SKILL.md`
- SKILL.md format: YAML frontmatter (`name`, `description`, `version`, `author`, `compatibility`) followed by Markdown with structured headers (Overview, Core Capabilities, When to Use, Methodology, etc.)
- Loading: agent reads SKILL.md files on-demand via `read_file`/`bash` tools during task execution. NOT injected into system prompt. `SummarizationMiddleware` rescues recently-accessed skill files from compression via `preserve_recent_skill_count`.
- System prompt includes a **list of available skill names + descriptions** (from `apply_prompt_template` → `skills_section`) to guide when to load them — actual content is lazy.

### Subagent Spawning (`task` tool)
- `task_tool.py:186` — `@tool("task")` async function
- Calls `SubagentExecutor` which spawns a background asyncio task
- Each subagent runs its own `_make_lead_agent` instance with restricted tool set
- `disallowed_tools=["task", "ask_clarification", "present_files"]` — no recursive nesting
- `SubagentLimitMiddleware` clamps concurrent task calls per model response to `[2, 4]` (default 3)
- Background tasks polled via `_await_subagent_terminal` with 5s sleep intervals

### ACP Integration
- `invoke_acp_agent_tool.py` — dynamically built from `config.yaml: acp_agents` entries
- Uses `acp` Python package (`from acp import PROTOCOL_VERSION, Client, text_block`)
- Spawns agent process via `spawn_agent_process` (subprocess)
- Per-thread isolated workspace: `threads/{thread_id}/acp-workspace/`
- `codex` and `claude_code` are **example** configured agent names, not hardcoded

### Checkpointer
- `async_provider.py` — factory, yields `InMemorySaver` if unconfigured
- SQLite: `langgraph.checkpoint.sqlite.aio.AsyncSqliteSaver`
- Postgres: `langgraph.checkpoint.postgres.aio.AsyncPostgresSaver` via `psycopg_pool.AsyncConnectionPool`
- Config path: `database.checkpointer_sqlite_path` or `database.postgres_connection_string`

### Gateway
- FastAPI app, `app/gateway/`
- SSE: `thread_runs.py` — `POST /threads/{id}/runs/stream` → `StreamingResponse(media_type="text/event-stream")`; aligned with LangGraph Platform SSE protocol
- Auth: `app/gateway/langgraph_auth.py`
- Channels: DingTalk, Telegram (IM adapters in `app/channels/`)

### ReAct Loop Bounds
- `recursion_limit: 100` hardcoded in `services.py:222` — applied to every graph invocation
- `LoopDetectionMiddleware`: sliding window hash; `warn_threshold` → injects "you are repeating" HumanMessage; `hard_limit` → strips all tool_calls from response, forcing terminal answer. Configured via `loop_detection` in `config.yaml`.

### Guardrails
- `docs/GUARDRAILS.md` — planned/documented middleware that evaluates every tool call against a policy before execution
- `AllowlistProvider` (`deerflow.guardrails.builtin:AllowlistProvider`) — built-in option
- Custom providers via `use:` pattern in config.yaml
- Status: documented as a feature (Issue #1213), `GUARDRAILS.md` present but no `guardrails/` package found in backend — may be in-progress or behind a feature flag

---

## Determinism: Code vs LLM-Decided

### CODE-ENFORCED (deterministic)
| What | Where | Mechanism |
|------|-------|-----------|
| `task` call cap (≤4 concurrent) | `subagent_limit_middleware.py` | Middleware truncates excess tool_calls before model sees them |
| No subagent nesting | `subagents/builtins/*.py`, `subagents/config.py` | `disallowed_tools=["task"]` at subagent construction |
| Human interrupt on clarification | `clarification_middleware.py` | `Command(goto=END)` — code route, not LLM |
| Loop break at hard_limit | `loop_detection_middleware.py` | Tool_calls stripped from AIMessage |
| Date injection into HumanMessage | `dynamic_context_middleware.py` | Code-injected before model call |
| MCP tool schema hiding | `deferred_tool_filter_middleware.py` | Schemas withheld until `tool_search` promotes |
| Recursion limit | `services.py:222` | LangGraph `recursion_limit=100` |
| ACP workspace isolation | `invoke_acp_agent_tool.py:41` | Per-thread directory path computed in code |
| Context compression trigger | `summarization_middleware.py` | Token-count threshold, code-triggered |
| Skill file rescue from compression | `summarization_middleware.py` | Code preserves N most-recent skill reads |

### LLM-DECIDED
| What | Notes |
|------|-------|
| Whether to call `task` (spawn subagent) | Prompt guidance only |
| Which subagent name to use | From configured names in prompt |
| Whether to call `ask_clarification` | Prompt lists MANDATORY scenarios but enforcement is via middleware interception, not prevention |
| Which SKILL.md to read | LLM decides based on skill name list in system prompt |
| Tool sequencing / ReAct step order | Standard ReAct loop |
| When task is "done" (final answer) | LLM decides to stop calling tools |
| Whether to invoke ACP agent | Prompt guidance |
| Todo list updates (plan_mode) | LLM calls `write_todos` |

---

## Things the Prior Pass Missed

1. **Middleware is the architecture** — The real differentiation is the ~14-middleware stack, not the graph topology. Prior pass described the graph; the middleware is where all the safety, memory, compression, deferred-tool, and concurrency logic lives.

2. **`SubagentLimitMiddleware` clamp range is [2, 4]**, not simply "capped at 3". Default is 3 but configurable with a hard ceiling of 4.

3. **Subagent nesting is code-blocked**, not just prompt-blocked. `disallowed_tools=["task"]` is set at `SubagentExecutor` construction — the `task` tool literally does not exist in subagent tool lists.

4. **`LoopDetectionMiddleware`** — a "P0 safety" middleware the prior pass missed entirely. Two-stage: warn (inject HumanMessage) then hard-break (strip tool_calls). Configured via `loop_detection` config block.

5. **`DeferredToolFilterMiddleware`** — MCP tool schemas are withheld from model binding until `tool_search` promotes them. This dramatically reduces prompt size when many MCP tools are configured.

6. **`SummarizationMiddleware` skill rescue** — `preserve_recent_skill_count` / `preserve_recent_skill_tokens` keep recently-loaded SKILL.md content from being compressed away. Critical for long agent runs that load skills mid-task.

7. **SOUL.md per-agent personality** — Each named agent can have `agents/<name>/SOUL.md` injected into its system prompt section. Behavioral guardrails live here, not in code.

8. **ACP requires external binary** — `invoke_acp_agent` is not a pure Python API call. It spawns a subprocess (`spawn_agent_process`). The `codex-acp` adapter is a separate install (`npx @zed-industries/codex-acp`).

9. **Channels system** — DingTalk and Telegram adapters in `app/channels/` with `ChannelManager` that handles `ask_clarification` interrupt messages. Prior pass made no mention of IM channel support.

10. **`is_plan_mode` is a per-run flag, not a config.yaml setting** — Passed in the run request body (`RunCreateRequest`), not in the application config. It gates `TodoMiddleware` activation.

11. **Guardrails documented but uncertain implementation status** — `docs/GUARDRAILS.md` is detailed (Issue #1213) but no `deerflow/guardrails/` package directory was found in the cloned tree. May be planned, behind a feature flag, or in an unindexed package.
