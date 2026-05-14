---
name: team:start
description: "Use when starting any new feature, bug fix, refactor, or task. Also use when user provides a Jira ticket (CP-*, CLOUD-*), says 'implement', 'build', 'fix', 'work on', or describes a requirement. Plans, decomposes, and executes with multi-agent crew."
argument-hint: "<requirement>"
---

> **Lazy-load shared tiers by phase:**
> A: `_shared.md` + `_shared-repo-detection.md` + `_shared-phantom-integration.md` (optional) → B: + `_shared-crew.md` → C: + `_shared-contracts.md` → D: + `_shared-board.md` (event log) + `_shared-auto-learning.md`

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
5. **Phantom graph readiness** (if phantom available):
   - Call `phantom_graph_build` to trigger async index rebuild (non-blocking)
   - Call `phantom_conflict_status` — if file-level conflicts detected with other sessions, warn user
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

7. **Phantom strategy advisory** (if phantom available):
   - Call `phantom_orchestrator_process({ goal: "{TICKET} — {summary}", activeFiles: [plan file list] })`
   - Map returned strategy to SOLO/CREW routing (see `_shared-phantom-integration.md`)
   - Call `phantom_orchestrator_history({ limit: 10 })` — merge failed approaches into anti-repetition notes

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
3. Show summary, get "Execute now" confirmation

---

## Phase D — Execution

> **Before ANY agent spawn:** Run anti-repetition loader (`templates/anti-repetition-loader.md`). Build the Anti-Repetition Block once, inject into every agent prompt.
> **Phantom scoping** (if phantom available): Call `phantom_before_edit` with all planned files. Use blast radius to validate agent scope and discover missing related files. Pass directlyAffected list to Sentinel.
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
   a. If PASS → record what worked to `learnings/INDEX.md` (see `_shared-auto-learning.md`), proceed to Outcome Recording
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
2. Run agents per execution order (parallel where independent, sequential where dependent)
3. **After each agent:** Post-Agent Hook → validate output, capture handoff
   - **Self-review score check**: Verify Spark's self-review score >= 7. If < 7, note concerns for Prism.
   - **Intent Alignment Checkpoint** (see `cortex.md` "Intent Alignment Checkpoints"):
     Does this agent's output still serve the stated INTENT? Has it drifted from the plan?
     Are interfaces compatible with what the next agent expects? If drift → flag and correct.
   - **Assembly check** (2+ agents done): verify outputs are consistent, match Intent
   - **Oracle checkpoint** (optional, 3+ files changed): quick opus review before testing
4. **Run team:verify** — `Skill(skill="team:verify")`

5. **If PASS** → record what worked to `learnings/INDEX.md` (see `_shared-auto-learning.md`), proceed to Outcome Recording
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
   - UI touched → push branch only, notify user: "Branch pushed. Verify visually, then run `/team:wrap` to create PR."
   - No UI touched → create draft PR: `gh pr create --draft --title "{TICKET}: {summary}" --body "..."`
2. **Update Jira** (if Atlassian MCP available AND TICKET detected):
   a. Get available transitions: `mcp__atlassian__getTransitionsForJiraIssue(issueKey: TICKET)`
   b. Find transition with name containing "Review" or "Reviewing"
   c. Execute transition: `mcp__atlassian__transitionJiraIssue(issueKey: TICKET, transitionId: {id})`
   d. Add comment with PR/branch link: `mcp__atlassian__addCommentToJiraIssue(issueKey: TICKET, body: "...")`
   - If draft PR created → transition to "Reviewing" + comment with PR URL
   - If branch pushed only → transition to "Reviewing" + comment with branch name
   - If transition fails → log warning but do not block completion
3. **Emit outcome** (existing Outcome Recording block)

> **Output on completion** (pick one randomly):
> ```
>   ╭───────────────────────────╮
>   │                           │
>   │   MISSION COMPLETE  ✓     │
>   │                           │
>   │   Files:    {N} changed   │
>   │   Verify:   PASS          │
>   │   Prism:    {verdict} {X.X}/10│
>   │   Reflexion: {N} loops    │
>   │   PR:       {#N or branch}│
>   │   Learned:  {N} patterns  │
>   │                           │
>   ╰───────────────────────────╯
> ```
> Fun message (random): "Ship it like it's hot." | "Code verified. Coffee earned." | "Another one bites the dust." | "0 bugs found. Suspiciously clean." | "PR drafted. Your move, reviewer." | "Patterns learned: {N}. Mistakes remembered: forever."
