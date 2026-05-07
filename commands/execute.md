---
name: team:execute
description: Execute a saved plan (blocks without contracts)
---

> Load `_shared.md` + `_shared-repo-detection.md` + `_shared-crew.md` + `_shared-contracts.md` + `_shared-superpowers.md` + `_shared-auto-learning.md` before executing.

# /team:execute

Load saved plan from `state/sessions/{TICKET}.json` (status: planned).

**Run Pre-Execute Hook** -- verify contracts exist and owners assigned. Block if not.

Spawn crew per the saved plan. Follow Phase D from `/team:start`:

1. Spawn crew with: personas from `.claude/agents/`, assigned contracts, skills, learnings
   - **Dispatch discipline**: Call `Skill(skill="superpowers:dispatching-parallel-agents")` before spawning agents. Enforces: one agent per domain, `isolation: "worktree"` for parallel file-modifying agents, focused self-contained prompts, verify integration after all return
2. Run agents per execution order (parallel where independent, sequential where dependent)
3. **After each agent: run Post-Agent Hook** -- validate output, capture handoff, check unblocked
4. When all build agents done -> spawn Sentinel for tests against contracts
5. **MANDATORY VERIFICATION GATE — NO SKIP, NO EXCEPTIONS:**
   a. Discover verify commands from `_shared-repo-detection.md` (repo CLAUDE.md → scripts → stack defaults)
   b. Spawn Sentinel with discovered commands — NOT hardcoded `pnpm check`/`pnpm build`
   c. Call `Skill(skill="superpowers:verification-before-completion")` — every PASS/FAIL claim must have fresh evidence
   d. Cortex does NOT have permission to skip this step or report "done" without verification evidence
   e. If Sentinel reports success without running commands → REJECT and re-run
6. **Run Post-Verify Hook** -- capture verification result in session JSON
7. **If PASS** -> proceed to step 9
8. **If FAIL** -> enter fix sub-loop:
   a. Increment `verification.loop` in session JSON
   b. Call `Skill(skill="superpowers:systematic-debugging")` to load debugging discipline before Cortex (triage) triage
   c. Spawn **Cortex (triage)** (model: sonnet) to triage failures and create fix packet
   c. Cortex assigns scoped repairs -- only the failing scope, no new features
   d. Spawn repair agents (only assigned owners, only failing files)
   e. After repairs -> re-run Sentinel verification
   f. If pass -> exit loop, proceed to step 9
   g. If fail -> repeat from step 8a (max 3 loops, then escalate to user)
   h. **Same failure twice** -> write correction to relevant `learnings/{domain}.md` under `## Corrections` + escalate
   h2. **AUTO-LEARNING TRIGGER 2** (mandatory): Record what failed AND what fixed it per `_shared-auto-learning.md`. Every fix loop iteration produces a learning entry.
   i. **Contract must change** -> return to contract phase
   j. **Scope expansion** -> return to planning
9. **Quality pipeline** (after verification passes, before Prism):
   a. Call `Skill(skill="simplify")` — review changed code for reuse, quality, efficiency. Fix issues found.
   b. Call `Skill(skill="code-review:code-review")` — code review changed files against repo conventions
   c. If simplify or code-review produced changes → re-run Sentinel (verify fixes didn't break anything)
   d. **AUTO-LEARNING TRIGGER 1** (mandatory): Record what worked — extract files, approach, strategy. Write to INDEX.md per `_shared-auto-learning.md`.
10. If risk >= medium -> spawn Prism (gauntlet mode)
11. If risk = low -> spawn Prism for advisory review

---

## Phase E — Completion

After all verification and review passes:

1. **Detect PR strategy** (from `_shared-repo-detection.md`):
   - If changed files touch UI layer → push branch only, tell user to verify visually
   - If no UI touched → create draft PR: `gh pr create --draft --title "{TICKET}: {summary}" --body "..."`
   - Never create a ready-for-review PR automatically
2. **Update Jira — MANDATORY, DO NOT SKIP** (if Atlassian MCP available AND TICKET detected):
   a. Get available transitions: `mcp__atlassian__getTransitionsForJiraIssue(issueKey: TICKET)`
   b. Find transition with name containing "Review" or "Reviewing"
   c. Execute transition: `mcp__atlassian__transitionJiraIssue(issueKey: TICKET, transitionId: {id})`
   d. Add comment with PR/branch link: `mcp__atlassian__addCommentToJiraIssue(issueKey: TICKET, body: "...")`
   - Draft PR created → transition to "Reviewing" + comment with PR URL
   - Branch pushed only → transition to "Reviewing" + comment with branch name
   - If transition fails → log warning but do NOT block completion
   - Cortex does NOT have permission to skip this. User should NEVER have to ask "move ticket to reviewing".
3. Emit outcome recording (existing pattern from `/team:start`)
