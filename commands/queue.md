---
name: phantom:queue
description: "Use when starting or running the Mission Control queue, or polling ready tickets for autonomous planning. Also use when user says 'queue', 'poll my tickets', or 'start the coordinator'. One poll pass per invocation: gates, Jira poll, dedup, planner spawns, reap, report."
argument-hint: "[--status]"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS"]
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md`

# /phantom:queue

Mission Control coordinator: ONE poll pass — gates → poll → dedup → spawn planners → reap → report.

<instructions>

## Contract

ONE poll pass per invocation. Recurrence comes from the user-run `/loop` wrapper — this skill NEVER launches `/loop` itself (validated learning: skills cannot self-launch loops/workflows). Every report — active or INACTIVE — ends with this literal launch instruction block:

> To run the coordinator: launch a dedicated session with `PHANTOM_UNATTENDED=1 claude`, then type `/loop /phantom:queue`.

The coordinator NEVER writes inside any worktree — planner agents author all in-worktree artifacts. The coordinator's only writable surfaces are the queue state dirs and `<data>/state/queue-<repo>.json`.

## Step 0: Hard Gates (fail-safe — check in order, first failure wins)

`--status` in $ARGUMENTS → skip gates (a)-(d), read-only: render the Step 5 report from the queue dirs + state file, then stop. No polling, no spawning, no state-file write.

a. `PHANTOM_UNATTENDED` env unset → print
   `QUEUE INACTIVE: session not armed — relaunch with PHANTOM_UNATTENDED=1 (see reference/unattended.md). Nothing polled, nothing spawned.`
   and STOP. This is a HARD gate: the Phase-0 gate hooks must be live before any autonomous spawning — an unarmed session must refuse, not run ungated.
b. config.yaml `queue.enabled` false or missing →
   `QUEUE INACTIVE: queue.enabled is false — nothing polled, nothing spawned.`
c. config.yaml `jira.project` missing →
   `QUEUE INACTIVE: jira.project not configured — nothing polled, nothing spawned.`
d. Atlassian MCP unavailable →
   `QUEUE INACTIVE: Atlassian MCP unavailable — nothing polled, nothing spawned.`

## Step 1: Poll

Via the Atlassian MCP search tool:

```
project = {jira.project} AND assignee = currentUser() AND status = "{queue.jira_status}" AND (labels IS EMPTY OR labels NOT IN ("no-ai"))
```

Status name ALWAYS from config (`queue.jira_status`) — never hardcode it. Verified default: `Ready for Implementation`.

## Step 2: Dedup (directory-authoritative)

Skip any ticket that has:

- an entry in ANY of `queued/` `approved/` `running/` `rejected/` — resolve per state via `node -p "require('${CLAUDE_PLUGIN_ROOT}/scripts/lib/phantom-paths').queueEntryPath('<TICKET>','<state>')"` (states from `QUEUE_STATES`), OR
- an existing `sessions/<TICKET>/` dir, OR
- a parked record in `<data>/state/queue-<repo>.json` (see Step 4).

EVERY skip appears in the report with its reason + the manual unblock (delete the entry file / remove the session dir / remove the parked record). `rejected/` is terminal in v1 — re-queue is a deliberate manual deletion of the entry file.

## Step 3: Per New Ticket (park-not-crash)

ANY failure parks that ticket with a reason row and the pass continues with the next ticket. Take new tickets only while in-flight (entries in `running/` + live planner spawns) stays under `queue.max_concurrent`; overflow waits for a later pass.

a. `git fetch origin` in the source repo first.
b. `bin/phantom-preflight --ticket <TICKET> --repo <repo-path> --json` — REPORT-ONLY. Exit non-zero → park with the failing check name. NEVER pass the arming flag here: arming is the session env set at launch, not per-ticket markers.
c. Worktree: resolve `node -p "require('${CLAUDE_PLUGIN_ROOT}/scripts/lib/phantom-paths').worktreeDir('<TICKET>')"`, then `git worktree add <dir> -b feat/<ticket-lower> origin/<default-branch>`. Branch-exists / path collision / dirty source → park + print the cleanup hint (`git worktree remove <dir>`; `git branch -D feat/<ticket-lower>`).
d. Spawn the Phase A planner:
   ```
   Agent call:
     description: "Queue planner: {TICKET}"
     run_in_background: true
     mode: "bypassPermissions"
     # model omitted — inherits the session model
     # cwd = the ticket's worktree; PHANTOM_REPO=<repo> is conceptually per-spawn — record the repo in the prompt
     prompt: |
       Read ${CLAUDE_PLUGIN_ROOT}/commands/start.md and execute it as a procedure for <TICKET> --to-plan. Never ask the user questions — pick recommended defaults and record every assumption. You are in the ticket's worktree; the queue entry write and EXIT protocol are defined in start.md's '## Mode: --to-plan' section.
       Repo: <repo> (PHANTOM_REPO).
   ```

The COORDINATOR never writes inside any worktree — planner agents author all in-worktree artifacts.

## Step 4: Reap Prior Spawns

For each previously spawned planner:

- **Valid queue entry appeared** → VALIDATE against the approval-queue entry schema in `reference/artifact-schemas.md`. Malformed or missing required fields → move/record as parked `invalid-entry`. Valid → done, report `[QUEUED]`.
- **Agent finished/failed with NO entry**, or no entry after `queue.planner_timeout_minutes` (config, default 30) since spawn → park as `planner-crashed` in the parked list of `<data>/state/queue-<repo>.json`. Dedup consults this list — no double-plan, no silent skip. Manual retry = remove the parked record.

## Step 5: Report + Pacing

Table — `ticket | state | detail` — covering queued / parked / skipped / in-flight.

Maintain `{emptyPolls, lastPoll, parked[]}` in `<data>/state/queue-<repo>.json`. SINGLE-WRITER: only this skill ever writes it — `phantom:approve` must not.

Next-wake recommendation: `queue.poll_minutes` normally; `queue.backoff_minutes` once `emptyPolls >= queue.backoff_after_empty`. Values in the recommendation line are always READ from config — never literal.

Worktree lifecycle is manual in v1: after a ticket's PR merges, `git worktree remove <dir>` + delete the `feat/<ticket-lower>` branch (wrap prints this hint too).

End every report with the launch instruction block from the Contract.

## Notify (seam)

If config `integrations.slack_mcp` && `slack.enabled` && `slack.dm_channel` non-empty → send a one-line pass summary via the Slack MCP message tool to `slack.dm_channel`.
Else append `slack: skipped (not configured)` to the report and continue.
Never block on notify failure.

</instructions>
