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
- Spawn by `subagent_type` (blade, gaze, ward, hound, sage, sweep, lens, archer, rival, plan-checker). **Apex picks the `model:` per spawn** — default = task-appropriate tier: cheap (`sonnet`) for mechanical & well-scoped work, escalate to session/opus for complex, ambiguous, or cross-cutting work (canonical rules: `reference/agents.md` → Model Routing). Effort is uniform `high` (session-inherited); there is no per-spawn effort param.
- `model: "haiku"` override ONLY for trivial mechanical single-file edits (rename, import, typo) — spawn `subagent_type: "blade"` with `model: "haiku"`.
- SOLO (1-3 files): single Blade, foreground
- SHADOWS (4+ files): parallel Blades with `isolation: "worktree"`
- Inject learnings corrections into every agent prompt

</subagent_law>

## Phase A: Context

> All session artifacts live under `{TEAM_DIR}/sessions/{TICKET}/` (resolves to `${PHANTOM_DATA:-~/.claude/phantom-data}/repos/{REPO_NAME}/sessions/{TICKET}/`), NOT inside the project directory. This prevents accidental git commits of phantom state.

1. Parse TICKET from $ARGUMENTS or `git branch --show-current` — a ticket is any match of `[A-Z][A-Z0-9]+-\d+` (e.g., PROJ-123). Accept any such key as-is; do not validate or resolve a project prefix.
   `--to-plan` in $ARGUMENTS → note `mode: "to-plan"` in `route-decision.json`; behavior changes ONLY at the gates (see `## Mode: --to-plan`)
2. Create `{TEAM_DIR}/sessions/{TICKET}/` — existing artifacts? ask resume or fresh
2.5. Activate subagent enforcement: `touch ${PHANTOM_DATA:-~/.claude/phantom-data}/.apex-active`
2.6. Link session to cost ledger (silent, never blocks; self-resolve {PLUGIN_ROOT} env-free: `PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"`): `[ -n "$PR" ] && node "$PR/scripts/cost-link.js" open {TICKET}` (empty `$PR` → skip silently)
3. Jira MCP → fetch ticket + AC. Load `learnings/INDEX.md` for corrections.
4. Phantom MCP → `phantom_before_edit` (non-blocking). Write `context.json`.
   Checkpoint: `[ -n "$PR" ] && node "$PR/scripts/lib/checkpoint.js" write {SESSION_DIR}/checkpoints phase-a-context` (advisory; resume reads latest; empty `$PR` skips silently).
5. Bug detected (keywords/Jira type/branch prefix) → spawn Hound agent (see `phantom:hound`) for pre-scan per `reference/detective/depth-levels.md`

## Phase B: Classify + Route

READ `reference/router.md` for full algorithm.

1. Gather signals (parallel, <5s): blast radius, patterns, novelty, history, ambiguity, AC
2. Classify: hard overrides → uncertainty → scope → learnings correction → route
3. Write `route-decision.json`. Report: `"[{ROUTE}] {rationale}"`
   Checkpoint: `[ -n "$PR" ] && node "$PR/scripts/lib/checkpoint.js" write {SESSION_DIR}/checkpoints phase-b-route` (advisory; resume reads latest; empty `$PR` skips silently).

## Route: DIRECT (0 gates)

1. Write `intent.json` with task scope
2. Activate blade marker: `touch ${PHANTOM_DATA:-~/.claude/phantom-data}/.blade-editing`
3. **Spawn Blade agent** via Agent tool:
   ```
   Agent call:
     description: "Blade: {1-line task summary}"
     subagent_type: "blade"
     mode: "bypassPermissions"
     # model: Apex picks per Model Routing (default: task-appropriate tier — sonnet for mechanical/well-scoped, escalate to session/opus for complex). effort = session high.
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
3. **HUMAN GATE**: approve plan (`--to-plan` mode: this gate is replaced per `## Mode: --to-plan`)
   Checkpoint: `[ -n "$PR" ] && node "$PR/scripts/lib/checkpoint.js" write {SESSION_DIR}/checkpoints plan-gate-approved` (advisory; resume reads latest; empty `$PR` skips silently).
4. Contracts. >5 files → `Skill(skill="phantom:wire")`.
5. **Spawn Blade(s)** via `Skill(skill="phantom:execute")` — execute spawns agents per plan
6. `Skill(skill="phantom:verify", args="--chained")` → on FAIL verify threads `--chained` through to `Skill(skill="phantom:fix")` (re-verifies internally; loop ceiling owned by `hooks/loop-controller.js`) → on PASS flow straight to `Skill(skill="phantom:wrap")`. No human return between verify/fix/wrap — wrap proceeds autonomously to a **draft PR**; the human gate is post-PR (review the draft, mark it ready-to-review).

## Route: BRAINSTORM (2 gates)

`Skill(skill="phantom:brainstorm")` → **GATE 1** (pick direction)
Checkpoint: `[ -n "$PR" ] && node "$PR/scripts/lib/checkpoint.js" write {SESSION_DIR}/checkpoints brainstorm-gate1-approved` (advisory; resume reads latest; empty `$PR` skips silently).
→ PLAN route → **GATE 2** (approve plan)

## Route: FULL (3 gates)

`Skill(skill="phantom:brainstorm")` → **GATE 1** → Plan → **GATE 2** → `Skill(skill="phantom:wire")` → **GATE 3** → `Skill(skill="phantom:execute")` → `Skill(skill="phantom:verify", args="--chained")` → on FAIL verify threads `--chained` through to `Skill(skill="phantom:fix")` (re-verifies internally; loop ceiling owned by `hooks/loop-controller.js`) → on PASS `Skill(skill="phantom:wrap")`. No human return between verify/fix/wrap — wrap proceeds autonomously to a **draft PR**; the human gate is post-PR (review the draft, mark it ready-to-review).

## Auto-chaining (default flow)

Phases chain autonomously without returning to the human between phases. The only stops are: (a) the PLAN/FULL plan-approval gate(s) and (b) fix-loop exhaustion (ceiling owned by `hooks/loop-controller.js`). Wrap proceeds autonomously to a **draft PR** with no ship confirmation; the human gate is post-PR (review the draft, mark it ready-to-review). On verify PASS the chain auto-continues to wrap; on verify FAIL it auto-invokes the fix-loop, then re-verifies — it does not wait for the human to type the next phase.

> The `args="--chained"` token threaded into the `phantom:verify` calls above is what makes verify/fix run autonomously (auto-invoke fix, auto-proceed past fix-packet approval). Its ABSENCE is the safe standalone default: verify/fix fall back to gated report+suggest and wait for the human. So a dropped token degrades to MORE gating, never less.

Between phases: if heavy context, `Skill(skill="phantom:pause")`. Resume reads `route-decision.json`.

## Mode: --to-plan (plan-only, no human present)

Activated when $ARGUMENTS contains `--to-plan` (noted in `route-decision.json` at Phase A step 1). Planning runs headless and produces a plan only — it NEVER executes. There is no queue: the plan lands in the session dir as `plan.json` and the run stops.

> The flag's ABSENCE is the safe default: without `--to-plan` the gated flow above applies unchanged, so a dropped flag degrades to MORE gating, never less. In this mode NOTHING EVER EXECUTES — no Blade implementation spawns, no verify, no fix, no wrap, no git mutations, no `.blade-editing` marker. This mode creates NO worktree; it runs in the normal repo (the session dir already lives outside the repo).

**Route collapse:**
- DIRECT → still produce a minimal `plan.json` (plan-only — even trivial work produces a plan).
- BRAINSTORM / FULL → collapse to PLAN-grade planning. No human is present to pick a direction: pick the conservative option and record the alternatives in the plan for the human who reviews it later.

**Headless contract:**
- NEVER ask the user questions in this mode. Pick recommended defaults; record every assumption made in an `assumptions[]` array inside `plan.json`.
- If nested agent spawns are unavailable in the runtime, run plan-checker/rival-grade self-checks INLINE — degradation is acceptable because a human still reviews the plan before any execution.

**Inline self-checks:**
- Run plan-checker + rival review of `plan.json` INLINE. On failure: revise ONCE, then record the finding anyway in `plan.json` with `selfCheck: "flagged"` + a finding summary. A human decides later.

**EXIT:** write `plan.json` to the session dir, then print exactly one report line — `[PLANNED] {TICKET} — {N} files, {summary}` — and STOP. Prohibited in this mode: Blade implementation spawns, verify, fix, wrap, git mutations, `.blade-editing` marker, worktree creation.
