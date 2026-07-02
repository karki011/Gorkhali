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

<execution>
## Model split (hybrid)

Wrap is reasoning-heavy, so it stays on the **session model** for judgment steps and pushes only the **mechanical plumbing** down to the pinned cheap `warden` agent:

- **Session model (Apex)** — Steps 2 (diff/scope review), 3 (grill), 5 (learnings + session brief). Step 4 (RPSL) already runs on pinned `archer`; Step 7 evolution already runs on pinned `ward`.
- **Pinned `warden` (sonnet)** — the mechanical tail: Step 6 ship ceremony git ops (stage/commit/push, PR create, Jira transition), Step 9 cost report, and the Step 8 `wrap.json` artifact write. Spawn `Agent({ subagent_type: "warden", mode: "bypassPermissions", run_in_background: true })` with the resolved branch, PR title/body, ticket, and artifact fields; it reports results back for the SESSION WRAPPED box.

`warden` does plumbing only — never scope judgment, session-brief authoring, or learnings synthesis (those stay with Apex). If `warden` is unavailable (older install), run the mechanical tail inline. The Greptile loop (`phantom:greploop`) is its own skill and runs as before.
</execution>

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

The PR body must include a `## Validation` section built from session artifacts: verify verdict + test counts (`verification.json`), RPSL panel outcome including any fixes applied during the panel (`review-panel.json`), and grill verdict (`wrap.json`). Never commit session artifacts into the repo. Omit a subsection if its artifact is missing; never invent content to fill it. This is a PUBLIC PR body — treat it as such:

- **Redact absolute local paths.** Strip any `/Users/<name>/...` (or other machine-local home) prefix down to a repo-relative path before writing it. No local filesystem layout in a public body.
- **Never embed or upload Lens screenshots without explicit user approval in-conversation.** Uploading publishes them (they may be cached/indexed even if later deleted). Absent that approval, reference screenshots by repo-relative path or a short description instead of embedding.
- When in doubt, less detail in a public PR body.

## Step 7: Evolution & Shutdown

See [reference/wrap/evolution.md] for full protocol.

Evolution check (Ward sidecar, `subagent_type: "ward"`, `mode: "bypassPermissions"`; model + effort come from the agent definition) -> archive session -> memory layer sync -> Core Discipline #13 audit -> deactivate hook -> clear goal -> shut down shadows.

**Confirm subagents terminated:** before declaring the session wrapped, verify no spawned subagent is still running or idle (check `TaskList` / running-agent state). Any lingering agent must be explicitly stopped — a wrap with live background agents is not complete.

<output_format>
## Step 8: Write Wrap Artifact

Write `{TEAM_DIR}/sessions/{TICKET}/wrap.json` with: `_meta` (writtenAt, gitHead, gitBranch, phase, skill, version), `brief` (3-6 sentence session recap — see below), `reviewPanel` (allPass, perspectives, blockers), `pr` (number, url, status, skipReason), `jira` (ticket, transition, commented), `greptile` (requested, status), `learnings` (recorded, promoted, pruned), `brainCard` (`{id, status}` — populated in Step 9 after the card is emitted; `null` if the emit was skipped).

### Session Brief

Synthesize a short, plain-language recap of the WHOLE session — not a file-by-file changelog. Draw from intent, decisions, the `main...HEAD` diff, corrections, and learnings. Cover, in 3-6 sentences:

- **What we set out to do** — the problem or ticket goal.
- **What we changed** — the approach taken and the key files/areas touched.
- **Notable decisions or course corrections** — anything that shifted mid-session.
- **Outcome** — what now works, plus any known gaps or follow-ups left open.

Store it as `brief` in wrap.json and render it as a **Session Brief** section directly above the SESSION WRAPPED box.
</output_format>

## Step 9: Emit Brain Card

Distill this session into ONE **Repo Brain** card (schema: `reference/brain.md`; writer: `scripts/lib/brain-card.js`). Runs AFTER wrap.json exists — wrap.json's brief, plus intent/decisions/execution, is the seed. This is the DOGFOOD step: this session's own wrap emits the repo's first real card.

**Guard the RUN, not the precondition** — a card-write failure NEVER blocks the wrap. Wrap the emit in `|| true`.

1. Build the card object from session artifacts:
   - `ticket` = `{TICKET}`; `title` = short human title of the change.
   - `type` = `episode` (default), or `decision` when the session's headline is an architecture choice.
   - `files` = the changed files from the `main...HEAD` diff (repo-relative).
   - `what` = the wrap.json `brief` (distilled, not a changelog).
   - `why` = **REQUIRED** — the chosen approach AND the rejected alternatives with reasons, pulled from `decisions.json` (`alternatives[]`) and `intent.json` (`exploredAlternatives`, `tradeoffs`). A card with an empty Why defeats the design — do not emit one.
   - `gotchas` = corrections, known gaps, and follow-ups left open.
   - `edges` = `{relates_to: rb-*}` for any brain cards cited in `context.json` at task start (T4 recall); `{supersedes: rb-*}` when this session replaces a prior decision.
   - `trace` = `{ session: <session dir>, transcript: <transcript JSONL path>, pr: <pr.url from wrap.json>, commit: "" }` — `commit` is enriched by `/phantom:close` after merge.
2. Resolve the repo name and PLUGIN_ROOT, then emit as a guarded RUN:

```bash
PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"
REPO="$(node -e 'process.stdout.write(require(process.argv[1]+"/scripts/lib/phantom-paths").detectRepo())' "$PR" 2>/dev/null || true)"
# CARD_JSON = the card object built above, as JSON
[ -n "$PR" ] && [ -n "$REPO" ] && printf '%s' "$CARD_JSON" | node "$PR/scripts/lib/brain-card.js" write "$REPO" || true
```

Write the emitted `id` back into wrap.json as `brainCard: {"id": "rb-...", "status": "active"}` (so `/phantom:close` can enrich its trace), and show it in the SESSION WRAPPED box (`Brain card: rb-...`). If the emit fails or is skipped, set `brainCard: null`, note `Brain card: skipped`, and continue — never fail the wrap.

## Step 10: Cost Report

Close the ticket's cost interval and report total AI spend (never blocks the wrap if it fails):

```bash
PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"
[ -n "$PR" ] && node "$PR/scripts/cost-link.js" close {TICKET}
[ -n "$PR" ] && node "$PR/scripts/cost-report.js" {TICKET}
```

Include the full report in the SESSION WRAPPED box (`AI Cost` line = the report's `Total:`). The report prices live Claude Code transcripts, so the figure tracks current work — only the very last assistant turn may not be flushed to disk yet.

---

> **Output:** Session Brief (3-6 sentence recap of the whole session), then the SESSION WRAPPED box with Ticket, Route, Outcome, Loops, RPSL verdict, PR status, Jira transition, Learned count, Corrections count, AI Cost (session + ticket total). Random sign-off.
>
> **Next step after PR is merged:** run `/phantom:close {TICKET}` — Jira→Done, branch/worktree cleanup, final cost archive.
