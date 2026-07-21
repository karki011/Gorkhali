# Claude Agent SDK — Harness Survey for Phantom
**Author: Subash Karki**
**Date: 2026-06-03**
**Status: Decision Research**

> Historical note (2026-07-21): this survey predates the removal of Phantom's
> manual `install.sh` path. References below to that installer describe the
> architecture evaluated at the time, not the current plugin distribution.

---

## 1. What the Claude Agent SDK Is

The Claude Agent SDK (renamed from Claude Code SDK in March 2026) is the same runtime that powers Claude Code, exposed as a library. Available as:

- TypeScript: `@anthropic-ai/claude-agent-sdk`
- Python: `claude-agent-sdk`

It bundles a native Claude Code binary for the host platform as an optional dependency — you do not need a separate Claude Code install to use it. The SDK gives you programmatic access to the full agent loop that Claude Code runs internally.

**What you get that raw plugin Markdown does NOT:**

| Capability | Plugin (Markdown + hooks.json) | Agent SDK |
|---|---|---|
| Subagent spawn logic | Probabilistic — Claude decides when/if | Deterministic code — you call `query()` with specific subagent config |
| Tool definitions | String list in YAML frontmatter | Typed Zod/Pydantic schemas; validated at call-time |
| Gate decisions | Claude interprets natural language rules | Code `if/else` — no interpretation layer |
| Structured outputs | Not guaranteed — prompt-based | `get structured output from agents` — Zod/Pydantic schema enforced |
| Session control | Implicit per-conversation | Explicit `continue_conversation=True`, resume sessions, ceiling `max_tokens` |
| Hooks | hooks.json shell commands | Programmatic callbacks in code; same event surface (PreToolUse, PostToolUse, Stop, etc.) |
| Context compaction | Auto-compact via Claude Code settings | 5-layer pipeline: budget reduction → snip → microcompact → context collapse → auto-compact; configurable per session |
| Error handling | Claude retries heuristically | Try/catch in code; explicit retry budgets |
| Orchestration audit | Log files, learnings .md files | Structured execution trace; can write to any sink |
| Fan-out cap | No enforced cap | Up to 1,000 subagents (v2.1.154+ research preview) |
| MCP caching | Auto-disabled when MCP configured | `cache_mcp: true` for deterministic MCP tools (code search, static KBs) |

---

## 2. Subagents: SDK vs. Phantom's Current Model

**Current Phantom (Markdown-driven):**
- `execute.md` reads plan.json, then instructs Claude in natural language to "spawn parallel blade agents for independent files"
- Claude interprets those instructions and decides whether/when/how many subagents to spawn
- Agent description field + `allowed-tools` YAML guide Claude's decision — probabilistic
- Corrections/constraints (anti-repetition, SHADOWS threshold, isolations) are English sentences Claude must re-parse each session

**SDK subagent model:**
```typescript
// Deterministic: you decide when to fan out, not Claude
const results = await Promise.all(
  tasks.map(task => query({ prompt: task.prompt, agent: bladeConfig, maxTokens: 8000 }))
);
```
- Each subagent runs in its own fresh conversation; parent gets only final message
- `allowedTools` enforced at SDK level — not re-interpreted by model
- Subagents can spawn their own subagents if `Agent` is in their `allowedTools` (deliberate, not accidental)
- Parallelism is `Promise.all` in code — not a Claude judgment call

**Key SDK limitation vs. current Phantom:**
- SDK subagents cannot self-launch a subagent unless you explicitly grant `Agent` in their tools
- In Phantom, Apex currently asks Claude to "dispatch blade agents" — the SDK makes this explicit code rather than a soft prompt law

---

## 3. Hooks: SDK vs. Plugin hooks.json

**Phantom's current hooks.json uses:**
- `Stop` → `memory-writer.js`
- `PreToolUse` (Edit/Write) → `apex-subagent-driven-law.sh` (shell enforcement)
- `UserPromptSubmit` → `memory-reader.js`
- `PreCompact` → `memory-consolidator.js` + `context-compact-guide.sh`

**SDK hook system:**
- Same 12 lifecycle events (PreToolUse, PostToolUse, Stop, PreCompact, UserPromptSubmit, SessionStart, Notification, PermissionRequest, etc.)
- Configured programmatically in `ClaudeAgentOptions.hooks` — TypeScript functions, not shell scripts
- PreToolUse returns `{ action: 'allow' | 'deny' | 'ask' | 'defer', input?: modified_input }` — typed, not stdout parsing
- PostToolUse can inject structured feedback into agent context
- Enterprise `allowManagedHooksOnly` blocks user/project hooks but exempts force-enabled plugin hooks — Phantom's plugin hooks would survive that policy

**What changes:**
- Shell scripts (`apex-subagent-driven-law.sh`) → typed TS functions with compile-time guarantees
- Memory read/write hooks → same logic but debuggable in a standard TS/Node stack
- No functional expansion; same events, less parse overhead

---

## 4. Three Options for Phantom

### Option A: Stay Pure Markdown + Plugin Hooks (Status Quo)

**Architecture:** All orchestration in `.md` files + hooks.json shell scripts. Distributed as `@cloudzero/phantom` plugin.

**Gains:**
- Zero infra: `plugin install` and done
- Claude Code ships the runtime; Phantom ships only text + scripts
- Updates propagate via plugin install with no build/deploy step
- Works offline, no server, no container
- All 34 commands + 12 agents + 14 hook files fit in the plugin dir
- Full access to every new Claude Code feature on day-0 (SDK often lags CLI by weeks)

**Loses:**
- Orchestration decisions are probabilistic — Claude can misinterpret a rule, skip a SHADOWS threshold, spawn wrong agent model
- Gate decisions expressed as English instructions; any context-window pressure degrades enforcement
- No compile-time guarantee that `blade` gets spawned with `opus` for complex tasks
- Debugging requires reading `.md` files and inferring why Claude chose a path
- Fan-out logic (`4+ files → parallel`) requires Claude to count and decide each time
- Error handling is "if Claude notices, it retries" — no structured retry budget

**Verdict on determinism:** Low. Phantom currently papers over this with 14 constraint rules in `_shared.md`, a `Rival` agent that challenges plans, learnings INDEX scanning, etc. — all compensating for the non-determinism.

---

### Option B: Full Claude Agent SDK App

**Architecture:** Phantom becomes a TypeScript/Node.js application that users install and run. The plugin layer (commands, agents, hooks) is replaced by SDK code. Distribution is npm package or binary.

**Gains:**
- Orchestration logic is code: fan-out is `Promise.all`, gates are `if/else`, model selection is a variable
- Typed tool definitions with Zod schemas — structured outputs validated at call boundary
- Session control explicit: continue/resume with typed API
- Hooks are TS functions — full debuggability, unit-testable
- Context compaction configurable per-session in code
- Retry budgets in code: `while (attempts < 3 && !success)`
- Execution traces writable to any sink (Jira, Slack, metrics)
- 1,000-subagent fan-out cap with code-controlled scheduling

**Loses:**
- **Kills the zero-infra property.** Users must install and run a separate process.
- Plugin marketplace install (`/plugin install`) no longer works
- Phantom's "lives inside Claude Code" property gone — it becomes a CLI or daemon users launch separately
- Build/release pipeline needed for every change
- Container/sandbox requirement for production use (SDK docs recommend isolation)
- SDK typically lags Claude Code CLI on new features by weeks (SDK was renamed in March 2026; some CLI features still CLI-only)
- Context window management that Claude Code does automatically must be re-implemented
- User mental model shifts: from "I have a plugin" to "I run another tool"

**Verdict:** Full migration destroys Phantom's killer property. The determinism gains are real but do not justify losing zero-infra distribution unless Phantom is explicitly productized as a standalone tool.

---

### Option C: Hybrid — Plugin Shell + SDK Sidecar for Hot Orchestration Paths (Recommended)

**Architecture:** Keep the plugin (all 34 commands, 12 agents, hooks.json). Extract the highest-variance orchestration paths into a small SDK-backed sidecar — a local Node.js process that Phantom's hooks and commands can call via HTTP or stdin/stdout. The sidecar is bundled in the plugin dir; `install.sh` runs `npm install` once.

**Example hot paths to code-ify:**
1. **Fan-out gating**: Instead of English "if 4+ files spawn parallel" in execute.md, a hook calls `sidecar/fan-out.ts` which reads the plan, counts tasks by isolation group, returns typed `{ route: 'SOLO' | 'SHADOWS', agents: AgentConfig[] }`.
2. **Model selection**: Currently a soft law in execute.md. Sidecar exposes `selectModel(task): 'opus' | 'haiku'` based on task classifier — deterministic, unit-testable.
3. **Memory consolidation**: `memory-consolidator.js` already exists in hooks — migrate it to typed SDK session continuation with explicit compaction strategy per session.
4. **Gate enforcement** (`apex-subagent-driven-law.sh`): Replace shell `exit 2` with a sidecar hook that returns typed `{ action: 'deny', reason: string }` — no shell parsing.

**How distribution works:**
- Plugin still installs via `plugin install` — zero external infra for the user
- `install.sh` runs `npm ci` in the plugin dir (already has `package.json`)
- Sidecar is a local process started by a `SessionStart` hook, stopped by `Stop` hook
- Commands call sidecar via `localhost:PORT` or named pipe — no internet required
- Plugin update = pull new plugin version → restart sidecar

**Gains:**
- Keeps zero-infra install model
- Deterministic on the 20% of paths that account for 80% of observed non-determinism (fan-out, model selection, gate enforcement)
- Typed contracts between plugin commands and sidecar — breakage is a compile error, not a Claude misread
- Hooks become typed TS functions inside sidecar rather than disconnected shell scripts
- Unit-testable: `test/fan-out.test.ts`, `test/model-selector.test.ts`
- SDK's structured outputs available for sidecar→plugin communication
- Sidecar can use `continue_conversation=True` for multi-step sessions where context must persist

**Loses:**
- Sidecar adds a process management surface (start/stop, port conflicts, crash recovery)
- Plugin complexity increases: hooks.json calls a running process, not a static script
- `npm ci` in install.sh adds ~2-3s to first install (acceptable)
- Sidecar crash leaves plugin commands hitting a dead endpoint — need graceful degradation

**Degradation strategy:** Every sidecar call has a fallback path. If sidecar is unreachable, plugin falls back to current Markdown-driven behavior. Determinism is best-effort with graceful degradation — not a hard dependency.

---

## 5. Top 3 SDK Features Worth Adopting Regardless of Architecture Choice

These are worth pulling into Phantom's codebase even if staying on Option A, either via the sidecar in Option C or direct adoption.

### 1. Typed Structured Outputs for Agent→Parent Communication
Currently, blade agents return free-text summaries that Apex parses heuristically. SDK structured outputs with Zod schemas give you `AgentResult { status: 'pass' | 'fail', files_changed: string[], test_result: TestResult, blocker?: string }` — typed, validated, composable. This alone would fix the "blade succeeded but Apex misread the output" failure class.

### 2. Programmatic Session Continuation with Explicit Compaction Strategy
Phantom's PreCompact hooks run `memory-consolidator.js` to preserve context across compaction. The SDK exposes the full 5-layer compaction pipeline as configurable options per session, plus `continue_conversation=True` for explicit session threading. Migrating the memory consolidation path here makes it debuggable and removes shell-script parse brittleness.

### 3. PreToolUse Hooks with Typed Return (allow/deny/ask/defer + input modification)
Phantom's `apex-subagent-driven-law.sh` currently uses `exit 2` to block writes and relies on shell stdout parsing. SDK PreToolUse hooks return `{ action: 'deny', reason: string }` or `{ action: 'allow', input: modified_input }` — typed, testable, and can modify tool input (e.g., enforce file path constraints) rather than just blocking. This would replace the shell-based gate with a proper typed gate.

---

## Recommendation: Option C — Hybrid Plugin + SDK Sidecar

**Pick:** Hybrid (Option C).

**Justification:** Phantom's zero-infra plugin install is its most defensible property — it is what makes Phantom accessible to every CloudZero engineer with a Claude Code license, without coordination, IT tickets, or infra. Full SDK migration (Option B) destroys this property for determinism gains that, while real, only affect the 20% of orchestration decisions that account for most observed failures. Option A (status quo) leaves those failures unaddressed and accumulates correction debt in learnings/ files. The hybrid preserves distribution while surgically targeting the non-deterministic paths — fan-out gating, model selection, and gate enforcement — with code. The sidecar is already structurally possible: `package.json` exists, `install.sh` exists, hooks exist, and the three hot-path modules are already identified. The sidecar degrades gracefully to Markdown-driven behavior if the process is absent, meaning the plugin remains functional even during sidecar development. Start with the three SDK features above as the first sidecar modules; validate that the determinism improvement is real before expanding scope.

---

## References

- [Subagents in the SDK](https://code.claude.com/docs/en/agent-sdk/subagents)
- [Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Plugins in the SDK](https://platform.claude.com/docs/en/agent-sdk/plugins)
- [Hooks — intercept and control agent behavior](https://platform.claude.com/docs/en/agent-sdk/hooks)
- [Structured outputs from agents](https://platform.claude.com/docs/en/agent-sdk/structured-outputs)
- [Claude Code vs Claude Agent SDK (Augment Code)](https://www.augmentcode.com/tools/claude-code-vs-claude-agent-sdk)
- [Hosting the Agent SDK](https://platform.claude.com/docs/en/agent-sdk/hosting)
- [Building agents with the Claude Agent SDK (Anthropic Engineering)](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
- [Scaling Managed Agents (Anthropic Engineering)](https://www.anthropic.com/engineering/managed-agents)
- [Claude Code Hooks guide](https://code.claude.com/docs/en/hooks)
