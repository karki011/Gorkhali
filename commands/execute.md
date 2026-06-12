---
name: phantom:execute
description: "Use when a plan is already ready and you want to run it — dispatch agents, kick off implementation, or start execution. Also use when user says 'run the plan', 'start executing', 'go', 'let's do it', 'dispatch agents', or 'implement now'. NOT for new work without a plan — use phantom:start instead."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
user-invocable: false
---

> **Preamble Tier: T2**

# /phantom:execute "$ARGUMENTS"

Execute a plan from artifacts. Used by start.md router or standalone.

<instructions>

1. **Detect ticket** from $ARGUMENTS or git branch

2. **Load plan**: Read `{TEAM_DIR}/sessions/{TICKET}/plan.json`
   - If missing: "No plan found. Run `/phantom:start` first."
   Checkpoint: `node ${CLAUDE_PLUGIN_ROOT}/scripts/lib/checkpoint.js write {SESSION_DIR}/checkpoints plan-loaded` (advisory; resume reads latest).

3. **Load contracts**: Read `{TEAM_DIR}/sessions/{TICKET}/contracts/`
   - If missing: BLOCK. "No contracts. Run planning phase first."

4. **Load intent**: Read `{TEAM_DIR}/sessions/{TICKET}/intent.json`

5. **Activate blade marker**: `touch ${PHANTOM_DATA:-~/.claude/phantom-data}/.blade-editing`

6. **Dispatch per plan**:
   - READ `reference/agents.md` for spawn patterns and task tier classification
   - All implementation tasks spawn `subagent_type: blade`. Apex picks the model per subtask
     (see `reference/agents.md` → Model Routing):
     # default: omit (inherits session model); `model: "sonnet"` for small, single-concern subtasks with a tight contract.
     # effort is uniform high (session-inherited) — there is no per-spawn effort param.
   - **Mechanical-edit fast path:** for truly trivial single-file edits (rename, import, typo, config),
     spawn `subagent_type: blade` with `model: "haiku"` override.
   - All agents: `mode: "bypassPermissions"`.
   - SOLO route: spawn 1 `subagent_type: blade` with full task scope
   - SHADOWS route: spawn parallel `subagent_type: blade` agents with `isolation: "worktree"`
     (sonnet/haiku override for small or trivial subtasks only)
   - Anti-repetition: search `learnings/INDEX.md`, inject corrections into agent prompts
   - Agent results → `{TEAM_DIR}/sessions/{TICKET}/agent-outputs/{task-id}.md`
   - Summary of each agent result enters conversation (full output stays in file)

   Checkpoint: `node ${CLAUDE_PLUGIN_ROOT}/scripts/lib/checkpoint.js write {SESSION_DIR}/checkpoints dispatch-wave-complete` (advisory; resume reads latest).

7. **Deactivate blade marker**: `rm -f ${PHANTOM_DATA:-~/.claude/phantom-data}/.blade-editing`

<output_format>

8. **Write execution artifact** to `{TEAM_DIR}/sessions/{TICKET}/execution.json`:
   ```json
   {
     "_meta": {
       "writtenAt": "{ISO 8601}",
       "gitHead": "{HEAD sha}",
       "gitBranch": "{branch}",
       "phase": "D",
       "skill": "phantom:execute",
       "version": 1
     },
     "tasks": [
       {
         "id": "t1",
         "status": "done",
         "agent": "blade-pagination",
         "filesChanged": ["src/hooks/usePagination.ts"],
         "filesRead": ["src/api/client.ts"],
         "selfReviewScore": 8,
         "testResult": { "passed": true, "summary": "5 tests green" },
         "blocker": null,
         "outputSummary": "Added usePagination hook"
       }
     ],
     "totalSpawns": 3
   }
   ```

   Populate each task from the Blade's typed completion record — `filesChanged`, `filesRead`, `selfReviewScore`, `testResult`, `blocker`, `outputSummary`. Read these fields directly; do NOT re-parse the free-text handoff. `status` is one of `done` | `failed` | `skipped`.

</output_format>

<no_git_until_wrap>

   Checkpoint: `node ${CLAUDE_PLUGIN_ROOT}/scripts/lib/checkpoint.js write {SESSION_DIR}/checkpoints execution-json-written` (advisory; resume reads latest).

9. **No git operations.** All work is local until wrap.

</no_git_until_wrap>

</instructions>
