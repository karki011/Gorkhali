---
name: start
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
> Run the session on Opus 5 (recommended) - its stronger instruction-following, built-in self-verification, and fewer steers make the subagent-driven flow and pause/resume more reliable. Agents inherit the session model unless their definition pins one.

<subagent_law>

## CORE DISCIPLINE: Subagent-Driven Work

**The main LLM (Apex) NEVER implements code directly.** All code changes go through the Agent tool.

- **Phase A + B:** Apex gathers context and classifies. This is coordinator work — read files, call MCP tools, write session artifacts. This is fine.
- **Implementation:** ALWAYS spawn Blade agent(s) via the Agent tool. Apex writes `intent.json`, `plan.json`, `contracts/` — but NEVER edits project source files.
- **If you catch yourself about to call Edit/Write on a project file:** STOP. Spawn a Blade instead.

Agent spawn rules (all routes):
- `mode: "bypassPermissions"` — always
- Spawn by `subagent_type` (blade, gaze, ward, hound, sage, sweep, lens, archer, rival, plan-checker). **Apex picks the `model:` per spawn** — default = task-appropriate tier: cheap (`sonnet`) for mechanical & well-scoped work, escalate to opus (implementer ceiling - never fable) for complex, ambiguous, or cross-cutting work (canonical rules: `reference/agents.md` → Model Routing). Effort is uniform `high` (session-inherited); there is no per-spawn effort param. Before each spawn, write the one-line scope check (`scope: … · floor-sufficient? … · reason`) from `reference/agents.md` → Model Routing, visibly in Apex's output. Escalation above the floor without a concrete per-subtask reason is a routing error.
- `model: "haiku"` override ONLY for trivial mechanical single-file edits (rename, import, typo) — spawn `subagent_type: "blade"` with `model: "haiku"`.
- SOLO (1-3 files): single Blade, foreground
- SHADOWS (4+ files): parallel Blades with `isolation: "worktree"`
- Inject learnings corrections into every agent prompt

</subagent_law>

## Phase A: Context

> All session artifacts live under `{TEAM_DIR}/sessions/{TICKET}/` (resolves to `${PHANTOM_DATA:-~/.phantom}/repos/{REPO_NAME}/sessions/{TICKET}/`), NOT inside the project directory. This prevents accidental git commits of phantom state.

1. Parse TICKET from $ARGUMENTS or `git branch --show-current` — a ticket is any match of `[A-Z][A-Z0-9]+-\d+` (e.g., PROJ-123). Accept any such key as-is; do not validate or resolve a project prefix.
   `--to-plan` in $ARGUMENTS → note `mode: "to-plan"` in `route-decision.json`; behavior changes ONLY at the gates (see `## Mode: --to-plan`)
2. Create `{TEAM_DIR}/sessions/{TICKET}/` — existing artifacts? ask resume or fresh
2.5. Activate subagent enforcement and point the wake queue at this session (hooks can't inherit Apex env). Create the mutable data root lazily so a fresh plugin install needs no setup step. The pointer is scoped per-repo so a session in another repo can't clobber it — compute the repo name with the same `detectRepo` the consumer uses, and fall back to the bare pointer if it can't be resolved: `ROOT="${PHANTOM_DATA:-$HOME/.phantom}"; D="$ROOT/state"; mkdir -p "$D"; touch "$ROOT/.apex-active"; PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"; REPO="$([ -n "$PR" ] && node -e 'process.stdout.write(require(process.argv[1]+"/scripts/lib/phantom-paths").detectRepo())' "$PR" 2>/dev/null || true)"; printf '%s' "{TEAM_DIR}/sessions/{TICKET}" > "$D/.active-wake-session${REPO:+.$REPO}"`
2.6. Link session to cost ledger (silent, never blocks; self-resolve {PLUGIN_ROOT} env-free: `PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"`): `[ -n "$PR" ] && node "$PR/scripts/cost-link.js" open {TICKET}` (empty `$PR` → skip silently)
3. Jira MCP → fetch ticket + AC. Load `learnings/INDEX.md` for corrections.
3.2. **Jira lifecycle sync** (only when TICKET matches `[A-Z][A-Z0-9]+-\d+`; slug sessions skip silently). In order:
   a. **Assign**: `atlassianUserInfo` → accountId; assign only when the ticket's `assignee` is null/empty OR `assignee.accountId` differs from it, via `editJiraIssue` to set it to the current user; already-mine → true skip, no redundant edit. Record as `assigned | already-mine | reassigned | skipped | unavailable` (reassigned = taken over from another assignee).
   b. **Transition**: `getTransitionsForJiraIssue`, match a transition named "In Progress", "Start Progress", "In Development", or "Doing" (case-insensitive); already in an in-progress-like status → skip with a note; ticket in a terminal status (Done/Closed/Resolved) → skip with a note (never reopen); matched → `transitionJiraIssue`; no name matches → skip with a note (workflow differs) - never error, never force-pick. Honor `jira.auto_transition` from the real reader (`PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"; [ -n "$PR" ] && node "$PR/scripts/phantom-config.js" get jira.auto_transition`): skip the transition, not the assignment, ONLY when it prints exactly `false`; unset prints nothing (exit 1) so the transition proceeds, mirroring `commands/close.md`.
   c. **Label**: read `tracker.label` from the real reader (`PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"; [ -n "$PR" ] && node "$PR/scripts/phantom-config.js" get tracker.label`).
      Unset prints nothing (exit 1), which means stamp NO label at all - record `skipped` and move on.
      The label is a tracker-level concept and each provider applies it its own way; Jira is the only provider implemented today and its mechanism is the awkward one.
      **Jira**: `getJiraIssue` returns `labels` in its default read field set, so take the current array from the ticket already fetched at step 3, and when the label is absent call `editJiraIssue` with the full existing array plus the label appended.
      NEVER send `labels` containing only the new label: `editJiraIssue` takes a `fields` object with SET semantics and its MCP schema has no `update` verb, so there is no additive `{labels: [{add: ...}]}` form and a partial array DELETES every other label on the ticket.
      Label already present → true skip, no redundant edit, exactly as (a) skips an already-mine assignment.
      **GitHub** (when that provider lands): `gh issue edit --add-label` is genuinely additive, so it needs no read-modify-write - do not copy Jira's careful dance where it is unnecessary.
      Record as `labeled | already-present | skipped | unavailable`.
   d. **Guard** (non-blocking, independent per step): a, b, and c are guarded separately - unavailability or a failure in one never blocks the others from running, and a label failure never blocks the session. Log one line per failure and continue. Record each outcome independently (`assigned` result, transition result, and label result) in the `jira` block of `context.json` at step 4.
3.5. Brain recall (optional, on-demand — never preloaded): grep `{TEAM_DIR}/brain/cards/`
     by TICKET and touched file paths (recipes: `_shared-brain.md`). Cite matched card
     `id`s in `context.json`; no matches → skip silently.
   Checkpoint: `PR="${PR:-$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)}"; PR="${PR%/}"; if [ -n "$PR" ]; then printf '%s\n' '{"ticket":"{TICKET}"}' | node "$PR/scripts/lib/checkpoint.js" write {SESSION_DIR}/checkpoints phase-a-context || :; fi` (advisory; resume reads latest; empty `$PR` skips silently).
4. **Defect proof gate**: bug/defect/incident/regression detected by keywords,
   Jira type, or branch prefix → classify `workKind: "investigation"` in
   `context.json` and `intent.json`, then spawn Hound (`subagent_type: "hound"`,
   `name: "hound-corva"` per `reference/roster.md`) and write
   `{SESSION_DIR}/defect-proof.json` per `reference/defect-proof.md`.
   - Before any Blade mutation, require observed reproduction evidence and a
     traced root-cause claim confirmed by the user. Only
     `ready_for_fix` / `confirmed_defect` may proceed.
   - Inconclusive or conflicting proof MUST become
     `waiting_for_evidence` / `unconfirmed_defect`; record the missing evidence
     and next observation, then STOP before Blade dispatch.
   - Diagnostic instrumentation is denied unless a recorded, unexpired
     `DiagnosticGrant` names the objective, actions, paths, expiry, and cleanup.
     The grant authorizes only that reversible evidence collection; it never
     authorizes a fix or changes the verdict. Resume the proof gate after
     diagnostics.

## Phase B: Classify + Route

READ `reference/router.md` for full algorithm.

1. Gather signals (parallel, <5s): blast radius, patterns, novelty, history, ambiguity, AC
2. Classify: hard overrides → uncertainty → scope → learnings correction → route
3. Write `route-decision.json`. Report: `"[{ROUTE}] {rationale}"`
   Checkpoint: `PR="${PR:-$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)}"; PR="${PR%/}"; if [ -n "$PR" ]; then printf '%s\n' '{"ticket":"{TICKET}"}' | node "$PR/scripts/lib/checkpoint.js" write {SESSION_DIR}/checkpoints phase-b-route || :; fi` (advisory; resume reads latest; empty `$PR` skips silently).

## Route: DIRECT (0 gates)

1. Write `intent.json` with task scope. If `workKind` is `investigation`, reread
   `{SESSION_DIR}/defect-proof.json` and require the complete
   `ready_for_fix` / `confirmed_defect` contract from
   `reference/defect-proof.md`; otherwise STOP in
   `waiting_for_evidence` / `unconfirmed_defect`.
2. Per-spawn Blade lifecycle state is owned by validated hooks.
2.5. **Dispatch table (mandatory, before the spawn below):** render the pre-dispatch routing
   table exactly as defined in `reference/agents.md` → Pre-Dispatch Routing Table, populated
   from `intent.json` (file targets) and the roster-assigned `name` (`blade-doven`, DIRECT's
   fixed slot per `reference/roster.md` Spawn-Site Slot Table). `Wave` is always `1` for DIRECT
   — there is no wave fan-out.
3. **Spawn Blade agent** via Agent tool:
   ```
   Agent call:
     description: "Blade: {1-line task summary}"
     subagent_type: "blade"
     name: "blade-doven"
     mode: "bypassPermissions"
     # model: Apex picks per Model Routing (default: task-appropriate tier — sonnet for mechanical/well-scoped, escalate to opus (implementer ceiling - never fable) for complex). effort = session high.
     prompt: |
       You are a BLADE — implementation agent.
       {task description from intent.json}
       {acceptance criteria from Jira}
       {relevant learnings/corrections}
       {file paths to modify}
       Self-review your changes before returning.
   ```
4. Wait for the Blade's durable result.
5. After Blade returns → independent
   `Skill(skill="phantom:verify", args="--chained")` (chained flow). For a
   confirmed defect, the verifier must rerun the recorded reproduction and the
   focused regression check. The implementing Blade's self-review or test
   result is not independent verification. Before marking the direct scope
   done, write its independent
   `{SESSION_DIR}/scope-verifications/{task-id}.json` record per
   `reference/defect-proof.md`.
   - **PASS → AUTO-CONTINUE** to `Skill(skill="phantom:wrap")`. Do NOT return to the human here.
   - **FAIL → verify threads** `--chained` through to `Skill(skill="phantom:fix")` (re-verifies internally; loop ceiling owned by `hooks/loop-controller.js`) → on PASS, AUTO-CONTINUE to `Skill(skill="phantom:wrap")`.
6. Escalation path AFTER the fix-loop is exhausted (not the immediate response): escalate to PLAN route. >3 files touched → log correction.

## Route: PLAN (1 gate)

1. Intent → research → decision-first plan (per `reference/planning.md`, `reference/agents.md`); `plan.json` sets `_meta.version: 3`. The decision, outcome, scope, architecture, evidence, alternatives, risks, validation, and task contracts required by `reference/schemas/plan.md` must be complete before the gate. For standard/deep plans, require decision implications, substantive tradeoffs, risk triggers/recovery, and executable task dossiers; populated-but-generic fields do not pass the gate.
2. Deliberation: Planner ↔ Challenger, 2 rounds (router.md)
3. **HUMAN GATE**: approve plan (`--to-plan` mode: this gate is replaced per `## Mode: --to-plan`). Validate `plan.json`, then have the active AI author `{SESSION_DIR}/plan.candidate.html` from the canonical JSON and any sibling `plan-check.json`. The AI chooses the information design; the page must be self-contained and lead with the approval question, recommendation, evidence, architecture, risks, and validation, with files/tasks/waves in an execution appendix. Promote only a valid candidate with `node {PLUGIN_ROOT}/skills/phantom/scripts/validate-review-html.mjs plan --source {SESSION_DIR}/plan.json --candidate {SESSION_DIR}/plan.candidate.html --out {SESSION_DIR}/plan.html`. `plan.json` stays the machine SSoT; HTML is disposable, never parsed back, and never manually patched or repaired. Open `plan.html` directly, then collect approval and feedback in chat. Material feedback updates `plan.json` and reruns plan-checker (and Rival when scope changes) before fresh generation; presentation-only feedback leaves JSON unchanged and regenerates from the same source plus that feedback. Validate/promote the fresh candidate and reopen only when the user asks to review it again. If candidate generation, validation, or opening is unavailable, present the same decision-first hierarchy in chat and state the capability failure. Never degrade to a task-only gate.
   Checkpoint: `PR="${PR:-$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)}"; PR="${PR%/}"; if [ -n "$PR" ]; then printf '%s\n' '{"ticket":"{TICKET}"}' | node "$PR/scripts/lib/checkpoint.js" write {SESSION_DIR}/checkpoints plan-gate-approved || :; fi` (advisory; resume reads latest; empty `$PR` skips silently).
4. Contracts. >5 files → `Skill(skill="phantom:wire")`.
5. **Spawn Blade(s)** via `Skill(skill="phantom:execute")`: execute rechecks
   defect proof, spawns agents per plan, and requires independent verification
   for every implementation scope
6. `Skill(skill="phantom:verify", args="--chained")` → on FAIL verify threads `--chained` through to `Skill(skill="phantom:fix")` (re-verifies internally; loop ceiling owned by `hooks/loop-controller.js`) → on PASS flow straight to `Skill(skill="phantom:wrap")`. No human return between verify/fix/wrap — wrap proceeds autonomously to a **draft PR**; the human gate is post-PR (review the draft, mark it ready-to-review).

## Route: BRAINSTORM (2 gates)

`Skill(skill="phantom:brainstorm")` → **GATE 1** (pick direction)
Checkpoint: `PR="${PR:-$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)}"; PR="${PR%/}"; if [ -n "$PR" ]; then printf '%s\n' '{"ticket":"{TICKET}"}' | node "$PR/scripts/lib/checkpoint.js" write {SESSION_DIR}/checkpoints brainstorm-gate1-approved || :; fi` (advisory; resume reads latest; empty `$PR` skips silently).
→ PLAN route → **GATE 2** (approve plan)

## Route: FULL (3 gates)

`Skill(skill="phantom:brainstorm")` → **GATE 1** → Plan → **GATE 2** → `Skill(skill="phantom:wire")` → **GATE 3** → `Skill(skill="phantom:execute")` → `Skill(skill="phantom:verify", args="--chained")` → on FAIL verify threads `--chained` through to `Skill(skill="phantom:fix")` (re-verifies internally; loop ceiling owned by `hooks/loop-controller.js`) → on PASS `Skill(skill="phantom:wrap")`. No human return between verify/fix/wrap — wrap proceeds autonomously to a **draft PR**; the human gate is post-PR (review the draft, mark it ready-to-review).

## Auto-chaining (default flow)

Phases chain autonomously without returning to the human between phases. The only stops are: (a) the PLAN/FULL plan-approval gate(s) and (b) fix-loop exhaustion (ceiling owned by `hooks/loop-controller.js`). Wrap proceeds autonomously to a **draft PR** with no ship confirmation; the human gate is post-PR (review the draft, mark it ready-to-review). On verify PASS the chain auto-continues to wrap; on verify FAIL it auto-invokes the fix-loop, then re-verifies — it does not wait for the human to type the next phase.

> The `args="--chained"` token threaded into the `phantom:verify` calls above is what makes verify/fix run autonomously (auto-invoke fix, auto-proceed past fix-packet approval). Its ABSENCE is the safe standalone default: verify/fix fall back to gated report+suggest and wait for the human. So a dropped token degrades to MORE gating, never less.

Between phases: if heavy context, `Skill(skill="phantom:pause")`. Resume reads `route-decision.json`.

## Mode: --to-plan (plan-only, no human present)

Activated when $ARGUMENTS contains `--to-plan` (noted in `route-decision.json` at Phase A step 1). Planning runs headless and produces a plan only — it NEVER executes. There is no queue: the plan lands in the session dir as `plan.json` and the run stops.

> The flag's ABSENCE is the safe default: without `--to-plan` the gated flow above applies unchanged, so a dropped flag degrades to MORE gating, never less. In this mode NOTHING EVER EXECUTES — no Blade implementation spawns, no verify, no fix, no wrap, and no git mutations. This mode creates NO worktree; it runs in the normal repo (the session dir already lives outside the repo).

**Route collapse:**
- DIRECT → still produce a compact decision-first `plan.json` (plan-only — even trivial work produces a plan); the same `_meta.version: 3` contract applies, with concise sections and no unnecessary fan-out.
- BRAINSTORM / FULL → collapse to PLAN-grade planning. No human is present to pick a direction: pick the conservative option and record the alternatives in the plan for the human who reviews it later.

**Headless contract:**
- NEVER ask the user questions in this mode. Pick recommended defaults; record every assumption made in an `assumptions[]` array inside `plan.json`.
- If nested agent spawns are unavailable in the runtime, run plan-checker/rival-grade self-checks INLINE — degradation is acceptable because a human still reviews the plan before any execution.

**Inline self-checks:**
- Run plan-checker + rival review of `plan.json` INLINE. On failure: revise ONCE, then record the finding anyway in `plan.json` with `selfCheck: "flagged"` + a finding summary. A human decides later.

**EXIT:** write `plan.json` to the session dir, then best-effort have the active AI author `{SESSION_DIR}/plan.candidate.html` and run `node {PLUGIN_ROOT}/skills/phantom/scripts/validate-review-html.mjs plan --source {SESSION_DIR}/plan.json --candidate {SESSION_DIR}/plan.candidate.html --out {SESSION_DIR}/plan.html` for the human who reviews later. Candidate generation or validation failure is non-blocking and does not stop the exit. Then print exactly one report line — `[PLANNED] {TICKET} — {N} files, {summary}` — and STOP. Prohibited in this mode: Blade implementation spawns, verify, fix, wrap, git mutations, worktree creation, or opening browsers.
