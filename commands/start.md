---
name: start
description: "Use when starting any new feature, bug fix, refactor, or task — a Jira ticket key (e.g., PROJ-123), 'implement', 'build', 'fix', 'work on'. Plans, decomposes, and executes with multi-agent shadows."
argument-hint: "<requirement>"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
# User-facing hour-one loop. Stay on the / menu (Cursor slash reads this file).
# Duplication with skills/{name} is accepted for start/pause/resume/verify/review/pr-review/wrap.
user-invocable: true
---

> **Preamble Tier: T4** — loads ALL shared contexts (canonical registry: `scripts/preamble-tier.js`)
> See `_shared.md` SS Preamble Tiers for the tier system.

# /gorkhali:start "$ARGUMENTS"

Adaptive router: context → classify → route(LITE|DIRECT|PLAN|BRAINSTORM|FULL) → verify.
Each phase reads/writes artifacts in `{TEAM_DIR}/sessions/{TICKET}/`.
No git operations until wrap. All work is local.

> **Tip:** Run `/effort high` before starting. Gorkhali runs every agent at `high` (Chief pinned). Avoid `ultracode`/`xhigh` — under ultracode the runtime can wrap a gated phase in a background workflow that takes no mid-run input, silently bypassing Gorkhali's approval gates.
>
> Run the session on Opus 5 (recommended) - its stronger instruction-following, built-in self-verification, and fewer steers make the subagent-driven flow and pause/resume more reliable. Agents inherit the session model unless their definition pins one.

<subagent_law>

## CORE DISCIPLINE: Subagent-Driven Work

**The main LLM (Chief) NEVER implements code directly.** All code changes go through the Agent tool.

Every `reference/…` pointer in this file names the canonical text for that rule. Follow it there; this file never restates it.

- **Phase A + B:** Chief gathers context and classifies. This is coordinator work — read files, call MCP tools, write session artifacts. This is fine.
- **Implementation:** ALWAYS spawn Engineer agent(s) via the Agent tool. Chief writes `intent.json`, `plan.json`, `contracts/` — but NEVER edits project source files.
- **If you catch yourself about to call Edit/Write on a project file:** STOP. Spawn an Engineer instead.

Agent spawn rules (all routes):
- `mode: "bypassPermissions"` — always
- Spawn by `subagent_type` (engineer, auditor, inspector, detective, advisor, steward, justice, opposition). **Chief passes `model:` explicitly on every spawn** per `reference/agents.md` → Model Routing — the value resolved per role by `node "$PR/skills/gorkhali/scripts/resolve-profile.mjs" --role <role> --host claude-code [--risk <level>]` (prepend `{PR_BOOTSTRAP}` per `_shared.md` §Paths — the session cwd is the consumer repo, so never invoke the resolver by relative path; empty `$PR` → fall back to the role's frontmatter pin) (`haiku` for economy roles, `sonnet` for the rest); Chief never invents a model ID (D3). Before each spawn, write that section's one-line scope check (`scope: … · floor-sufficient? … · reason`) visibly in Chief's output.
- `floor-sufficient? N` means the subtask needs **re-decomposing**, not a bigger model — there is no tier above sonnet to route delegated work to.
- SOLO (1-3 files): single Engineer, foreground
- SHADOWS (4+ files): parallel Blades with `isolation: "worktree"`
- Inject learnings corrections into every agent prompt

</subagent_law>

## Phase A: Context

> All session artifacts live under `{TEAM_DIR}/sessions/{TICKET}/` (resolves to `${GORKHALI_DATA:-~/.gorkhali}/repos/{REPO_NAME}/sessions/{TICKET}/`), NOT inside the project directory. This prevents accidental git commits of gorkhali state. Product-repo `.gorkhali/sdlc/` and `intent/` markdown files are the committed audit chain, not session state.

1. Parse TICKET from $ARGUMENTS or `git branch --show-current` — a ticket is any match of `[A-Z][A-Z0-9]+-\d+` (e.g., PROJ-123). Accept any such key as-is; do not validate or resolve a project prefix.
   `--to-plan` in $ARGUMENTS → note `mode: "to-plan"` in `route-decision.json`; behavior changes ONLY at the gates (see `## Mode: --to-plan`)
2. Create `{TEAM_DIR}/sessions/{TICKET}/` — existing artifacts? ask resume or fresh
2.4. **Ingest committed intent when present.** After the ticket id is known:

   ```text
   node <skill-directory>/scripts/sdlc-chain.mjs locate-intent --workspace <workspace> --task {TICKET}
   ```

   If a file is found, parse it (`parse-intent --file`) and use `summary` as the
   session intent text. `draft` stays plan-only until the originator or product
   owner sets Status to `accepted`. Missing sections stay `_Not recorded`. This
   file is not lifecycle state.
2.5. Activate subagent enforcement and point the wake queue at this session (hooks can't inherit Chief env). Create the mutable data root lazily so a fresh plugin install needs no setup step. The pointer is scoped per-repo so a session in another repo can't clobber it — compute the repo name with the same `detectRepo` the consumer uses, and fall back to the bare pointer if it can't be resolved: `ROOT="${GORKHALI_DATA:-$HOME/.gorkhali}"; D="$ROOT/state"; mkdir -p "$D"; touch "$ROOT/.chief-active"; {PR_BOOTSTRAP}; REPO="$([ -n "$PR" ] && node -e 'process.stdout.write(require(process.argv[1]+"/scripts/lib/gorkhali-paths").detectRepo())' "$PR" 2>/dev/null || true)"; printf '%s' "{TEAM_DIR}/sessions/{TICKET}" > "$D/.active-wake-session${REPO:+.$REPO}"`
2.6. Link session to cost ledger (silent, never blocks): `{PR_BOOTSTRAP}; [ -n "$PR" ] && node "$PR/scripts/cost-link.js" open {TICKET}` (advisory guard, `{PR_BOOTSTRAP}` per `_shared.md` §Paths - empty `$PR` skips silently)
3. Jira MCP → fetch ticket + AC. Grep `learnings/INDEX.md` for the files this task will touch; do not paste the whole INDEX.
3.2. **Jira lifecycle sync** (only when TICKET matches `[A-Z][A-Z0-9]+-\d+`; slug sessions skip silently). In order:
   a. **Assign**: `atlassianUserInfo` → accountId; assign only when the ticket's `assignee` is null/empty OR `assignee.accountId` differs from it, via `editJiraIssue` to set it to the current user; already-mine → true skip, no redundant edit. Record as `assigned | already-mine | reassigned | skipped | unavailable` (reassigned = taken over from another assignee).
   b. **Transition**: `getTransitionsForJiraIssue`, match a transition named "In Progress", "Start Progress", "In Development", or "Doing" (case-insensitive); already in an in-progress-like status → skip with a note; ticket in a terminal status (Done/Closed/Resolved) → skip with a note (never reopen); matched → `transitionJiraIssue`; no name matches → skip with a note (workflow differs) - never error, never force-pick. Honor `jira.auto_transition` from the real reader (`{PR_BOOTSTRAP}; [ -n "$PR" ] && node "$PR/scripts/gorkhali-config.js" get jira.auto_transition`): skip the transition, not the assignment, ONLY when it prints exactly `false`; unset prints nothing (exit 1) so the transition proceeds, mirroring `commands/close.md`.
   c. **Label**: read `tracker.label` from the real reader (`{PR_BOOTSTRAP}; [ -n "$PR" ] && node "$PR/scripts/gorkhali-config.js" get tracker.label`).
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
   Checkpoint: `PR="${PR:-$(ls -dt "$HOME"/.claude/plugins/cache/gorkhali/gorkhali/*/ 2>/dev/null | head -1)}"; PR="${PR%/}"; if [ -n "$PR" ]; then printf '%s\n' '{"ticket":"{TICKET}"}' | node "$PR/scripts/lib/checkpoint.js" write {SESSION_DIR}/checkpoints phase-a-context || :; fi` (advisory - semantics: `_shared.md` §Checkpoints).
4. **Defect proof gate**: bug/defect/incident/regression detected by keywords,
   Jira type, or branch prefix → classify `workKind: "investigation"` in
   `context.json` and `intent.json`, then spawn Detective (`subagent_type: "detective"`,
   `name: "detective-colven"` per `reference/roster.md`) and write
   `{SESSION_DIR}/defect-proof.json` per `reference/defect-proof.md`.
   Gate per `reference/defect-proof.md`: only
   `ready_for_fix` / `confirmed_defect` may proceed; everything else STOPS before
   Engineer dispatch in `waiting_for_evidence` / `unconfirmed_defect`, recording the
   missing evidence and next observation. Diagnostic instrumentation requires a
   recorded, unexpired `DiagnosticGrant`; resume the proof gate after diagnostics.

## Phase B: Classify + Route

READ `reference/router.md` for full algorithm.

1. Gather signals (parallel, <5s): blast radius, patterns, novelty, history, ambiguity, AC
2. Classify: hard overrides → uncertainty → scope → learnings correction → route
3. Write `route-decision.json`. Report: `"[{ROUTE}] {rationale}"`
   Checkpoint: `PR="${PR:-$(ls -dt "$HOME"/.claude/plugins/cache/gorkhali/gorkhali/*/ 2>/dev/null | head -1)}"; PR="${PR%/}"; if [ -n "$PR" ]; then printf '%s\n' '{"ticket":"{TICKET}"}' | node "$PR/scripts/lib/checkpoint.js" write {SESSION_DIR}/checkpoints phase-b-route || :; fi` (advisory - semantics: `_shared.md` §Checkpoints).

## Route: LITE (0 gates)

Trivial scope only — the router picks LITE (per `reference/router/algorithm.md` step 5); the user never does.

1. Phase A + B run as today (session activate, chief-active sentinel, cost-link,
   classification) — every hook stays armed. If `workKind` is `investigation`,
   the defect-proof gate applies in full — LITE never bypasses it.
2. Write `intent.json` with task scope; `route-decision.json` records `"LITE"`.
3. Render the pre-dispatch routing table per `reference/agents.md` → Pre-Dispatch
   Routing Table (`Wave` is `1`), then **spawn ONE Engineer** — the subagent law
   is absolute: Chief never edits project files, not even one-liners
   (`hooks/chief-subagent-driven-law.sh` blocks it):
   ```
   Agent call:
     description: "Engineer: {1-line task summary}"
     subagent_type: "engineer"
     name: "engineer-norvale"
     mode: "bypassPermissions"
     model: "<resolved>"   # node "$PR/skills/gorkhali/scripts/resolve-profile.mjs" --role engineer --host claude-code → `sonnet`
     prompt: |
       You are an ENGINEER — implementation agent.
       {task description from intent.json}
       {relevant learnings/corrections}
       {file paths to modify}
       Self-review your changes before returning.
   ```
4. **Inspector-only verification:** spawn ONE Inspector
   (`subagent_type: "inspector"`, `name: "inspector-halden"` — the per-task
   verifier derivation for the single implicit task, per `reference/roster.md`,
   `model:` resolved per role → `haiku`) to run the discovered checks and write
   `{SESSION_DIR}/verification.json`. This does NOT chain into
   `Skill(skill="gorkhali:verify", args="--chained")` — Steward, Justice, and
   Auditor are skipped on this route.
5. **Record the lifecycle transitions LITE actually performed** (cheap CLI state
   writes, no extra spawns) — skipping them leaves `gorkhali-state.mjs status`
   reporting the session mid-flight and wrap/resume blind to the LITE pass:
   ```
   {PR_BOOTSTRAP}; [ -n "$PR" ] && node "$PR/skills/gorkhali/scripts/gorkhali-state.mjs" authorize --workspace <workspace> --scope implementation
   {PR_BOOTSTRAP}; [ -n "$PR" ] && node "$PR/skills/gorkhali/scripts/gorkhali-state.mjs" execute --workspace <workspace>
   {PR_BOOTSTRAP}; [ -n "$PR" ] && node "$PR/skills/gorkhali/scripts/gorkhali-state.mjs" record --workspace <workspace> --type verification --status <passed|failed> --input <external-temp-evidence-file>
   ```
   (`authorize`+`execute` run BEFORE the spawns above; `record` after the Inspector
   returns. `record --type verification` drives the verify transition itself. The
   passed-evidence contract is `skills/gorkhali/references/verification.md`:
   ≥1 passed check, `requiredSpecialists: []`, and a `userVerification`
   classification — `{ "required": false }` for LITE's trivial scope; if the
   Inspector classifies user verification as required, LITE was the wrong route —
   do NOT record, chain to `gorkhali:verify` for the full pipeline instead. The
   record transport refuses session-internal inputs, so stage the evidence copy at
   an external temp path, not `{SESSION_DIR}`.)
6. On Inspector FAIL → record the failed verification, then chain to
   `Skill(skill="gorkhali:fix")` (fix-loop ceiling
   unchanged, owned by `hooks/loop-controller.js`). On PASS → report
   `"[LITE] {summary} -- verified"` and STOP. No auto-wrap Clerk spawn: tell the
   user to run `/gorkhali:wrap` when ready — wrap's ship gate requires the full
   `/gorkhali:verify` review pass, which LITE deliberately skipped.

## Route: DIRECT (0 gates)

1. Write `intent.json` with task scope. If `workKind` is `investigation`, reread
   `{SESSION_DIR}/defect-proof.json` and require the complete
   `ready_for_fix` / `confirmed_defect` contract from
   `reference/defect-proof.md`; otherwise STOP in
   `waiting_for_evidence` / `unconfirmed_defect`.
2. Per-spawn Engineer lifecycle state is owned by validated hooks.
2.5. **Dispatch table (mandatory, before the spawn below):** render the pre-dispatch routing
   table exactly as defined in `reference/agents.md` → Pre-Dispatch Routing Table, populated
   from `intent.json` (file targets) and the roster-assigned `name` (`engineer-norvale`, DIRECT's
   fixed slot per `reference/roster.md` Spawn-Site Slot Table). `Wave` is always `1` for DIRECT
   — there is no wave fan-out. The `Model` column carries the value resolved for the role by
   `resolve-profile.mjs` under `$PR/skills/gorkhali/scripts/` (Engineer → `sonnet` on this host), never a hand-picked ID.
3. **Spawn Engineer agent** via Agent tool:
   ```
   Agent call:
     description: "Engineer: {1-line task summary}"
     subagent_type: "engineer"
     name: "engineer-norvale"
     mode: "bypassPermissions"
     model: "<resolved>"   # node "$PR/skills/gorkhali/scripts/resolve-profile.mjs" --role engineer --host claude-code → `sonnet`; `reference/agents.md` → Model Routing
     # effort is the session's `high` — there is no per-spawn effort param.
     prompt: |
       You are an ENGINEER — implementation agent.
       {task description from intent.json}
       {acceptance criteria from Jira}
       {relevant learnings/corrections}
       {file paths to modify}
       Self-review your changes before returning.
   ```
4. Wait for the Engineer's durable result.
5. After Engineer returns → independent
   `Skill(skill="gorkhali:verify", args="--chained")` (chained flow). For a
   confirmed defect, the verifier must rerun the recorded reproduction and the
   focused regression check. The implementing Engineer's self-review or test
   result is not independent verification. Before marking the direct scope
   done, write its independent
   `{SESSION_DIR}/scope-verifications/{task-id}.json` record per
   `reference/defect-proof.md`.
   - Chain onward per `## Auto-chaining`.
6. Escalation path AFTER the fix-loop is exhausted (not the immediate response): escalate to PLAN route. >3 files touched → log correction.

## Route: PLAN (1 gate)

1. Intent → research → decision-first plan (per `reference/planning.md`, `reference/agents.md`); `plan.json` sets `_meta.version: 3`. The briefing (`tackling`, `problem`, `how`), decision, outcome, scope, architecture, evidence, alternatives, risks, validation, and task contracts required by `reference/schemas/plan.md` must be complete before the gate. For standard/deep plans, require decision implications, substantive tradeoffs, risk triggers/recovery, and executable task dossiers; populated-but-generic fields do not pass the gate. A How without supporting evidence is an assumption. A refuted or stale premise still stops planning.
2. Deliberation: Planner (Chief) ↔ Opposition (`opposition-parlow`, the one plan critic, writes `plan-check.json`), 2 rounds per `reference/router/deliberation.md`
3. **HUMAN GATE**: approve plan (`--to-plan` mode: this gate is replaced per `## Mode: --to-plan`). Validate `plan.json`, then have the active AI author `{SESSION_DIR}/plan.candidate.html` from the canonical JSON and any sibling `plan-check.json`. The AI chooses the information design; the page must be self-contained and lead with What (`briefing.tackling`), Problem (`briefing.problem`), and How (`briefing.how`), then evidence, scope, risks, and open questions. Implementation (files, tasks, waves) lives in a collapsed `<details>` appendix with no `open` attribute. Promote only a valid candidate with `node {PLUGIN_ROOT}/skills/gorkhali/scripts/validate-review-html.mjs plan --source {SESSION_DIR}/plan.json --candidate {SESSION_DIR}/plan.candidate.html --out {SESSION_DIR}/plan.html`. `plan.json` stays the machine SSoT; HTML is disposable, never parsed back, and never manually patched or repaired. Open `plan.html` directly, then collect approval and feedback in chat using this brief — never tasks:
   - **What** — `briefing.tackling`
   - **Problem** — `briefing.problem`
   - **How** — `briefing.how` (a How without supporting evidence is an assumption; record it in `assumptions`)
   - **Evidence**
   - **Scope**
   - **Risks**
   - **Open questions**
   - **Approve?**
   Material feedback updates `plan.json` and reruns Opposition before fresh generation; presentation-only feedback leaves JSON unchanged and regenerates from the same source plus that feedback. Validate/promote the fresh candidate and reopen only when the user asks to review it again. If candidate generation, validation, or opening is unavailable, present the same What/Problem/How brief in chat and state the capability failure. Never degrade to a task-only gate.
   Checkpoint: `PR="${PR:-$(ls -dt "$HOME"/.claude/plugins/cache/gorkhali/gorkhali/*/ 2>/dev/null | head -1)}"; PR="${PR%/}"; if [ -n "$PR" ]; then printf '%s\n' '{"ticket":"{TICKET}"}' | node "$PR/scripts/lib/checkpoint.js" write {SESSION_DIR}/checkpoints plan-gate-approved || :; fi` (advisory - semantics: `_shared.md` §Checkpoints).
4. Contracts. >5 files → `Skill(skill="gorkhali:wire")`.
5. **Spawn Engineer(s)** via `Skill(skill="gorkhali:execute")`: execute rechecks
   defect proof, spawns agents per plan, and requires independent verification
   for every implementation scope
6. `Skill(skill="gorkhali:verify", args="--chained")`, then chain onward per `## Auto-chaining`.

## Route: BRAINSTORM (2 gates)

`Skill(skill="gorkhali:brainstorm")` → **GATE 1** (pick direction)
Checkpoint: `PR="${PR:-$(ls -dt "$HOME"/.claude/plugins/cache/gorkhali/gorkhali/*/ 2>/dev/null | head -1)}"; PR="${PR%/}"; if [ -n "$PR" ]; then printf '%s\n' '{"ticket":"{TICKET}"}' | node "$PR/scripts/lib/checkpoint.js" write {SESSION_DIR}/checkpoints brainstorm-gate1-approved || :; fi` (advisory - semantics: `_shared.md` §Checkpoints).
→ PLAN route → **GATE 2** (approve plan)

## Route: FULL (3 gates)

`Skill(skill="gorkhali:brainstorm")` → **GATE 1** → Plan → **GATE 2** → `Skill(skill="gorkhali:wire")` → **GATE 3** → `Skill(skill="gorkhali:execute")` → `Skill(skill="gorkhali:verify", args="--chained")`, then chain onward per `## Auto-chaining`.

## Auto-chaining (default flow)

Verify FAIL threads `--chained` into `Skill(skill="gorkhali:fix")` and re-verifies until pass or the fix-loop ceiling (`hooks/loop-controller.js`). Verify PASS does **not** wrap. Stop and tell the user to run `/gorkhali:wrap` when they want a PR — wrap records `authorize --scope ship-pr` and is never implied by implementation or a passing verify. Plan-approval gates still stop PLAN/FULL.

Unattended Mission Control (`commands/loop.md`) is the exception: that loop may auto-chain wrap because it is acting as the operator.

> The `args="--chained"` token threaded into the `gorkhali:verify` calls above is what makes verify/fix run autonomously (auto-invoke fix, auto-proceed past fix-packet approval). Its ABSENCE is the safe standalone default: verify/fix fall back to gated report+suggest and wait for the human. So a dropped token degrades to MORE gating, never less.

Between phases: if heavy context, `Skill(skill="gorkhali:pause")`. Resume reads `route-decision.json`.

## Mode: --to-plan (plan-only, no human present)

Activated when $ARGUMENTS contains `--to-plan` (noted in `route-decision.json` at Phase A step 1). Planning runs headless and produces a plan only — it NEVER executes. There is no queue: the plan lands in the session dir as `plan.json` and the run stops.

> Without `--to-plan` the gated flow above applies unchanged. In this mode NOTHING EVER EXECUTES — no Engineer implementation spawns, no verify, no fix, no wrap, and no git mutations. This mode creates NO worktree; it runs in the normal repo (the session dir already lives outside the repo).

**Route collapse:**
- LITE / DIRECT → still produce a compact decision-first `plan.json` (plan-only — even trivial work produces a plan); the same `_meta.version: 3` contract applies, with concise sections and no unnecessary fan-out. LITE never enters its execution path in this mode: no Engineer spawn, no Inspector verify.
- BRAINSTORM / FULL → collapse to PLAN-grade planning. No human is present to pick a direction: pick the conservative option and record the alternatives in the plan for the human who reviews it later.

**Headless contract:**
- NEVER ask the user questions in this mode. Pick recommended defaults; record every assumption made in an `assumptions[]` array inside `plan.json`.
- Run the Opposition review of `plan.json` INLINE when nested agent spawns are unavailable; a human still reviews the plan before any execution. On failure: revise ONCE, then record the finding in `plan.json` with `selfCheck: "flagged"` + a finding summary.

**EXIT:** write `plan.json` to the session dir, then best-effort have the active AI author `{SESSION_DIR}/plan.candidate.html` and run `node {PLUGIN_ROOT}/skills/gorkhali/scripts/validate-review-html.mjs plan --source {SESSION_DIR}/plan.json --candidate {SESSION_DIR}/plan.candidate.html --out {SESSION_DIR}/plan.html` for the human who reviews later. Candidate generation or validation failure is non-blocking and does not stop the exit. Then print exactly one report line — `[PLANNED] {TICKET} — {N} files, {summary}` — and STOP. Prohibited in this mode: Engineer implementation spawns, verify, fix, wrap, git mutations, worktree creation, or opening browsers.
