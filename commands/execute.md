---
name: team:execute
description: Execute a saved plan (blocks without contracts)
---

> Load `_shared.md` + `_shared-crew.md` + `_shared-contracts.md` + `_shared-board.md` + `_shared-superpowers.md` before executing.

# /team:execute

Load saved plan from `state/sessions/{TICKET}.json` (status: planned).

**Run Pre-Execute Hook** -- verify contracts exist and owners assigned. Block if not.

Spawn crew per the saved plan. Follow Phase D from `/team:start`:

1. Spawn crew with: personas from `.claude/agents/`, assigned contracts, skills, learnings
   - **Dispatch discipline** (`superpowers:dispatching-parallel-agents`): One agent per domain, `isolation: "worktree"` for parallel file-modifying agents, focused self-contained prompts, verify integration after all return
2. Run agents per execution order (parallel where independent, sequential where dependent)
3. **After each agent: run Post-Agent Hook** -- validate output, capture handoff, check unblocked
4. When all build agents done -> spawn Zoro for tests against contracts
5. Spawn Chopper for verification (lint, typecheck, build, tests)
6. **Run Post-Verify Hook** -- capture verification result in session JSON
7. **If PASS** -> proceed to step 9
8. **If FAIL** -> enter fix sub-loop:
   a. Increment `verification.loop` in session JSON
   b. Spawn **Kureha** (model: sonnet) to triage failures and create fix packet
   c. Luffy assigns scoped repairs -- only the failing scope, no new features
   d. Spawn repair agents (only assigned owners, only failing files)
   e. After repairs -> re-run Chopper verification
   f. If pass -> exit loop, proceed to step 9
   g. If fail -> repeat from step 8a (max 3 loops, then escalate to user)
   h. **Same failure twice** -> write correction to relevant `learnings/{domain}.md` under `## Corrections` + escalate
   i. **Contract must change** -> return to contract phase
   j. **Scope expansion** -> return to planning
9. If risk >= medium -> spawn Sengoku (simplify -> Roger review -> verify)
10. If risk = low -> spawn Roger for advisory review
