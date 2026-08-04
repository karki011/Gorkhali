---
name: wrap
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

- **Session model (Apex)** — Steps 2 (diff/scope review), 3 (defense brief), 5 (session eval), 6 (learnings + session brief). Step 4 (RPSL) already runs on pinned `archer`; Step 8 evolution already runs on pinned `ward`.
- **Pinned `warden` (sonnet)** — the mechanical tail: Step 7 ship ceremony git ops (stage/commit/push, PR create, Jira transition), Step 11 cost report, and the Step 9 `wrap.json` artifact write. Spawn `Agent({ subagent_type: "warden", mode: "bypassPermissions", run_in_background: true })` with the resolved branch, PR title/body, ticket, and artifact fields; it reports results back for the SESSION WRAPPED box.

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

## Step 3: Defense Brief (auto, always)

Runs on every wrap regardless of file count - no 3-file threshold, no skip flag. Apex synthesizes `{TEAM_DIR}/sessions/{TICKET}/defense-brief.md` from session artifacts (`intent.json`, `plan.json`, decisions, `execution.json`, `verification.json`, `review-panel.json`, and the `main...HEAD` diff) with EXACTLY these six sections, in order:

- `## What we did`
- `## Why we did it`
- `## Watch out for`
- `## What you need to know`
- `## Likely questions and answers` - Q/A pairs, each answer anchored to a `file:line` or a session artifact
- `## Decision log` - choice, rejected alternatives, why

See [reference/wrap/defense-brief.md] for the full authoring protocol.

Authoring the brief is Apex judgment work - never warden. The brief renders above the SESSION WRAPPED box (Step 9). A missing brief blocks Step 7 ship: before the ship ceremony runs, warden's preflight checks the file exists and contains all six section headings, using this exact command:

```bash
SESSION_DIR="{TEAM_DIR}/sessions/{TICKET}"
for h in "What we did" "Why we did it" "Watch out for" "What you need to know" "Likely questions and answers" "Decision log"; do
  grep -qF "## $h" "$SESSION_DIR/defense-brief.md" || exit 1
done
```

Any failure stops Step 7 before git operations begin.

Legacy grill quiz remains available via `--grill` (runs `phantom:grill` in ADDITION to the defense brief, never instead).

## Step 4: Pre-Ship Review Panel (RPSL) — MANDATORY

See [reference/wrap/rpsl.md] for full protocol.

4 parallel agents (Scope, Regression, Architecture, Skeptic) review `git diff main...HEAD`. Each agent: `subagent_type: "archer"`, `mode: "bypassPermissions"`, `run_in_background: true` (model + effort come from the agent definition). Writes `review-panel.json`.

Any perspective that returns **FAIL** stops the wrap before git operations. No override. No skip flag. The user fixes the blockers and re-runs `/phantom:wrap`.

A perspective that returns no verdict at all is not a FAIL and must not be recorded as a pass. It is recorded `verdict: not_observed` with `allPass: false`, and the wrap proceeds to a draft PR whose body names the unreviewed perspective, so the gap reaches the human reviewer instead of being silently dropped. The three-branch rule is in `reference/wrap/rpsl.md`; the PR-body requirement is in `reference/wrap/ship-ceremony.md`.

## Step 5: Session Eval (auto, non-blocking)

Score the session with the eval rubric so `wrap.json` carries a quality signal. This step **NEVER blocks** the wrap — any failure is recorded and the ceremony proceeds.

Run `Skill(skill="phantom:eval")` (or spawn per its protocol) to score the active shadows against `.claude/evals/evaluation.md`. Capture the overall `score` and a one-line `rubric` summary.

- Success -> hold `eval: { "score": <n>, "rubric": "<one-line summary>" }` for the wrap artifact (Step 9).
- Any failure (skill errors, missing rubric, timeout) -> hold `eval: { "score": "eval-failed" }` (rubric omitted) and continue. An eval failure never aborts the wrap.

## Step 6: Learnings Recording

See [reference/wrap/learnings.md] for full protocol.

Session file, decisions, shadows eval, learnings update, INDEX update, validation counters, promotion check, caveman compress, auto-learning trigger 3, testgaps scan.

## Step 7: Ship Ceremony

Wrap creates the **draft PR autonomously** once verification passes and the review panel returned no FAIL — no "ship it?" confirmation. An unobserved perspective does not block the PR; it travels in the PR body per `reference/wrap/ship-ceremony.md`. The draft PR is the review surface: the human reviews it and marks it ready-to-review (that action stays human).

See [reference/wrap/ship-ceremony.md] for full protocol.

Stage -> commit -> push -> smart PR decision -> Greptile loop (always runs: `phantom:greploop` until 5/5) -> Jira transition. No git ops happen before this step.

The PR body must include a `## Validation` section built from session artifacts: verify verdict + test counts (`verification.json`), RPSL panel outcome including any fixes applied during the panel (`review-panel.json`), and grill verdict (`wrap.json`). Never commit session artifacts into the repo. Omit a subsection if its artifact is missing; never invent content to fill it. This is a PUBLIC PR body — treat it as such:

- **Redact absolute local paths.** Strip any `/Users/<name>/...` (or other machine-local home) prefix down to a repo-relative path before writing it. No local filesystem layout in a public body.
- **Never embed or upload Lens screenshots without explicit user approval in-conversation.** Uploading publishes them (they may be cached/indexed even if later deleted). Absent that approval, reference screenshots by repo-relative path or a short description instead of embedding.
- When in doubt, less detail in a public PR body.

## Step 8: Evolution & Shutdown

See [reference/wrap/evolution.md] for full protocol.

Evolution check (Ward sidecar, `subagent_type: "ward"`, `mode: "bypassPermissions"`; model + effort come from the agent definition) -> archive session -> memory layer sync -> Core Discipline #13 audit -> deactivate hook -> clear goal -> shut down shadows.

**Confirm subagents terminated:** before declaring the session wrapped, verify no spawned subagent is still running or idle (check `TaskList` / running-agent state). Any lingering agent must be explicitly stopped — a wrap with live background agents is not complete.

<output_format>
## Step 9: Write Wrap Artifact

Write `{TEAM_DIR}/sessions/{TICKET}/wrap.json` with: `_meta` (writtenAt, gitHead, gitBranch, phase, skill, version), `brief` (3-6 sentence session recap — see below), `defenseBrief` (`{path, questions, sections}` - `path` is the defense-brief.md location, `questions` is the count of Q/A pairs in "Likely questions and answers", `sections` is always `6`), `reviewPanel` (allPass, perspectives, blockers), `eval` (from Step 5 — `{score, rubric}` on success, or `{score: "eval-failed"}` with rubric omitted if the eval could not run), `pr` (number, url, status, skipReason), `jira` (ticket, transition, commented), `greptile` (requested, status), `learnings` (recorded, promoted, pruned), `brainCard` (`{id, status}` — populated in Step 10 after the card is emitted; `null` if the emit was skipped), `modelRouting` (`{perRole, deltas, fallbacks, records, reconciliationActive}` - populated in Step 12 after the routing report runs; absent if the report could not run).

### Session Brief

Synthesize a short, plain-language recap of the WHOLE session — not a file-by-file changelog. Draw from intent, decisions, the `main...HEAD` diff, corrections, and learnings. Cover, in 3-6 sentences:

- **What we set out to do** — the problem or ticket goal.
- **What we changed** — the approach taken and the key files/areas touched.
- **Notable decisions or course corrections** — anything that shifted mid-session.
- **Outcome** — what now works, plus any known gaps or follow-ups left open.

Store it as `brief` in wrap.json and render it as a **Session Brief** section directly above the SESSION WRAPPED box.
</output_format>

## Step 10: Emit Brain Card

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

## Step 11: Cost Report

Close the ticket's cost interval and report total AI spend (never blocks the wrap if it fails):

```bash
PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"
[ -n "$PR" ] && node "$PR/scripts/cost-link.js" close {TICKET}
[ -n "$PR" ] && node "$PR/scripts/cost-report.js" {TICKET}
```

Include the full report in the SESSION WRAPPED box (`AI Cost` line = the report's `Total:`). The report prices live Claude Code transcripts, so the figure tracks current work — only the very last assistant turn may not be flushed to disk yet.

## Step 12: Model Routing Report

Summarize the session's model-routing evidence (requested vs. actual profile, fallbacks, per-role outcomes) and fold it into the wrap artifact. Never blocks the wrap: on script failure, log one line and continue.

```bash
PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"
SESSION_DIR="{TEAM_DIR}/sessions/{TICKET}"
WRAP_JSON="$SESSION_DIR/wrap.json"
[ -n "$PR" ] && ROUTING_JSON="$(node "$PR/scripts/routing-report.js" "$SESSION_DIR" --json 2>/dev/null)" \
  && ROUTING_TABLE="$(node "$PR/scripts/routing-report.js" "$SESSION_DIR" 2>/dev/null)" \
  && node -e '
      const fs = require("fs");
      const [wrapPath, routingJson] = process.argv.slice(1);
      const wrap = JSON.parse(fs.readFileSync(wrapPath, "utf8"));
      wrap.modelRouting = JSON.parse(routingJson);
      fs.writeFileSync(wrapPath, JSON.stringify(wrap, null, 2) + "\n");
    ' "$WRAP_JSON" "$ROUTING_JSON" \
  && printf '%s\n' "$ROUTING_TABLE" \
  || echo "phantom: routing-report unavailable or failed - modelRouting omitted, wrap continues"
```

Warden includes the printed table verbatim in the SESSION WRAPPED output - a mechanical include, no judgment applied, matching the plumbing-only mandate for warden (no scope judgment, no synthesis; see the Model split note above).

## Step 13: Outcome Record

Write the closed-schema outcome record for this ticket now that the PR exists (never blocks the wrap; on failure, log one line and continue):

```bash
PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"
[ -n "$PR" ] && node "$PR/scripts/outcome-write.js" --ticket {TICKET} || echo "phantom: outcome-write failed or unavailable - outcome.json not written, wrap continues"
```

`outcome-write.js` derives `pr_url` and `pr_state` from `gh pr view`, so it runs here, after the PR is created in Step 7.

---

> **Output:** Session Brief (3-6 sentence recap of the whole session), then the SESSION WRAPPED box with Ticket, Route, Outcome, Loops, RPSL verdict, Eval score (or `eval-failed`), PR status, Jira transition, Learned count, Corrections count, AI Cost (session + ticket total). Random sign-off.
>
> **Next step after PR is merged:** run `/phantom:close {TICKET}` — Jira→Done, branch/worktree cleanup, final cost archive.
