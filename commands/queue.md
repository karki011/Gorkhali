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

> To run the coordinator: `/phantom:loop` (alias `/phantom:q`) — runs one pass and prints the recurrence command. Recur with `/loop /phantom:loop`. Manual fallback: type `/loop /phantom:queue` in a running session.

**Visibility**: every planner (and later executor) appears in Claude Code's agents view — status bar `← for agents` — open any to watch it live. The coordinator session itself can be sent to the background with `/background` to free the terminal, and revisited from the same list.

The coordinator NEVER writes inside any worktree — planner agents author all in-worktree artifacts. The coordinator's only writable surfaces are the queue state dirs and `<data>/state/queue-<repo>.json`.

## Step 0: Hard Gates (fail-safe — check in order, first failure wins)

Before reading ANY config value: self-resolve the plugin dir, then resolve the config path FIRST via `PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"; [ -z "$PR" ] && { echo "QUEUE INACTIVE: phantom plugin dir not resolvable — run /plugin to install. Nothing polled, nothing spawned."; exit 0; }; node -p "require('$PR/scripts/lib/config-lite.js').resolveConfigPath()"` (resolution order: `PHANTOM_CONFIG` env → `${PHANTOM_DATA}/config.yaml` → legacy `~/.claude/phantom/config.yaml`), reading flags via config-lite `readFlag`/`readString` semantics. NEVER a bare/hardcoded `config.yaml` path — reading the legacy file directly once made a coordinator go falsely INACTIVE. **Empty `$PR` is a hard gate** (gate 0): the `[ -z "$PR" ]` check above STOPS cleanly with the INACTIVE line — never proceed into config resolution with an empty `$PR` (would make `node "$PR/scripts/..."` → `node "/scripts/..."` → MODULE_NOT_FOUND).

`--status` in $ARGUMENTS → skip gates (a)-(c), read-only: render the Step 5 report from the queue dirs + state file, then stop. No polling, no spawning, no state-file write.

a. config.yaml `queue.enabled` false or missing →
   `QUEUE INACTIVE: queue.enabled is false — nothing polled, nothing spawned.`
b. config.yaml `jira.project` missing →
   `QUEUE INACTIVE: jira.project not configured — nothing polled, nothing spawned.`
c. Atlassian MCP unavailable →
   `QUEUE INACTIVE: Atlassian MCP unavailable — nothing polled, nothing spawned.`

## Step 1: Poll

Via the Atlassian MCP search tool:

```
project = {jira.project} AND assignee = currentUser() AND status = "{queue.jira_status}" AND (labels IS EMPTY OR labels NOT IN ("no-ai"))
```

Status name ALWAYS from config (`queue.jira_status`) — never hardcode it. Verified default: `Ready for Implementation`.

## Step 2: Dedup (directory-authoritative)

Skip any ticket that has:

- an entry in ANY of `queued/` `approved/` `running/` `rejected/` — resolve per state via `node -p "require('$PR/scripts/lib/phantom-paths').queueEntryPath('<TICKET>','<state>')"` (`$PR` = the self-resolved plugin dir from Step 0; states from `QUEUE_STATES`), OR
- an existing `sessions/<TICKET>/` dir, OR
- a parked record in `<data>/state/queue-<repo>.json` (see Step 4).

EVERY skip appears in the report with its reason + the manual unblock (delete the entry file / remove the session dir / remove the parked record). `rejected/` is terminal in v1 — re-queue is a deliberate manual deletion of the entry file.

## Step 3: Per New Ticket (park-not-crash)

ANY failure parks that ticket with a reason row and the pass continues with the next ticket. Take new tickets only while in-flight (entries in `running/` + live planner spawns) stays under `queue.max_concurrent`; overflow waits for a later pass.

**Planner cap (interactive)**: before spawning background planners, count planners currently in flight — spawned by this coordinator, queue entry not yet appeared. At or over `queue.planner_max_concurrent` (config, default 3) → remaining tickets are reported `waiting (planner cap)` and picked up next pass. Never hardcode the operative number.

a. `git fetch origin` in the source repo first.
b. `bin/phantom-preflight --ticket <TICKET> --repo <repo-path> --json` — REPORT-ONLY. Exit non-zero → park with the failing check name.
c. Worktree: resolve `node -p "require('$PR/scripts/lib/phantom-paths').worktreeDir('<TICKET>')"` (`$PR` = the self-resolved plugin dir from Step 0), then `git worktree add <dir> -b feat/<ticket-lower> origin/<default-branch>`. Branch-exists / path collision / dirty source → park + print the cleanup hint (`git worktree remove <dir>`; `git branch -D feat/<ticket-lower>`).
d. Spawn the Phase A planner:
   ```
   Agent call:
     description: "Queue planner: {TICKET}"
     run_in_background: true
     mode: "bypassPermissions"
     # model omitted — inherits the session model
     # cwd = the ticket's worktree; PHANTOM_REPO=<repo> is conceptually per-spawn — record the repo in the prompt
     prompt: |
       Self-resolve the plugin dir env-free (`PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"`), then read $PR/commands/start.md and execute it as a procedure for <TICKET> --to-plan. Never ask the user questions — pick recommended defaults and record every assumption. You are in the ticket's worktree; the queue entry write and EXIT protocol are defined in start.md's '## Mode: --to-plan' section.
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

End every report with the launch instruction block from the Contract, plus one line pointing at the agents view (status bar `← for agents`) for watching live planners.

## Notify (seam)

When a pass queues >=1 NEW plan (both modes), fire a desktop notification:

```sh
osascript -e 'display notification "Phantom queued N plan(s) (TICKETS) — run /phantom:approve" with title "Phantom"'
```

Substitute N and the ticket list. Failure ignored — never blocks the pass.

If config `integrations.slack_mcp` && `slack.enabled` && `slack.dm_channel` non-empty → send a one-line pass summary via the Slack MCP message tool to `slack.dm_channel`.
Else append `slack: skipped (not configured)` to the report and continue.
Never block on notify failure.

</instructions>
