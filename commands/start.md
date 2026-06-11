---
name: phantom:start
description: "Use when starting any new feature, bug fix, refactor, or task. Also use when user provides a Jira ticket key (e.g., PROJ-123), says 'implement', 'build', 'fix', 'work on', or describes a requirement. Plans, decomposes, and executes with multi-agent shadows."
argument-hint: "<requirement>"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
---

> **Preamble Tier: T4** (full orchestration -- loads ALL shared contexts)
> See `_shared.md` SS Preamble Tiers for the tier system.

# /phantom:start "$ARGUMENTS"

Adaptive router: context → classify → route(DIRECT|PLAN|BRAINSTORM|FULL) → verify.
Each phase reads/writes artifacts in `{TEAM_DIR}/sessions/{TICKET}/`.
No git operations until wrap. All work is local.

> **Tip:** Run `/effort high` before starting. Phantom runs every agent at `high` (Apex pinned). Avoid `ultracode`/`xhigh` — under ultracode the runtime can wrap a gated phase in a background workflow that takes no mid-run input, silently bypassing Phantom's approval gates.
>
> Run the session on Fable 5 (recommended) — its improved tool triggering and compaction recovery make the subagent-driven flow and pause/resume more reliable. Agents inherit the session model unless their definition pins one.

<subagent_law>

## CORE DISCIPLINE: Subagent-Driven Work

**The main LLM (Apex) NEVER implements code directly.** All code changes go through the Agent tool.

- **Phase A + B:** Apex gathers context and classifies. This is coordinator work — read files, call MCP tools, write session artifacts. This is fine.
- **Implementation:** ALWAYS spawn Blade agent(s) via the Agent tool. Apex writes `intent.json`, `plan.json`, `contracts/` — but NEVER edits project source files.
- **If you catch yourself about to call Edit/Write on a project file:** STOP. Spawn a Blade instead.

Agent spawn rules (all routes):
- `mode: "bypassPermissions"` — always
- Spawn by `subagent_type` (blade, gaze, ward, hound, sage, sweep, lens, archer, rival, plan-checker). **Apex picks the `model:` per spawn** — default omit (inherits session model; Fable 5 recommended), `sonnet` for small, well-scoped subtasks (see `reference/agents.md` → Model Routing). Effort is uniform `high` (session-inherited); there is no per-spawn effort param.
- `model: "haiku"` override ONLY for trivial mechanical single-file edits (rename, import, typo) — spawn `subagent_type: "blade"` with `model: "haiku"`.
- SOLO (1-3 files): single Blade, foreground
- SHADOWS (4+ files): parallel Blades with `isolation: "worktree"`
- Inject learnings corrections into every agent prompt

</subagent_law>

## Phase A: Context

> All session artifacts live under `{TEAM_DIR}/sessions/{TICKET}/` (resolves to `${PHANTOM_DATA:-~/.claude/phantom-data}/repos/{REPO_NAME}/sessions/{TICKET}/`), NOT inside the project directory. This prevents accidental git commits of phantom state.

1. Parse TICKET from $ARGUMENTS or `git branch --show-current` — a ticket is any match of `[A-Z][A-Z0-9]+-\d+` (e.g., PROJ-123); resolve the expected project key from `jira.project` in config.yaml at runtime, never hardcode prefixes
2. Create `{TEAM_DIR}/sessions/{TICKET}/` — existing artifacts? ask resume or fresh
2.5. Activate subagent enforcement: `touch ${PHANTOM_DATA:-~/.claude/phantom-data}/.apex-active`
3. Jira MCP → fetch ticket + AC. Load `learnings/INDEX.md` for corrections.
4. Phantom MCP → `phantom_before_edit` (non-blocking). Write `context.json`.
5. Bug detected (keywords/Jira type/branch prefix) → spawn Hound agent (see `phantom:hound`) for pre-scan per `reference/detective/depth-levels.md`

## Phase B: Classify + Route

READ `reference/router.md` for full algorithm.

1. Gather signals (parallel, <5s): blast radius, patterns, novelty, history, ambiguity, AC
2. Classify: hard overrides → uncertainty → scope → learnings correction → route
3. Write `route-decision.json`. Report: `"[{ROUTE}] {rationale}"`

## Route: DIRECT (0 gates)

1. Write `intent.json` with task scope
2. Activate blade marker: `touch ${PHANTOM_DATA:-~/.claude/phantom-data}/.blade-editing`
3. **Spawn Blade agent** via Agent tool:
   ```
   Agent call:
     description: "Blade: {1-line task summary}"
     subagent_type: "blade"
     mode: "bypassPermissions"
     # model: Apex picks per Model Routing (default: omit → inherits session model; sonnet for small, well-scoped). effort = session high.
     prompt: |
       You are a BLADE — implementation agent.
       {task description from intent.json}
       {acceptance criteria from Jira}
       {relevant learnings/corrections}
       {file paths to modify}
       Self-review your changes before returning.
   ```
4. Deactivate blade marker: `rm -f ${PHANTOM_DATA:-~/.claude/phantom-data}/.blade-editing`
5. After Blade returns → `Skill(skill="phantom:verify", args="--chained")` (chained flow).
   - **PASS → AUTO-CONTINUE** to `Skill(skill="phantom:wrap")`. Do NOT return to the human here.
   - **FAIL → verify threads** `--chained` through to `Skill(skill="phantom:fix")` (re-verifies internally; loop ceiling owned by `hooks/loop-controller.js`) → on PASS, AUTO-CONTINUE to `Skill(skill="phantom:wrap")`.
6. Escalation path AFTER the fix-loop is exhausted (not the immediate response): escalate to PLAN route. >3 files touched → log correction.

## Route: PLAN (1 gate)

1. Intent → research → plan (per `reference/planning.md`, `reference/agents.md`)
2. Deliberation: Planner ↔ Challenger, 2 rounds (router.md)
3. **HUMAN GATE**: approve plan
4. Contracts. >5 files → `Skill(skill="phantom:wire")`.
5. **Spawn Blade(s)** via `Skill(skill="phantom:execute")` — execute spawns agents per plan
6. `Skill(skill="phantom:verify", args="--chained")` → on FAIL verify threads `--chained` through to `Skill(skill="phantom:fix")` (re-verifies internally; loop ceiling owned by `hooks/loop-controller.js`) → on PASS flow straight to `Skill(skill="phantom:wrap")`. No human return between verify/fix/wrap except the wrap ship gate.

## Route: BRAINSTORM (2 gates)

`Skill(skill="phantom:brainstorm")` → **GATE 1** (pick direction) → PLAN route → **GATE 2** (approve plan)

## Route: FULL (3 gates)

`Skill(skill="phantom:brainstorm")` → **GATE 1** → Plan → **GATE 2** → `Skill(skill="phantom:wire")` → **GATE 3** → `Skill(skill="phantom:execute")` → `Skill(skill="phantom:verify", args="--chained")` → on FAIL verify threads `--chained` through to `Skill(skill="phantom:fix")` (re-verifies internally; loop ceiling owned by `hooks/loop-controller.js`) → on PASS `Skill(skill="phantom:wrap")`. No human return between verify/fix/wrap except the wrap ship gate.

## Auto-chaining (default flow)

Phases chain autonomously without returning to the human between phases. The only stops are: (a) the PLAN/FULL plan-approval gate(s), (b) the wrap ship/git gate, and (c) fix-loop exhaustion (ceiling owned by `hooks/loop-controller.js`). On verify PASS the chain auto-continues to wrap; on verify FAIL it auto-invokes the fix-loop, then re-verifies — it does not wait for the human to type the next phase.

> The `args="--chained"` token threaded into the `phantom:verify` calls above is what makes verify/fix run autonomously (auto-invoke fix, auto-proceed past fix-packet approval). Its ABSENCE is the safe standalone default: verify/fix fall back to gated report+suggest and wait for the human. So a dropped token degrades to MORE gating, never less.

Between phases: if heavy context, `Skill(skill="phantom:pause")`. Resume reads `route-decision.json`.
