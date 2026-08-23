---
name: loop
description: "Find your Jira tickets in 'Ready for Implementation', triage each, then run phantom to a PR (solid acceptance criteria) or plan and wait (weak). One pass per invocation. Alias: /phantom:q."
argument-hint: "[--status]"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
---

> **Preamble Tier: T2** — shared contexts per the canonical registry (`scripts/preamble-tier.js`); `_shared-detective.md` also loads on the detective trigger

# /phantom:loop

One pass: find your ready Jira tickets → triage each → act. No config file, no enable flag — typing the command IS the authorization.

<instructions>

## Contract

ONE pass per invocation. This skill NEVER launches `/loop` itself (validated learning: skills cannot self-launch loops). To keep looping, the user runs `/loop /phantom:loop`. Every report ends with that recurrence line.

`--status` in `$ARGUMENTS` → read-only: poll + triage-classify only, print the table, take NO action (no `/phantom:start`, no Jira writes). Then stop.

The loop NEVER edits project source directly — all implementation goes through `/phantom:start`, which spawns Engineer agents. The loop is a coordinator: poll, triage, dispatch.

## Step 0: Gate

Atlassian MCP available? If not → print `LOOP INACTIVE: Atlassian MCP unavailable — nothing polled.` and stop. This is the only gate.

## Step 1: Poll

Via the Atlassian MCP search tool — every ticket assigned to you that is ready, across ALL projects:

```
assignee = currentUser() AND status = "Ready for Implementation" AND (labels IS EMPTY OR labels NOT IN ("no-ai"))
```

No project filter — any ticket assigned to you counts. Empty result → print `LOOP: no ready tickets assigned to you.` + the recurrence line, then stop.

## Step 2: Dedup

Skip a ticket already in flight. A ticket is in flight if EITHER:
- a session dir exists at `${PHANTOM_DATA:-~/.phantom}/repos/{REPO_NAME}/sessions/{TICKET}/`, OR
- an open PR already exists for branch `feat/{ticket-lower}` (`gh pr list --head feat/{ticket-lower} --state open` — empty `gh`/non-repo → treat as not-in-flight, never crash).

Every skip appears in the report with its reason + manual unblock (delete the session dir / close the PR).

## Step 3: Triage each new ticket

Fetch summary + description + acceptance criteria (Jira MCP). Judge **AC solidity** against this rubric — AC is SOLID only if ALL hold:

- A clear, single goal is stated.
- Acceptance criteria are explicit AND testable (a reviewer could write a pass/fail check from them).
- No open questions, TBDs, or "decide later" markers in the description or AC.
- Scope is bounded — not an open-ended epic.

Otherwise AC is WEAK.

## Step 4: Act

**AC SOLID → autonomous to a PR.** Run the full phantom workflow unattended:
`Skill(skill="phantom:start", args="{TICKET}")`. Because AC is solid and no human is present, run it autonomously end-to-end: the loop acts as the plan approver (treat the PLAN/FULL plan-gate as auto-approved — solid AC is the precondition that licenses this), auto-chain verify → fix → wrap, and finish at a **ready-for-review PR**. Record the PR URL for the report. Never ask the user a question — pick recommended defaults and record assumptions.

**Run guard.** No human is watching, so the run-level ceiling is the only one there is. Before each unattended ticket and again before each `phantom:fix` chained from it:

```text
{PR_BOOTSTRAP}
[ -z "$PR" ] && { echo "phantom: plugin dir not found under ~/.claude/plugins/cache/phantom — run /plugin to install"; exit 0; }
node "$PR/scripts/run-guard.js" --ticket {TICKET} --unattended
```

(`{PR_BOOTSTRAP}` per `_shared.md` §Paths. The empty-guard is the GATE-CRITICAL
form on purpose: an unresolved plugin dir would otherwise make `node` exit 1 on
MODULE_NOT_FOUND, and exit 1 is the halt code — a missing install would read as a
confirmed budget overage.)

Exit 0 continues. **Exit 1 halts THIS ticket** — it wrote `halt.json` in the session dir naming the state (`halted_budget` or `halted_stuck`); record that ticket as halted with the guard's reason and move to the next one. Exit 2 is a caller bug in the invocation above, not a halt. Invoking `/phantom:loop` IS the authorization for the `--unattended` flag; the guard is fail-open everywhere else, so it never traps a run it cannot read.

**AC WEAK → plan + wait.** Run plan-only, no execution:
`Skill(skill="phantom:start", args="{TICKET} --to-plan")` — produces `plan.json` in the session dir and stops before any implementation, verify, wrap, or git mutation. Then post ONE Jira comment to the ticket (Atlassian MCP) containing:
- the triage verdict (`AC weak`) and which rubric checks failed,
- a 2-4 line plan summary from `plan.json`,
- the specific acceptance-criteria gaps to resolve before this can be auto-implemented.

Then STOP for that ticket — it waits for the human to tighten the AC and re-run. NEVER open a PR for a weak-AC ticket.

Process tickets sequentially within the pass. ANY failure on one ticket → record it in the report with the reason and continue to the next (never abort the whole pass).

## Step 5: Report

Table — `ticket | verdict | action` — one row per ticket:
- solid → `implemented → PR {url}` (or the failure reason)
- weak → `planned → Jira comment posted, waiting on AC`
- skipped → `in flight ({reason})`

End with:

> Ran one pass. To keep looping: `/loop /phantom:loop`. This never self-launches `/loop`.

Plus one line pointing at the agents view (status bar `← for agents`) to watch live `/phantom:start` runs.

`/phantom:q` is the alias of this skill — identical behavior.

</instructions>
