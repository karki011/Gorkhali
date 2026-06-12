---
name: phantom:wrap
description: "Use when work is DONE — finalizing a session, creating a PR, recording learnings, or opening a pull request. Also use when user says 'wrap up', 'we're done', 'ship it', 'create the PR', 'open PR', 'finalize', 'finish up', 'record what we learned', 'commit my work', or 'submit'. NOT for bare git push. Runs shadows eval, saves learnings, creates PR."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
---

> **Preamble Tier: T4** — loads ALL shared contexts

<precondition>
## Smart Verification Gate

Nothing ships without passing verification. No "proceed at your own risk" option.

Check `{TEAM_DIR}/sessions/{TICKET}/verification.json`. Auto-run `Skill(skill="phantom:verify")` if missing, failed, or stale (`_meta.gitHead` != current HEAD). Only proceed if `verdict: "pass"` with matching HEAD.

- verify passes -> proceed with wrap
- verify fails -> **STOP**. Print failures. Suggest `/phantom:fix` then `/phantom:wrap` again.
</precondition>

# /phantom:wrap

Single ship ceremony. All git operations happen here — no commits, pushes, or PRs before wrap.

## Step 1: Pre-Wrap Hook

1. Run Pre-Wrap Hook — verify implementation, test, and review status is recorded
2. `TaskCreate({ subject: "[Apex] SESSION:wrap" })` — hook handles archival + cleanup

## Step 2: Diff-Against-Main Review

Run `git diff main...HEAD --stat` + full diff. Apex reviews alignment with contract scope.
Flag: scope creep (files outside contract), stray formatting, debug statements, orphan TODOs.
Scope creep -> present to user, they decide before PR. Clean -> proceed.

## Step 3: Grill Gate (auto-triggered if 3+ agent-changed files)

Run `Skill(skill="phantom:grill", args="--quick")` — 3-question rapid grill.
**SHIP IT** -> proceed. **NOT YET** -> block, user must address and re-grill.
Skip silently if < 3 files. User override: `--skip-grill` flag.

## Step 4: Pre-Ship Review Panel (RPSL) — MANDATORY

See [reference/wrap/rpsl.md] for full protocol.

4 parallel agents (Scope, Regression, Architecture, Skeptic) review `git diff main...HEAD`. Each agent: `subagent_type: "archer"`, `mode: "bypassPermissions"`, `run_in_background: true` (model + effort come from the agent definition). ALL must pass. No override. No skip flag. Writes `review-panel.json`.

## Step 5: Learnings Recording

See [reference/wrap/learnings.md] for full protocol.

Session file, decisions, shadows eval, learnings update, INDEX update, validation counters, promotion check, caveman compress, phantom outcome feedback, auto-learning trigger 3, testgaps scan.

## Step 6: Ship Ceremony

See [reference/wrap/ship-ceremony.md] for full protocol.

Stage -> commit -> push -> smart PR decision -> Greptile loop (`phantom:greploop` until 5/5 — only if `integrations.greptile` is enabled in config.yaml; otherwise skip with a one-line note) -> Jira transition. No git ops happen before this step.

In a queue-approved `--chained` run (a `running/<TICKET>.json` approval-queue entry exists for this ticket), that approval stands in for the ship gate — proceed directly to a draft PR, never ready-for-review; the GitHub review remains the second human checkpoint.

> Queue-worktree hint: when running from a queue worktree, print the cleanup reminder alongside the PR-creation output — `git worktree remove <dir>` + delete the feat branch after merge.

## Step 7: Evolution & Shutdown

See [reference/wrap/evolution.md] for full protocol.

Evolution check (Ward sidecar, `subagent_type: "ward"`, `mode: "bypassPermissions"`; model + effort come from the agent definition) -> archive session -> memory layer sync -> Core Discipline #13 audit -> deactivate hook -> clear goal -> shut down shadows.

<output_format>
## Step 8: Write Wrap Artifact

Write `{TEAM_DIR}/sessions/{TICKET}/wrap.json` with: `_meta` (writtenAt, gitHead, gitBranch, phase, skill, version), `reviewPanel` (allPass, perspectives, blockers), `pr` (number, url, status, skipReason), `jira` (ticket, transition, commented), `greptile` (requested, status), `learnings` (recorded, promoted, pruned).
</output_format>

## Step 9: Cost Report

Close the ticket's cost interval and report total AI spend (never blocks the wrap if it fails):

```bash
node ${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/phantom}/scripts/cost-link.js close {TICKET}
node ${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/phantom}/scripts/cost-report.js {TICKET}
```

Include the full report in the SESSION WRAPPED box (`AI Cost` line = the report's `Total:`). Telemetry batches ~60s, so the figure may trail the last minute of work.

---

> **Output:** SESSION WRAPPED box with Ticket, Route, Outcome, Loops, RPSL verdict, PR status, Jira transition, Learned count, Corrections count, AI Cost (session + ticket total). Random sign-off.
