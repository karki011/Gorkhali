---
name: phantom:wrap
description: "Use when work is DONE and you want to SHIP it — create a PR, finalize the session, record learnings, open a pull request. Also use when user says 'wrap up', 'ship it', 'create the PR', 'open PR', 'finalize and ship', 'submit the PR', 'finish up and ship', or 'record what we learned'. NOT for a bare git push or commit with no PR. Runs shadows eval, saves learnings, creates PR."
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

### Optional: Visual Recap (`--recap`, or auto when diff is large / UI-affecting)

Lightweight, skip by default. When invoked with `--recap` — or auto when the diff is large or touches UI — emit a self-contained HTML recap of the change (files changed, key diffs, schema/API moves, UI impact) to `{TEAM_DIR}/sessions/{TICKET}/wrap-recap.html`, then reference its path in the wrap output. Reuse the visualflow aesthetic — see `reference/visualflow/flow-template.md` (shared styling). Never blocks; if it fails, proceed with the wrap.

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

Wrap creates the **draft PR autonomously** once verification + the review panel pass — no "ship it?" confirmation. The draft PR is the review surface: the human reviews it and marks it ready-to-review (that action stays human).

See [reference/wrap/ship-ceremony.md] for full protocol.

Stage -> commit -> push -> smart PR decision -> Greptile loop (always runs: `phantom:greploop` until 5/5) -> Jira transition. No git ops happen before this step.

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
PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"
[ -n "$PR" ] && node "$PR/scripts/cost-link.js" close {TICKET}
[ -n "$PR" ] && node "$PR/scripts/cost-report.js" {TICKET}
```

Include the full report in the SESSION WRAPPED box (`AI Cost` line = the report's `Total:`). The report prices live Claude Code transcripts, so the figure tracks current work — only the very last assistant turn may not be flushed to disk yet.

---

> **Output:** SESSION WRAPPED box with Ticket, Route, Outcome, Loops, RPSL verdict, PR status, Jira transition, Learned count, Corrections count, AI Cost (session + ticket total). Random sign-off.
>
> **Next step after PR is merged:** run `/phantom:close {TICKET}` — Jira→Done, branch/worktree cleanup, final cost archive.
