# PR Body

> **Context:** Called during `/phantom:wrap` Step 2, before the ship gate. Apex (session model) resolves the five section values from session artifacts and renders `{TEAM_DIR}/sessions/{TICKET}/pr-body.md`. Warden passes that file to `gh pr create --body-file` verbatim — see `reference/wrap/ship-ceremony.md` §4. A missing section, or a section with no body, blocks PR creation at the warden preflight below.

## Why the sections are fixed

The MSR 2026 study of ~13k agent-authored PRs found more structured descriptions correlate with faster reviewer response and shorter completion time, and DORA 2026 puts median time in PR review up 441% — human review latency, not machine review, is the measured bottleneck. Phantom produces exactly the kind of PR that study measured, so the body is a fixed template rather than free prose.

Free prose also has a second failure mode here: it invites the writer to fill a section it has no evidence for. A fixed template with a stated-gap rule makes a missing artifact visible instead of papered over.

## Ownership split

- **Apex resolves and renders.** Every section value comes from an artifact this session already wrote. Apex writes the fully rendered `pr-body.md` before the ship gate.
- **Warden substitutes only.** Warden's whole body operation is `--body-file {SESSION_DIR}/pr-body.md`. Warden never authors a section, never fills a blank, never summarizes, never re-orders. If the preflight fails, Warden reports `checked:fail` and does not create the PR — it does not repair the file.

This is the same split as the Defense Brief (`reference/wrap/defense-brief.md`): release-context judgment stays on the session model, and the cheap tier only executes.

## The five sections

Write exactly these five headings, in this order, verbatim.

| # | Heading | Source artifacts | Stated gap when unsourced |
|---|---------|------------------|---------------------------|
| 1 | `## Goal` | `intent.json` — `problem`, `goal`, `doneWhen[]`; ticket key | `_Not recorded: intent.json — no goal contract was captured for this session._` |
| 2 | `## Approach` | `plan.json` — `decision.recommendation`, `solution_shape.summary`, `alternatives[]`; `execution.json` — `filesChanged` | `_Not recorded: plan.json — this session shipped without a recorded plan._` |
| 3 | `## Risk` | `plan.json` — `risks[]`; `intent.json` — `tradeoffs[]`, `nonNegotiables[]`; review artifact findings accepted rather than fixed | `_Not recorded: plan.json risks[] — no risks were recorded for this change._` |
| 4 | `## Verification evidence` | portable verification artifact — `checks[]`, `userVerification`; portable review artifact — `verdict`, `findings`, `specialists[]` | none — see "Section 4 does not degrade" below |
| 5 | `## What to look at first` | review artifact findings, `plan.json` risks, `execution.json` `filesChanged` + `git diff --numstat` | `_Not recorded: no review findings, plan risks, or execution file list were available to rank._` |

### 1. `## Goal`

The problem statement as the lead line when `intent.problem` is present, then `intent.goal`, then `doneWhen[]` as a bullet list of observable acceptance criteria. Link the ticket when the session has one. This is the contract the reviewer is checking the diff against — it is not a summary of the diff.

### 2. `## Approach`

`plan.decision.recommendation` in one line, then `solution_shape.summary` when the plan ran at `standard` or `deep` depth. Add one line per `alternatives[]` entry: what was rejected and why. Close with `execution.filesChanged` grouped by concern, using repo-relative paths.

### 3. `## Risk`

One line per `plan.risks[]` entry, rendered `risk — mitigation — reversibility`. Then `intent.tradeoffs[]`, and any `intent.nonNegotiables[]` this diff comes near. Then any review finding that shipped accepted rather than fixed. A change with genuinely nothing to flag takes the stated gap line, not a reassurance.

### 4. `## Verification evidence`

One line per verification `checks[]` entry as `name — result`. Then `userVerification`: `required: false`, or its `status`, `routes[]`, and `observations[]`. Then the review artifact: Gaze `verdict` with its findings count, and one line per `specialists[]` entry as `role — verdict — N findings`. Include the RPSL outcome only when `--deep-review` was explicitly selected; omit it silently otherwise.

**Section 4 does not degrade.** It has no stated-gap line because it cannot legitimately be empty: missing, failed, blocked, or stale Ward, Gaze, or triggered-specialist evidence is a blocked ship gate (`commands/wrap.md` §1, `ship-ceremony.md` §4), so no PR is created at all. Never omit required validation and never invent content to fill it — a gap here is a stop, not a caveat.

### 5. `## What to look at first`

At most five pointers, each a repo-relative `path:line` with one clause saying why it ranks where it does. The order is derived, not judged — apply these in sequence and stop at five:

1. files named by a review finding that shipped unfixed, highest severity first;
2. files named by a `plan.risks[].area` or a task-local `tasks[].risk`;
3. files carrying an `intent.nonNegotiables[]` constraint;
4. remaining `execution.filesChanged` by descending changed-line count from `git diff --numstat {BASE}...HEAD`.

## Stated gaps, never invented text

When a section's source artifact is absent, its entire body is the one stated-gap line from the table above, italicized, naming the artifact that would have supplied it.

- A gap line is the only permitted substitute. `N/A`, `None`, an empty section, a plausible guess, or a restatement of another section are all failures.
- A gap is a real signal — it tells the reviewer this PR shipped without a plan, or without a captured goal — so it belongs in the body rather than being hidden.
- Warden never writes a gap line. If Apex left a section empty, the preflight blocks and the fix is Apex re-rendering the file.

## Repo PR template

If the repository ships its own PR template, mirror its headings so the body reads native to the repo. Detection is mechanical:

```bash
ls .github/pull_request_template.md \
   .github/PULL_REQUEST_TEMPLATE.md \
   .github/PULL_REQUEST_TEMPLATE/*.md \
   docs/pull_request_template.md \
   pull_request_template.md 2>/dev/null | head -1
```

Warden may run that `ls` and report the path; the mapping itself is Apex's, not Warden's.

- **No template found** — use the five canonical headings verbatim. This repository has no PR template (`.github/` holds `workflows/ci.yml` only), so the canonical headings apply here.
- **Template found** — keep the repo's heading text and order, and place each of the five resolved values under the repo heading that covers it. A repo heading with no source value gets the stated-gap line under it. A resolved value with no matching repo heading is appended under its canonical heading rather than dropped — evidence is never lost to a template mismatch.

## Warden preflight

Run before any git operation, alongside the Defense Brief preflight in `commands/wrap.md` Step 3. It is a pure text check with no judgment in it: five headings present, and no section left empty.

```bash
SESSION_DIR="{TEAM_DIR}/sessions/{TICKET}"
BODY="$SESSION_DIR/pr-body.md"
for h in "Goal" "Approach" "Risk" "Verification evidence" "What to look at first"; do
  grep -qF "## $h" "$BODY" || exit 1
done
awk '/^## /{if (h) exit 1; h=1; next} NF {h=0} END {exit h}' "$BODY" || exit 1
```

## Example skeleton

```markdown
## Goal
ENG-1234: Explorer totals doubled when a user changed the date range mid-session.
Render a correct cost rollup across date-range changes.

Done when:
- Totals match the API response after any range change
- Existing tests pass; regression test added

## Approach
Fix the shared `useUsageRange` reducer rather than the consuming component.
Rejected: patching Explorer only — two other callers of the hook had the identical bug.

Files changed:
- `src/hooks/useUsageRange.ts` — reducer fix
- `src/hooks/useUsageRange.test.ts` — regression test

## Risk
Return-shape change (adds `rangeVersion`) — every caller bumped in this diff — revert is a single commit.
Tradeoff: no pagination for now; deferred until >50 tags is common.

## Verification evidence
focused tests — passed
lint — passed
userVerification — required: false
gaze — pass — 0 findings
archer — pass — 0 findings

## What to look at first
- `src/hooks/useUsageRange.ts:47` — plan risk: the return-shape change lands here
- `src/hooks/useUsageRange.ts:112` — largest changed hunk in the diff
```
