---
name: phantom:approve
description: "Use when reviewing, approving, or rejecting queued Mission Control plans. Also use when user says 'approve', 'what's queued', or 'review the queue'."
argument-hint: "<TICKET|--all> [--reject <TICKET> --reason <text>]"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS"]
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md`

# /phantom:approve "$ARGUMENTS"

Human batch-approval gate for Mission Control. Reviews plans parked by `/phantom:start --to-plan`, approves or rejects them, and dispatches approved plans to background executors (Phase B).

Queue layout: `<data>/repos/<repo>/approval-queue/{queued,approved,running,rejected}/<TICKET>.json` — resolve paths via `node -p "require('${CLAUDE_PLUGIN_ROOT}/scripts/lib/phantom-paths').queueEntryPath('<TICKET>','<state>')"` (entry schema: `reference/artifact-schemas.md` → Approval-Queue Entry). **Directory placement is the authoritative lifecycle state**; the `status` field inside the JSON is informational only. Every state transition is a `mv` within the same filesystem.

> **Invariants:** The coordinator NEVER writes inside a worktree — executor agents author all in-worktree changes. NEVER touch `<data>/state/queue-<repo>.json` — single-writer: `queue.md` owns it.

<instructions>

## Step 1: List (default, read-only)

No arguments → print a table of `queued/` entries and STOP (no moves, no spawns):

| ticket | summary | files | assumptions | selfCheck |

- `files` = count of files in the entry's `planRef` plan.json
- `assumptions` = count from the entry's `assumptions[]` + 1-line highlights of the notable ones
- Entries with `selfCheck != "pass"` are HIGHLIGHTED — print the finding summary so the approver reads it before deciding.

Also list `approved/` (waiting for dispatch) and `running/` (in flight) counts for situational awareness.

## Step 2: Approve

For each named ticket (or every `queued/` entry when `--all`):

1. **RE-VERIFY the worktree is clean**: `git -C <worktree> status --porcelain` (worktree path from the entry). ANY output → **REFUSE** this entry: print the dirty paths as the reason, leave the entry in `queued/` for human inspection, and never spawn from it (source-clean invariant). Plan-time cleanliness does not transfer — time has passed since the entry was written.
2. Move `queued/<T>.json` → `approved/<T>.json`, adding `"approvedAt"` (ISO 8601).

## Step 3: Phase B Dispatch (atomic claim + cap)

Concurrency cap = `queue.max_concurrent` from config.yaml. NEVER hardcode the operative number — `3` is only the config default, the config value rules.

Resolve config.yaml FIRST via `node -p "require(process.env.CLAUDE_PLUGIN_ROOT + '/scripts/lib/config-lite.js').resolveConfigPath()"` (resolution order: `PHANTOM_CONFIG` env → `${PHANTOM_DATA}/config.yaml` → legacy `~/.claude/phantom/config.yaml`), reading values via config-lite `readFlag`/`readString` semantics — this applies to EVERY config read in this skill. NEVER a bare/hardcoded `config.yaml` path.

Before dispatch: if env `PHANTOM_UNATTENDED` is unset, print:
`WARNING: executors will run WITHOUT enforced safety gates (advisory mode) — recommend approving from an armed session (the phantom-loop terminal).`
Warn only — do NOT block.

1. Count entries in `running/` → current in-flight count.
2. For each entry in `approved/` (oldest `approvedAt` first) while in-flight < cap:
   - **ATOMIC CLAIM**: rename `approved/<T>.json` → `running/<T>.json` BEFORE spawning, then add `"runStartedAt"` (ISO 8601) to the file. The rename IS the claim — an overlapping approve/queue pass that loses the race finds the source file gone and skips, so no entry can double-spawn.
   - Spawn the executor: Agent tool, `run_in_background: true`, `mode: "bypassPermissions"`, **`model: "sonnet"` (pinned — executors never inherit the top-tier session model)**, cwd = the entry's worktree, prompt:

     > Execute the approved plan for <TICKET>: read `${CLAUDE_PLUGIN_ROOT}/commands/execute.md`, `verify.md`, `fix.md`, `wrap.md` and follow them as a procedure with `--chained` threading: execute → verify `--chained` (auto-fix loop, ceiling enforced by hooks) → wrap. The approval entry at `running/<T>.json` stands in for wrap's ship gate: DRAFT PR only. Plan at <planRef>.

   - Increment in-flight.
3. Over cap → the entry STAYS in `approved/`; report it as `waiting (cap {queue.max_concurrent})`. A later approve/queue pass picks it up — no entry is lost by waiting.

## Step 4: Crash Recovery (defined, manual)

For each `running/` entry: if its background agent has finished or died AND `sessions/<T>/wrap.json` does NOT exist → report the entry as `stalled` with the manual retry instruction: move `running/<T>.json` back to `approved/` — the next dispatch pass re-claims it. NEVER auto-retry: a human looks at a stalled run before it burns a second executor. Before moving a stalled entry back to `approved/`, confirm the original background agent is actually dead (check the session's background task list / recent agent output) — moving back a still-running agent's entry causes TWO executors on the SAME worktree (file corruption); when in doubt, wait.

## Step 5: Reject (`--reject <T> --reason "..."`)

1. **Verify the worktree is clean FIRST**: `git -C <worktree> status --porcelain`. Dirty → **PRESERVE** the worktree and flag it for human inspection — do NOT remove it (dirt in a plan-only worktree is itself a finding).
2. Move the entry → `rejected/<T>.json`, adding `"reason"` and `"rejectedAt"` (ISO 8601).
3. **Jira comment seam**: if the Atlassian MCP is available → `addCommentToJiraIssue` on the ticket with the rejection reason; else report `jira comment skipped`.
4. **Clean worktree only**: `git worktree remove <dir>`, and note that the `feat/` branch still needs deletion. (Dirty worktrees were preserved in step 1.)

Rejected is TERMINAL — no automatic re-queue; manual re-queue is documented in `queue.md`.

## Step 6: Report + Notify Seam

Print the 4-line report:

```
approved: {N} ({tickets}) | dispatched: {M} | waiting: {K} (cap {queue.max_concurrent})
rejected: {R} | stalled: {S}
jira: {commented|skipped}
slack: {sent|skipped}
```

Slack seam: if `integrations.slack_mcp` && `slack.enabled` && `dm_channel` set → send the report via the slack MCP; else print `slack: skipped`.

</instructions>
