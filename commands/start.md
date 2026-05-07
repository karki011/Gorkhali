---
name: team:start
description: "Use when starting any new feature, bug fix, refactor, or task. Also use when user provides a Jira ticket (CP-*, CLOUD-*), says 'implement', 'build', 'fix', 'work on', or describes a requirement. Plans, decomposes, and executes with multi-agent crew."
argument-hint: "<requirement>"
---

> **Lazy-load shared tiers by phase:**
> A: `_shared.md` + `_shared-repo-detection.md` + `_shared-phantom-integration.md` (optional) → B: + `_shared-crew.md` → C: + `_shared-contracts.md` → D: + `_shared-board.md` (event log) + `_shared-auto-learning.md`

# /team:start "$ARGUMENTS"

> **HARD GATES:** (1) `EnterPlanMode` at Phase B start — no exceptions. (2) `Skill("superpowers:writing-plans")` before any plan. (3) All research/scout agents use `model: "opus"`.

---

## Phase A — Context Loading

1. Detect ticket from `$ARGUMENTS` or git branch:
   - If `$ARGUMENTS` matches `[A-Z]+-\d+` (e.g., `CP-41171`): set `TICKET` to that key
   - Otherwise: detect ticket from git branch name (e.g., `cp-41171-hourly-chart` → `CP-41171`)
   - Load `decisions/global.md`
2. **Jira context pull** (if Atlassian MCP available AND `TICKET` detected):
   - Fetch ticket: `mcp__atlassian__getJiraIssue(issueIdOrKey: TICKET, responseContentFormat: "markdown")`
   - Extract: summary, description, acceptance criteria, type, priority, comments, parent epic
   - Merge into `$ARGUMENTS` context — ticket description becomes the requirement
   - Transition Jira to "In Progress" (best-effort, don't block if it fails)
   - If Atlassian MCP not available: skip silently, use `$ARGUMENTS` as-is
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

---

## Phase B — Planning

1. Ask questions, iterate, confirm understanding
2. **Capture Intent** (mandatory — ask or infer):
   ```
   ## Intent
   **Goal:** [success in one sentence]
   **Priority:** [speed | quality | ux | stability | scope — ranked]
   **Acceptable trade-offs:** [what CAN be sacrificed]
   **Non-negotiables:** [what MUST NOT be compromised]
   ```
   Save to: plan, `sessions/{TICKET}/intent.md`, every agent prompt (compact 3-line version).
   Infer if user doesn't engage: bug→stability, feature→speed, figma→ux, refactor→quality.

3. Call `Skill(skill="superpowers:writing-plans")` — defines plan structure, task granularity, quality standards
4. **Codebase-first inventory** + **Anti-repetition check:**
   - Scan `learnings/INDEX.md` + `learnings/{domain}.md ## Corrections` for matching failures
   - Scan `~/.claude/team/global/patterns/INDEX.md` (secondary)
   - If match found: acknowledge, explain difference, or choose alternative
   - Log matches under `## Anti-Repetition Notes` in plan
   - Spawn Explore (opus) + Plan (opus) agents for codebase research
   - Complex tasks (risk >= medium): call `Skill("superpowers:brainstorming")` first

5. Produce plan: crew selection, agent-to-task mapping, contracts, execution order, risks

6. **Validate decomposition** (self-check before presenting):
   - **Uncertainty Reduction:** Does each task meaningfully reduce uncertainty? Reorder riskiest first.
   - **Assembly Consistency:** Will agent outputs actually assemble into the intended outcome? Check interface shapes, missing wiring, Intent alignment.

7. **Devil's Advocate Review** (ALL plans — mandatory):
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

8. **Phantom strategy advisory** (if phantom available):
   - Call `phantom_orchestrator_process({ goal: "{TICKET} — {summary}", activeFiles: [plan file list] })`
   - Map returned strategy to SOLO/CREW routing (see `_shared-phantom-integration.md`)
   - Call `phantom_orchestrator_history({ limit: 10 })` — merge failed approaches into anti-repetition notes
   - Log phantom recommendation alongside Cortex's routing decision

9. Get user approval via `ExitPlanMode`

10. **Emit routing decision:**
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

### D-Solo (SOLO-routed tasks)

Cortex classified as SOLO in Phase B. One Spark drives end-to-end, consulting Oracle when stuck.

1. `TaskCreate({ subject: '[Solo] {task description}' })`
2. Spawn executor using `templates/solo-executor-prompt.md` with variables filled:
   ```
   Agent({
     description: "Solo: {task description}",
     subagent_type: "coder", model: "sonnet",
     mode: "bypassPermissions", run_in_background: true,
     prompt: "{filled solo-executor-prompt template}"
   })
   ```
3. On completion: review report, check Oracle usage. If blockers → pivot to CREW.
4. **MANDATORY VERIFICATION GATE — NO SKIP, NO EXCEPTIONS:**
   a. Load `_shared-repo-detection.md` → discover verify commands for this repo
   b. Spawn Sentinel with discovered commands (NOT hardcoded `pnpm check`)
   c. Call `Skill(skill="superpowers:verification-before-completion")` — evidence before claims
   d. If PASS → run quality pipeline before Prism:
      i.  Call `Skill(skill="simplify")` — review changed code for reuse, quality, efficiency. Fix issues found.
      ii. Call `Skill(skill="code-review:code-review")` — code review changed files against repo conventions
      iii. If simplify or code-review produced changes → re-run Sentinel (verify fixes didn't break anything)
      iv. Spawn Prism (advisory if low risk, gauntlet if medium+)
   g. **AUTO-LEARNING TRIGGER 1** (mandatory): Record what worked — see `_shared-auto-learning.md`. Extract files, approach, strategy. Write to INDEX.md.
   e. If FAIL → enter fix sub-loop (same as D-Crew step 6)
   f. Cortex does NOT have permission to skip this step or report "done" without verification evidence
5. **Pivot escape:** If executor overwhelmed (3 Oracle calls exhausted) → summarize progress, re-enter Phase B, route as CREW.

### D-Crew (CREW-routed tasks)

1. Spawn crew with personas, contracts, learnings, Anti-Repetition Block in every prompt
   - Call `Skill("superpowers:dispatching-parallel-agents")` before 2+ independent agents
2. Run agents per execution order (parallel where independent, sequential where dependent)
3. **After each agent:** Post-Agent Hook → validate output, capture handoff
   - **Assembly check** (2+ agents done): verify outputs are consistent, match Intent
   - **Oracle checkpoint** (optional, 3+ files changed): quick opus review before testing
4. **MANDATORY VERIFICATION GATE — NO SKIP, NO EXCEPTIONS:**
   a. Load `_shared-repo-detection.md` → discover verify commands for this repo
   b. Spawn Sentinel with discovered commands (NOT hardcoded `pnpm check`)
   c. Call `Skill(skill="superpowers:verification-before-completion")` — evidence before claims
   d. Cortex does NOT have permission to skip this step or report "done" without verification evidence
5. **If PASS** → run quality pipeline:
   a. Call `Skill(skill="simplify")` — review changed code for reuse, quality, efficiency. Fix issues found.
   b. Call `Skill(skill="code-review:code-review")` — code review changed files against repo conventions
   c. If simplify or code-review produced changes → re-run Sentinel (verify fixes didn't break anything)
   d. Proceed to step 7
   e. **AUTO-LEARNING TRIGGER 1** (mandatory): Record what worked — see `_shared-auto-learning.md`. Extract files, approach, strategy. Write to INDEX.md.
6. **If FAIL** → fix sub-loop (max 3):
   a. Cortex (triage, sonnet) diagnoses failures → scoped repair assignments
   b. Spawn repair agents (only failing scope)
   c. Re-run Sentinel → pass exits loop, fail repeats
   d. Same failure twice → write correction to `learnings/{domain}.md ## Corrections` + escalate
   d2. **AUTO-LEARNING TRIGGER 2** (mandatory): Record what failed AND what fixed it — see `_shared-auto-learning.md`. Write correction to INDEX.md.
   e. Contract change needed → return to Phase C | Scope expansion → return to Phase B
7. Prism review: gauntlet mode if risk >= medium, advisory if low

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

1. **Detect PR strategy** (from `_shared-repo-detection.md`):
   - Check `HAS_UI` and whether changed files touch UI layer
   - UI touched → push branch only, notify user: "Branch pushed. Verify visually, then run `/team:wrap` to create PR."
   - No UI touched → create draft PR: `gh pr create --draft --title "{TICKET}: {summary}" --body "..."`
2. **Update Jira** (if Atlassian MCP available):
   - If draft PR created → transition to "Reviewing" + add PR link comment
   - If branch pushed only → add comment: "Branch pushed: {branch}. Awaiting visual verification."
3. **Emit outcome** (existing Outcome Recording block)
