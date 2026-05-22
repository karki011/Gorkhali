---
name: team:execute
description: "Execute a saved plan (blocks without contracts)"
---

> **Preamble Tier: T2**

# /team:execute "$ARGUMENTS"

Execute a plan from artifacts. Used by start.md router or standalone.

1. **Detect ticket** from $ARGUMENTS or git branch

2. **Load plan**: Read `state/sessions/{TICKET}/plan.json`
   - If missing: "No plan found. Run `/team:start` first."

3. **Load contracts**: Read `state/sessions/{TICKET}/contracts/`
   - If missing: BLOCK. "No contracts. Run planning phase first."

4. **Load intent**: Read `state/sessions/{TICKET}/intent.json`

5. **Dispatch per plan**:
   - READ `reference/agents.md` for spawn patterns
   - SOLO route: spawn 1 Spark with full task scope
   - CREW route: spawn parallel Sparks with `isolation: "worktree"`
   - Anti-repetition: search `learnings/INDEX.md`, inject corrections into agent prompts
   - Agent results → `state/sessions/{TICKET}/agent-outputs/{task-id}.md`
   - Summary of each agent result enters conversation (full output stays in file)

6. **Write execution artifact** to `state/sessions/{TICKET}/execution.json`:
   ```json
   {
     "_meta": {
       "writtenAt": "{ISO 8601}",
       "gitHead": "{HEAD sha}",
       "gitBranch": "{branch}",
       "phase": "D",
       "skill": "team:execute",
       "version": 1
     },
     "tasks": [
       {
         "id": "t1",
         "status": "completed",
         "agent": "spark-pagination",
         "filesChanged": ["src/hooks/usePagination.ts"],
         "selfReviewScore": 8,
         "outputSummary": "Added usePagination hook"
       }
     ],
     "totalSpawns": 3
   }
   ```

7. **No git operations.** All work is local until wrap.
