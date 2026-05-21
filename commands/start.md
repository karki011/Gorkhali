---
name: team:start
description: "Use when starting any new feature, bug fix, refactor, or task. Also use when user provides a Jira ticket (CP-*, CLOUD-*), says 'implement', 'build', 'fix', 'work on', or describes a requirement. Plans, decomposes, and executes with multi-agent crew."
argument-hint: "<requirement>"
---

> **Preamble Tier: T4** (full orchestration — loads ALL shared contexts)
> See `_shared.md` § Preamble Tiers for the tier system.

# /team:start "$ARGUMENTS"

> **Gates:** (1) EnterPlanMode before planning. (2) writing-plans skill before any plan. (3) Research agents use opus. (4) team:verify after execution. (5) Done When from Jira AC or user — never inferred. (6) All implementation through Agent tool. (7) /goal opt-in with turn cap.

---

## Phase A — Context Loading

> **Output on start:**
> ```
>   ⚡ TEAM SKILL ⚡
>   ━━━━━━━━━━━━━━━━━
>   Session: {TICKET}
>   Crew assembling...
> ```

1. Detect ticket from `$ARGUMENTS` or git branch:
   - If `$ARGUMENTS` matches `[A-Z]+-\d+` (e.g., `CP-41171`): set `TICKET` to that key
   - Otherwise: detect ticket from git branch name (e.g., `cp-41171-hourly-chart` → `CP-41171`)
   - Load `decisions/global.md`
2. **Jira context pull** (if Atlassian MCP available AND `TICKET` detected):
   - Fetch ticket: `mcp__atlassian__getJiraIssue(issueIdOrKey: TICKET, responseContentFormat: "markdown")`
   - Extract: summary, description, acceptance criteria, type, priority, comments, parent epic
   - **Capture acceptance criteria separately** into `ACCEPTANCE_CRITERIA` variable — used as default `Done When` predicate in Phase B Intent
   - Merge into `$ARGUMENTS` context — ticket description becomes the requirement
   - Transition Jira to "In Progress" (best-effort, don't block if it fails)
   - If Atlassian MCP not available: skip silently, use `$ARGUMENTS` as-is, `ACCEPTANCE_CRITERIA = null`
3. Register session: `TaskCreate({ subject: '[Cortex] SESSION:start "{TICKET} — {$ARGUMENTS}"' })`
4. Load `learnings/INDEX.md` + `learnings/crew.md`, then domain-specific learnings after classification:
   UI → `ui.md` | Data/API → `data.md` | Auth → `auth.md` | Tests → `testing.md` | Migration → `migration.md` | Tooling → `tooling.md`
5. **Phantom recon** (if phantom available — all non-blocking, skip silently if unavailable):

   **File extraction** (for blast radius — best effort):
   - From `$ARGUMENTS`: extract explicit file paths (e.g., `src/components/Foo.tsx`)
   - From Jira description: extract code blocks and path references
   - From git: `git diff --name-only main...HEAD` (if on feature branch)
   - Store as `PHANTOM_FILES`. If empty, blast radius step is skipped.

   **Tool calls** (parallel where independent):
   ```
   PHANTOM_STRATEGY = phantom_orchestrator_process({
     goal: "{TICKET} — {$ARGUMENTS summary}",
     activeFiles: PHANTOM_FILES,
     cwd: "{repo root}"
   })

   PHANTOM_BLAST_RADIUS = phantom_before_edit({
     files: PHANTOM_FILES,
     goal: "{$ARGUMENTS summary}"
   })  // skip if PHANTOM_FILES empty

   PHANTOM_HISTORY = phantom_orchestrator_history({ limit: 5 })

   PHANTOM_CONFLICTS = phantom_conflict_status({ cwd: "{repo root}" })
   ```

   **Print recon block:**
   ```
   ╔══════════════════════════════════════════════════════════════╗
   ║  PHANTOM RECON                                              ║
   ╠══════════════════════════════════════════════════════════════╣
   ║                                                             ║
   ║  ┌─── Strategy Pipeline ───────────────────────────────┐    ║
   ║  │                                                     │    ║
   ║  │  goal ──▶ orchestrator ──▶ [{STRATEGY}]             │    ║
   ║  │                            confidence: {CONF}       │    ║
   ║  │                                                     │    ║
   ║  │  alternatives:                                      │    ║
   ║  │    ├─ {ALT_1} ({SCORE_1})                           │    ║
   ║  │    └─ {ALT_2} ({SCORE_2})                           │    ║
   ║  │                                                     │    ║
   ║  │  risk: {RISK_LEVEL}    complexity: {COMPLEXITY}      │    ║
   ║  └─────────────────────────────────────────────────────┘    ║
   ║                                                             ║
   ║  ┌─── Blast Radius ────────────────────────────────────┐    ║
   ║  │                        // omit if PHANTOM_FILES empty    ║
   ║  │  {FILE_1} ──┬──▶ {N} dependents  (impact: {SCORE}) │    ║
   ║  │  {FILE_2} ──┤                                       │    ║
   ║  │  {FILE_3} ──┤    total: {N} files affected          │    ║
   ║  │  {FILE_4} ──┤                                       │    ║
   ║  │  {FILE_5} ──┘                                       │    ║
   ║  │                                                     │    ║
   ║  │  graph-discovered (not in original scope):          │    ║
   ║  │    {RELATED_FILE_1}                                 │    ║
   ║  │    {RELATED_FILE_2}   // omit if no new files       │    ║
   ║  └─────────────────────────────────────────────────────┘    ║
   ║                                                             ║
   ║  ┌─── Routing ─────────────────────────────────────────┐    ║
   ║  │                                                     │    ║
   ║  │  {STRATEGY} ──▶ {SOLO|CREW}                         │    ║
   ║  │                                                     │    ║
   ║  │  ┌──────────┬───────────────┬──────────────────┐    │    ║
   ║  │  │ Strategy │ Route         │ Why              │    │    ║
   ║  │  ├──────────┼───────────────┼──────────────────┤    │    ║
   ║  │  │ Direct   │ SOLO          │ simple, 1 spark  │    │    ║
   ║  │  │ Advisor  │ SOLO + Oracle │ needs guidance   │    │    ║
   ║  │  │ Refine   │ SOLO          │ iterative        │    │    ║
   ║  │  │ Decompose│ CREW          │ subtask split    │    │    ║
   ║  │  │ Tree     │ CREW + brain  │ explore paths    │    ║
   ║  │  │ Debate   │ CREW + redteam│ high risk        │    │    ║
   ║  │  │ Graph    │ CREW + topo   │ parallel groups  │    │    ║
   ║  │  └──────────┴───────────────┴──────────────────┘    │    ║
   ║  │                             ▲                       │    ║
   ║  │                             │ selected              │    ║
   ║  └─────────────────────────────────────────────────────┘    ║
   ║                                                             ║
   ║  ┌─── Context ─────────────────────────────────────────┐    ║
   ║  │  conflicts: {none | N sessions — ⚠️ overlap}        │    ║
   ║  │  history:   {closest past decision — outcome}       │    ║
   ║  │             {if failed: "⚠ consider alternative"}   │    ║
   ║  └─────────────────────────────────────────────────────┘    ║
   ║                                                             ║
   ╚══════════════════════════════════════════════════════════════╝
   ```
   
   **Compact variant** (use when blast radius is empty / strategy is Direct with high confidence):
   ```
   ╔══════════════════════════════════════════╗
   ║  PHANTOM RECON                          ║
   ╠══════════════════════════════════════════╣
   ║  strategy:   {NAME} ({CONF})            ║
   ║  risk:       {LEVEL}                    ║
   ║  complexity: {LEVEL}                    ║
   ║  route:      {STRATEGY} ──▶ {ROUTE}     ║
   ║  conflicts:  {none}                     ║
   ╚══════════════════════════════════════════╝
   ```

   **Degradation:** If individual tools fail, print what succeeded. If ALL fail:
   ```
   PHANTOM RECON: unavailable (MCP not connected)
   ```
   Continue to step 6 regardless.
6. Caveman-compress any uncompressed learnings (background, non-blocking)
7. Create `sessions/{TICKET}/contracts/`, detect workflow type (feature/bug/refactor/spike/docs)
8. Load `sessions/{TICKET}/decisions.md` if prior work exists
9. **Pre-Plan Hook:** Classify task type + risk → detect missing context → decide if scouts needed → determine if Prism is hard gate
10. **Model override detection:** Check if user specified a model preference in `$ARGUMENTS` or conversation (e.g., "use opus", "spawn with sonnet", "opus for sparks"). If found, set `MODEL_OVERRIDE` for the session — all background agent spawns use this model instead of the registry default. Valid values: `opus`, `sonnet`. If not specified, `MODEL_OVERRIDE = null` (use registry defaults).
11. **Activate cortex-subagent-driven hook (Iron Law #13 audit):**
    ```
    touch ~/.claude/team/.cortex-active
    ```
    This sentinel arms the PreToolUse hook at `~/.claude/team/hooks/cortex-subagent-driven-law.sh`. Every Edit/Write/MultiEdit call during the session is audited to `~/.claude/team/audit/cortex-edits-{date}.jsonl`. Orchestration paths (sessions/, .planning/, contracts/, decisions/, learnings/) are exempt. Removed by `/team:wrap`.

---

## Phase B — Planning

1. Ask questions, iterate, confirm understanding
2. **Capture Intent** (mandatory — ask or infer):
   ```
   ## Intent
   **Goal:** [success in one sentence]
   **Done When:** [machine-checkable exit condition — checklist of verifiable predicates]
   **Priority:** [speed | quality | ux | stability | scope — ranked]
   **Acceptable trade-offs:** [what CAN be sacrificed]
   **Non-negotiables:** [what MUST NOT be compromised]
   ```
   Save to: plan, `sessions/{TICKET}/intent.md`, every agent prompt (compact 3-line version).
   Infer if user doesn't engage: bug→stability, feature→speed, figma→ux, refactor→quality.

   **`Done When` sourcing (in order):**
   a. If `ACCEPTANCE_CRITERIA` from Jira is non-empty → use it as the default. Show to user: "Done When derived from {TICKET} acceptance criteria: [list]. Confirm or edit?"
   b. If `ACCEPTANCE_CRITERIA` empty/missing → ask user explicitly: "What are the exit conditions? When is this done?" Block Phase B until answered.
   c. Format as verifiable predicates (e.g., "tests pass", "lint clean", "endpoint returns 200 on /foo", "UAT confirmed by user", "Prism >= 7.0"). Vague predicates ("looks good", "works well") must be sharpened before proceeding.

3. Call `Skill(skill="superpowers:writing-plans")` — defines plan structure, task granularity, quality standards
4. **Codebase-first inventory** + **Anti-repetition check:**
   - Scan `learnings/INDEX.md` + `learnings/{domain}.md ## Corrections` for matching failures
   - Scan `~/.claude/team/global/patterns/INDEX.md` (secondary)
   - If match found: acknowledge, explain difference, or choose alternative
   - Log matches under `## Anti-Repetition Notes` in plan
   - Spawn Explore (opus) + Plan (opus) agents for codebase research
   - Complex tasks (risk >= medium): call `Skill("superpowers:brainstorming")` first

5. Produce plan: crew selection, agent-to-task mapping, contracts, execution order, risks

5b. **Subtask decomposition** (structural enforcement of step ordering):
   For each Spark's scope in the plan, decompose into ordered atomic subtasks:
   - Each subtask = single concern (one file, one function, one integration point)
   - Each subtask has an evidence requirement (what "done" looks like)
   - Use `templates/decomposition-templates.md` for standard patterns
   - Subtasks are created as TaskCreate entries during Phase D dispatch
   
   This replaces prompt-based "don't skip steps" with structural enforcement — Sparks execute one subtask at a time, report evidence, then get the next.

6. **Devil's Advocate Review** (ALL plans — mandatory):
   Spawn Devil's Advocate (opus, no tools, blocking) with the complete plan:
   ```
   Agent({
     description: "Devil's Advocate: challenge plan for {TICKET}",
     subagent_type: "oracle", model: "opus",
     mode: "bypassPermissions", run_in_background: false,
     prompt: "You are the Devil's Advocate. Review this plan and challenge it.
       [paste full plan including Intent, tasks, file structure, execution order]
       [paste coding-principles.md from repo or ~/.claude/team/reference/coding-principles.md]
       Respond with: Challenges (must address), Warnings (consider), Verdict (PROCEED/REVISE/RETHINK)."
   })
   ```
   - If verdict = PROCEED → continue to step 8
   - If verdict = REVISE → Cortex addresses each challenge, re-runs Devil's Advocate
   - If verdict = RETHINK → return to step 4 (codebase research) with new constraints
   - Max 2 Devil's Advocate iterations — if still RETHINK after 2, escalate to user with the challenges

7. **Phantom strategy advisory** (if `PHANTOM_STRATEGY` set from Phase A):
   - Map `PHANTOM_STRATEGY.strategy.id` to SOLO/CREW routing (see `_shared-phantom-integration.md`)
   - Merge `PHANTOM_HISTORY` failed approaches into anti-repetition notes
   - If plan introduced NEW files not in `PHANTOM_FILES` → re-call `phantom_before_edit` with full plan file list, update `PHANTOM_BLAST_RADIUS`
   - No redundant tool calls — data collected in Phase A step 5

   **Print routing decision:**
   ```
   ┌─── Phantom ──▶ Route ──────────────────────────────┐
   │                                                     │
   │  {STRATEGY} ({CONF}) ──▶ {SOLO|CREW}               │
   │                                                     │
   │  blast radius: {N} files   risk: {LEVEL}            │
   │  anti-repetition: {N matches | none}                │
   │  history: {closest match — outcome}                 │
   │                                                     │
   │  files (plan + graph-discovered):                   │
   │    {FILE_1}  {FILE_2}  {FILE_3}  ...                │
   └─────────────────────────────────────────────────────┘
   ```

8. Get user approval via `ExitPlanMode`

8b. **Activate native `/goal` loop (OPT-IN, with turn cap):**

   `/goal` is **opt-in** — Cortex asks before activating to avoid runaway turn-loops on short tasks. Default is OFF.

   **Decision rule:**
   - Task estimated > 5 turns (multi-file feature, refactor, debugging chase) → ASK user: "Activate `/goal` auto-loop with `Done When` as exit condition?"
   - Task estimated ≤ 5 turns (single-file fix, doc update, simple component) → SKIP `/goal`, rely on Phase E Gate alone
   - Running headless (`claude -p`) → activate by default with turn cap

   **If activating, ALWAYS append a turn cap clause** to prevent infinite loops:
   ```
   /goal {Done When predicates joined with " AND "} OR stop after {N} turns
   ```
   - `N` = max(10, 2× expected turn count). Hard ceiling: 20 turns.
   - Example: `/goal Sentinel PASS AND Prism >= 7.0 AND CP-41171 AC confirmed OR stop after 12 turns`

   **What `/goal` does:**
   - Wraps the session in a turn-loop. After each turn, a small fast model evaluates the condition against the conversation transcript
   - Unmet → auto-triggers another turn with condition as directive
   - Met OR turn cap hit → goal clears, normal flow resumes

   **Anti-runaway safeguards:**
   - Turn cap clause is MANDATORY (never omit it)
   - If user sees "Goal not yet met… continuing" 3+ times → press `ctrl+o` or run `/goal clear` manually
   - Phase E Gate runs independent of `/goal` — it's the deterministic exit, not the loop's evaluator

   The `/goal` evaluator cannot run tools — it only reads the transcript. Phase E Goal Gate (step 0) surfaces hard evidence (Sentinel results, Prism score) into the transcript for the evaluator to find.

   If `/goal` is unavailable (no trust dialog accepted, `disableAllHooks` set, etc.) → skip silently and rely on Phase E Gate alone.

9. **Emit routing decision:**
   ```
   TaskCreate({
     subject: '[Cortex] DECISION:route {TICKET}',
     description: 'Goal: {summary}\nRoute: {solo|crew}\nRisk: {level}\nComplexity: {level}\nCrew: {agents}\nReasoning: {why}\nAnti-repetition: {corrections or "none"}'
   })
   ```

---

## State Checkpointing

Snapshot before each phase transition: `state/sessions/{TICKET}/snapshots/phase-{X}-complete.json`

---

## Phase C — Contracts

1. Create contracts from templates → `sessions/{TICKET}/contracts/`
2. **Pre-Execute Hook:** Block if contracts incomplete or interfaces undefined
3. Log contract summary to task board — no second approval gate (user already approved plan in Phase B step 8)

---

## Phase D — Execution

> **Before ANY agent spawn:** Run anti-repetition loader (`templates/anti-repetition-loader.md`). Build the Anti-Repetition Block once, inject into every agent prompt.
> **Phantom scoping** (if `PHANTOM_BLAST_RADIUS` set): Use stored blast radius to validate agent scope and discover missing related files. Pass directlyAffected list to Sentinel. If Phase B step 7 re-called `phantom_before_edit` (new files discovered during planning), use the updated `PHANTOM_BLAST_RADIUS`.
>
> Print scoping block before dispatch:
> ```
> ┌─── Phantom Scope Gate ───────────────────────────────┐
> │                                                      │
> │  planned files ──▶ blast radius check                │
> │                                                      │
> │  {FILE} ─┬─▶ {N} dependents  impact: {SCORE}        │
> │  {FILE} ─┤                                           │
> │  {FILE} ─┘   total: {N} files in blast zone          │
> │                                                      │
> │  high-impact (>0.3): {FILES or "none"}               │
> │  missing from plan: {DISCOVERED or "none"}           │
> │  sentinel scope:    {N} files queued                 │
> │                                                      │
> │  conflicts: {none | ⚠ N sessions overlap}            │
> └──────────────────────────────────────────────────────┘
> ```
> **MCP-enhanced execution** (based on Phase A discovery):
> - If `code_graph` available → use `detect_changes` + `get_review_context` instead of raw Grep for impact analysis. Use `get_affected_flows` to validate agent scope.
> - If `context_mode` available → route all agent outputs > 50 lines through `ctx_batch_execute` to protect context window. Index large diffs for searchable follow-up.
> - If `claude_flow` available → use `memory_store` for cross-session pattern persistence beyond learnings files.

> **Output on dispatch:**
> ```
>   CREW STATUS
>   ───────────────────────────
>   Cortex     ● orchestrating
>   {for each Spark}  ● deploying    {N} files
>   Sentinel   ○ standby
>   Prism      ○ standby
>   ───────────────────────────
> ```

### D-Solo (SOLO-routed tasks)

Cortex classified as SOLO in Phase B. One Spark drives end-to-end, consulting Oracle when stuck.

1. `TaskCreate({ subject: '[Solo] {task description}' })`
2. Spawn executor using `templates/solo-executor-prompt.md` with variables filled:
   ```
   Agent({
     description: "Solo: {task description}",
     subagent_type: "coder", model: MODEL_OVERRIDE || "sonnet",
     mode: "bypassPermissions", run_in_background: true,
     prompt: "{filled solo-executor-prompt template}"
   })
   ```
3. On completion: review report, check Oracle usage, verify Spark self-review score >= 7. If blockers → pivot to CREW.
4. **Run team:verify** — `Skill(skill="team:verify")`
   a. If PASS → record what worked to `learnings/INDEX.md` (see `_shared-auto-learning.md`)

      ### Visual Verification Gate (auto-triggered)

      **Condition:** `HAS_UI = true` AND changed files include `*.tsx`, `*.jsx`, `*.css`, `*.css.ts`, or `*.scss`.

      If condition met:
      1. Detect target routes from:
         - Contract's `routes` field (if specified)
         - Session state's `affectedRoutes` (if tracked)
         - Infer from changed component paths (e.g., `pages/Settings.tsx` → `/settings`)
         - If no routes determinable → ask user once: "Which routes should I visually verify?"
      2. Auto-spawn Lens (visual verification mode):
         ```
         Agent({
           name: "lens-verify",
           description: "Lens: visual verification",
           subagent_type: "coder",
           model: MODEL_OVERRIDE || "sonnet",
           mode: "bypassPermissions",
           run_in_background: true,
           prompt: "{lens persona + visual verification protocol + target routes + task description + expected behavior from contract}"
         })
         ```
      3. **If VISUAL PASS** → proceed to Outcome Recording
      4. **If VISUAL ISSUES FOUND** → enter autonomous visual fix loop:
         a. Lens outputs structured fix packet (issue, screenshot, expected vs actual, element refs)
         b. Cortex auto-dispatches Spark with fix packet (NO user approval needed for visual fixes)
         c. After Spark fixes → re-run Sentinel (verify code still passes)
         d. Re-spawn Lens on same routes (agent-browser: same daemon session)
         e. Max 3 visual fix loops — if unresolved, escalate to user with screenshot evidence
         f. Same visual issue class twice → scrap visual approach, escalate

      If condition NOT met → skip silently (no visual verification needed for non-UI changes).

   b. If FAIL → enter fix sub-loop (max 3):
      i.   Cortex (triage, sonnet) diagnoses failures → scoped repair assignments
      ii.  Spawn repair agents (only failing scope)
      iii. Re-run `Skill(skill="team:verify")` → pass exits loop, fail repeats
      iv.  Same failure twice → write correction to `learnings/{domain}.md ## Corrections` + escalate
      v.   Contract change needed → return to Phase C | Scope expansion → return to Phase B
5. **Pivot escape:** If executor overwhelmed (3 Oracle calls exhausted) → summarize progress, re-enter Phase B, route as CREW.

### D-Crew (CREW-routed tasks)

1. Spawn crew with personas, contracts, learnings, Anti-Repetition Block in every prompt
   - Call `Skill("superpowers:dispatching-parallel-agents")` before 2+ independent agents
   - **Parallel Sparks: use `isolation: "worktree"`** to prevent file conflicts:
     ```
     Agent({
       name: "spark-1",
       description: "Spark: {task}",
       subagent_type: "coder",
       model: MODEL_OVERRIDE || "sonnet",
       mode: "bypassPermissions",
       isolation: "worktree",
       prompt: "{filled spark prompt with ROLE FOCUS + contract + learnings}"
     })
     ```
     After all parallel Sparks complete, Cortex merges worktree branches sequentially. Resolve conflicts if any.
2. Run agents per execution order (parallel where independent with worktree isolation, sequential where dependent)
3. **After each agent:** Post-Agent Hook → validate output, capture handoff
   - **Self-review score check**: Verify Spark's self-review score >= 7. If < 7, note concerns for Prism.
   - **Intent Alignment Checkpoint** (see `cortex.md` "Intent Alignment Checkpoints"):
     Does this agent's output still serve the stated INTENT? Has it drifted from the plan?
     Are interfaces compatible with what the next agent expects? If drift → flag and correct.
   - **Assembly check** (2+ agents done): verify outputs are consistent, match Intent
   - **Oracle checkpoint** (optional, 3+ files changed): quick opus review before testing
4. **Run team:verify** — `Skill(skill="team:verify")`

5. **If PASS** → record what worked to `learnings/INDEX.md` (see `_shared-auto-learning.md`)

   ### Visual Verification Gate (auto-triggered)

   **Condition:** `HAS_UI = true` AND changed files include `*.tsx`, `*.jsx`, `*.css`, `*.css.ts`, or `*.scss`.

   If condition met:
   1. Detect target routes from:
      - Contract's `routes` field (if specified)
      - Session state's `affectedRoutes` (if tracked)
      - Infer from changed component paths (e.g., `pages/Settings.tsx` → `/settings`)
      - If no routes determinable → ask user once: "Which routes should I visually verify?"
   2. Auto-spawn Lens (visual verification mode):
      ```
      Agent({
        name: "lens-verify",
        description: "Lens: visual verification",
        subagent_type: "coder",
        model: MODEL_OVERRIDE || "sonnet",
        mode: "bypassPermissions",
        run_in_background: true,
        prompt: "{lens persona + visual verification protocol + target routes + task description + expected behavior from contract}"
      })
      ```
   3. **If VISUAL PASS** → proceed to Outcome Recording
   4. **If VISUAL ISSUES FOUND** → enter autonomous visual fix loop:
      a. Lens outputs structured fix packet (issue, screenshot, expected vs actual, element refs)
      b. Cortex auto-dispatches Spark with fix packet (NO user approval needed for visual fixes)
      c. After Spark fixes → re-run Sentinel (verify code still passes)
      d. Re-spawn Lens on same routes (agent-browser: same daemon session)
      e. Max 3 visual fix loops — if unresolved, escalate to user with screenshot evidence
      f. Same visual issue class twice → scrap visual approach, escalate

   If condition NOT met → skip silently (no visual verification needed for non-UI changes).

6. **If FAIL** → fix sub-loop (max 3):
   a. Cortex (triage, sonnet) diagnoses failures → scoped repair assignments
   b. Spawn repair agents (only failing scope)
   c. Re-run `Skill(skill="team:verify")` → pass exits loop, fail repeats
   d. Same failure twice → write correction to `learnings/{domain}.md ## Corrections` + escalate
   d2. Record what failed + what fixed it to `learnings/INDEX.md` (see `_shared-auto-learning.md`).
   e. Contract change needed → return to Phase C | Scope expansion → return to Phase B

### Outcome Recording

After all verification passes:
```
TaskCreate({
  subject: '[Cortex] DECISION:outcome {TICKET}',
  description: 'Goal: {summary}\nRoute: {solo|crew}\nOutcome: {pass|fail}\nFix loops: {0-3}\nDuration: {minutes}\nCorrections applied: {list or "none"}\nNew corrections: {list or "none"}'
})
```

---

## Phase E — Completion

After all verification and review passes:

0. **Goal Gate:**
   a. Load `Done When` predicates from `sessions/{TICKET}/intent.md`
   b. Evaluate each predicate against current state (verification results, Prism score, file changes, UAT status)
   c. For each predicate, mark: ✓ met / ✗ unmet / ? unverifiable
   d. **If all predicates met** → proceed to step 1
   e. **If any predicate unmet** → loop back to Phase B with delta:
      - Capture which predicates failed and why
      - Update plan with the gap
      - Re-enter Phase D (skip Phase C if contracts still valid)
      - Max 3 goal-loop iterations — if still unmet after 3, escalate to user with full predicate status
   f. **If any predicate unverifiable** → ask user to confirm/deny that predicate before proceeding

1. **Detect PR strategy** (from `_shared-repo-detection.md`):
   - Check `HAS_UI` and whether changed files touch UI layer
   - Check `visualVerification.status` from session state
   - **UI touched + visual verification PASSED in Phase D** → create draft PR (visual already verified autonomously)
   - **UI touched + visual verification SKIPPED or FAILED** → push branch only, notify user: "Branch pushed. Visual verification {skipped|failed} — verify manually, then run `/team:wrap`."
   - **No UI touched** → create draft PR: `gh pr create --draft --title "{TICKET}: {summary}" --body "..."`

2. **Auto-wrap** — flow directly into `/team:wrap`:
   ```
   Skill(skill="team:wrap")
   ```
   This handles: learnings, crew eval, Jira transition, PR creation, session archive.
   No manual `/team:wrap` needed — completion flows straight through.
   
   **Exception:** If visual verification was skipped/failed for UI work → STOP here, push branch, ask user to verify manually and run `/team:wrap` when ready.

> **Output on completion** (pick one randomly):
> ```
>   ╭───────────────────────────╮
>   │                           │
>   │   MISSION COMPLETE  ✓     │
>   │                           │
>   │   Files:    {N} changed   │
>   │   Verify:   PASS          │
>   │   Visual:   {PASS|N/A}    │
>   │   Prism:    {verdict} {X.X}/10│
>   │   Reflexion: {N} loops    │
>   │   PR:       {#N or branch}│
>   │   Learned:  {N} patterns  │
>   │                           │
>   ╰───────────────────────────╯
> ```
> Fun message (random): "Ship it like it's hot." | "Code verified. Coffee earned." | "Another one bites the dust." | "0 bugs found. Suspiciously clean." | "PR drafted. Your move, reviewer." | "Patterns learned: {N}. Mistakes remembered: forever."
