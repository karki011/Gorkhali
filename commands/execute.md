---
name: execute
description: "Use when an APPROVED plan already exists and you want to run it — dispatch the plan's agents, execute its waves. Net-new work → phantom:start; continuing a prior session → phantom:resume."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
# Broad/imperative triggers ('go', 'let's do it') are intentionally muted by user-invocable:false — execute is dispatched by phantom:start, not auto-selected from NL. Do not flip this flag without re-checking auto-dispatch safety: a bare 'go' would auto-dispatch agents.
user-invocable: false
---

> **Preamble Tier: T4** — loads ALL shared contexts (canonical registry: `scripts/preamble-tier.js`)

# /phantom:execute "$ARGUMENTS"

Execute a plan from artifacts. Used by start.md router or standalone.

Every `reference/…` pointer below names the canonical text for that rule. Follow it there; this file never restates it.

<instructions>

1. **Detect ticket** from $ARGUMENTS or git branch

2. **Load plan**: Read `{TEAM_DIR}/sessions/{TICKET}/plan.json`
   - If missing: "No plan found. Run `/phantom:start` first."
   Checkpoint: `PR="${PR:-$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)}"; PR="${PR%/}"; if [ -n "$PR" ]; then printf '%s\n' '{"ticket":"{TICKET}"}' | node "$PR/scripts/lib/checkpoint.js" write {SESSION_DIR}/checkpoints plan-loaded || :; fi` (advisory - semantics: `_shared.md` §Checkpoints).

3. **Load contracts**: Read `{TEAM_DIR}/sessions/{TICKET}/contracts/`
   - If missing: BLOCK. "No contracts. Run planning phase first."

4. **Load intent and context**: Read
   `{TEAM_DIR}/sessions/{TICKET}/intent.json` and `context.json` when present.

4.5. **Defect proof gate**: If any loaded intent, context, plan, or contract
   classifies or describes defect/regression work, require
   `workKind: "investigation"` consistently and read
   `{SESSION_DIR}/defect-proof.json`. Classification disagreement or omitted
   proof fails closed.
   Gate per `reference/defect-proof.md`: only
   `ready_for_fix` / `confirmed_defect` may proceed; missing, stale, malformed,
   contradictory, or incomplete proof sets or preserves
   `waiting_for_evidence` / `unconfirmed_defect` and BLOCKS before Engineer
   dispatch. Diagnostic instrumentation requires a recorded, unexpired
   `DiagnosticGrant`, which never authorizes this implementation step.

5. **Per-spawn lifecycle**: validated hooks own Engineer lifecycle state.

6. **Dispatch per plan**:
   - **Budget pre-flight** (BIG fan-out only): before a wide wave, check remaining usage budget per `reference/usage-budget.md` — near the limit (~95%), pause cleanly and emit a resume plan instead of starting work that will get cut off.
   - READ `reference/agents.md` for spawn patterns and task tier classification
   - **Dispatch table (mandatory, before each wave's spawns):** render the pre-dispatch routing
     table exactly as defined in `reference/agents.md` → Pre-Dispatch Routing Table, populated
     from `plan.json` (task id, file targets, wave) and each task's roster-assigned `name` per
     `reference/roster.md`'s Execute-Wave Reservation (e.g. task 1 → `engineer-varek`).
   - All implementation tasks spawn `subagent_type: engineer` with the `model:` resolved by
     `node "$PR/skills/phantom/scripts/resolve-profile.mjs" --role engineer --host claude-code`
     (`{PR_BOOTSTRAP}` per `_shared.md` §Paths; `sonnet` on this host) passed explicitly
     per `reference/agents.md` → Model Routing; effort is the session's `high`, never a
     per-spawn param.
   - **A subtask too big for sonnet is a decomposition failure, not a routing one:** split it and
     re-dispatch, since no delegated role runs above sonnet.
   - All agents: `mode: "bypassPermissions"`.
   - SOLO route: spawn 1 `subagent_type: engineer` with full task scope
   - SHADOWS route: spawn parallel `subagent_type: engineer` agents with `isolation: "worktree"`
   - Anti-repetition: search `learnings/INDEX.md`, inject corrections into agent prompts
   - **Context discipline at spawn** (`reference/agents.md` → Context Discipline):
     spawn prompts reference FILE PATHS for the agent to read itself — never paste large file bodies
     in. After an agent returns, Chief verifies via fs/git spot-check (file exists, ≥1 commit, no
     `Self-Check: FAILED`/verdict-failure line), NOT by re-reading the file or pulling its full output back.
   - **Wake bookkeeping**: before spawning each wave, write each agent's expected record stub to `{TEAM_DIR}/sessions/{TICKET}/agent-records/{name}.json` (`status: "spawned"`, `wave: { index, isLastInWave }` set) so the SubagentStop classifier can resolve it; after reading an agent's result, update its stub with the real typed record. Every Agent spawn MUST pass that identical `{name}` as `name: "{name}"` — the stub filename and the spawn's `name:` param are the SAME string, never independently derived. Native SubagentStop surfaces it as `payload.agent_type`, which is how the classifier keys back to the stub; a name-less spawn cannot be resolved.
   - Agent results → `{TEAM_DIR}/sessions/{TICKET}/agent-outputs/{task-id}.md`
   - Summary of each agent result enters conversation (full output stays in file)
   - **Independent verification assignment**: every implementation task in the
     plan MUST name an Inspector or other read-only verifier that is independent of
     its implementing Engineer. The verifier's name derives from the same task
     index as the task's Engineer per `reference/roster.md`'s Execute-Wave
     Reservation (inspector derivation + overflow rule; e.g. task 1 → `inspector-halden`).
     After that Engineer returns, the verifier reruns the task's acceptance checks and writes
     `{SESSION_DIR}/scope-verifications/{task-id}.json` per
     `reference/defect-proof.md`; for confirmed defects it also reruns the
     reproduction and focused regression check recorded in
     `defect-proof.json`. Do not count Engineer self-review, Engineer-run tests, or
     only a later aggregate suite as the per-scope independent result. A scope
     without its own `status: "passed"` record cannot be marked `done`.

   Checkpoint: `PR="${PR:-$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)}"; PR="${PR%/}"; if [ -n "$PR" ]; then printf '%s\n' '{"ticket":"{TICKET}"}' | node "$PR/scripts/lib/checkpoint.js" write {SESSION_DIR}/checkpoints dispatch-wave-complete || :; fi` (advisory - semantics: `_shared.md` §Checkpoints).

7. **Complete the wave**: wait for every dispatched Engineer and verifier result.

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
         "agent": "engineer-varek",
         "filesChanged": ["src/hooks/usePagination.ts"],
         "filesRead": ["src/api/client.ts"],
         "selfReviewScore": 8,
         "testResult": { "passed": true, "summary": "5 tests green" },
         "independentVerification": {
           "record": "scope-verifications/t1.json",
           "verifier": "inspector-halden",
           "status": "passed",
           "summary": "Reproduction and focused regression check pass"
         },
         "blocker": null,
         "outputSummary": "Added usePagination hook"
       }
     ],
     "totalSpawns": 3
   }
   ```

   Populate each task from the Engineer's typed completion record and the
   independent verifier record: `filesChanged`, `filesRead`,
   `selfReviewScore`, `testResult`, `independentVerification`, `blocker`,
   `outputSummary`. Read these fields directly; do NOT re-parse the free-text
   handoff. `status` is one of `done` | `failed` | `skipped` |
   `done-with-concerns` | `needs-context`; `done` and `done-with-concerns`
   both require a matching independent-verification record with
   `status: "passed"` - `done-with-concerns` is done, read the handoff note
   for the surfaced concern before moving on. `needs-context` is not a wave
   failure: do not treat it as `failed` for wave-completion purposes. Read
   `blocker` for the exact question, answer it, and re-dispatch the same task
   with the answer included - do not re-plan or drop the task.

</output_format>

<no_git_until_wrap>

   Checkpoint: `PR="${PR:-$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)}"; PR="${PR%/}"; if [ -n "$PR" ]; then printf '%s\n' '{"ticket":"{TICKET}"}' | node "$PR/scripts/lib/checkpoint.js" write {SESSION_DIR}/checkpoints execution-json-written || :; fi` (advisory - semantics: `_shared.md` §Checkpoints).

9. **No git operations.** All work is local until wrap.

</no_git_until_wrap>

</instructions>
