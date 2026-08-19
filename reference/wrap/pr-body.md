# PR Body

> **Context:** Chief renders `{TEAM_DIR}/sessions/{TICKET}/pr-body.md` at `/phantom:wrap` Step 3, before the ship gate.
> Clerk passes that file to `gh pr create --body-file` verbatim — see `reference/wrap/ship-ceremony.md` §4.
> **This file is the single copy of the contract.** `commands/wrap.md` and `ship-ceremony.md` point here; they never restate it.

A reviewer reads the body in under a minute, so it is short by contract, not by taste.
Hard caps for the whole body: **40 lines and 2500 characters**.
Anything that does not change what the reviewer does next is cut.

## Ownership

- **Chief resolves and renders.** Every value comes from an artifact this session already wrote.
- **Clerk substitutes only.** Its whole body operation is `--body-file {SESSION_DIR}/pr-body.md`. Clerk never authors a section, never fills a blank, never summarizes, never re-orders. On a failed preflight it reports `checked:fail` and does not create the PR — repair is Chief re-rendering.

Same split as the Defense Brief (`reference/wrap/defense-brief.md`): release-context judgment on the session model, execution on the cheap tier.

## The three sections

Write exactly these three headings, in this order, verbatim.

| # | Heading | Source artifacts | Cap | Stated gap when unsourced |
|---|---------|------------------|-----|---------------------------|
| 1 | `## What & why` | `intent.json` — `goal`, `doneWhen[]`; `plan.json` — `decision.recommendation`, `solution_shape.summary`; `execution.json` — `filesChanged` | 3 sentences + 4 bullets | `_Not recorded: intent.json — no goal contract was captured for this session._` |
| 2 | `## Verification` | verification artifact — `checks[]`, `userVerification`; review artifact — `verdict`, `findings`, `specialists[]` | one line per check | none — it cannot degrade, see below |
| 3 | `## Review focus` | review artifact findings; `plan.json` `risks[]`; `execution.json` `filesChanged` + `git diff --numstat` | 3 bullets | `_Not recorded: no review findings, plan risks, or execution file list were available to rank._` |

### 1. `## What & why`

At most three sentences: the problem, the change, and the one decision worth knowing — `plan.decision.recommendation`, with `solution_shape.summary` or a rejected alternative only when it changes how the diff reads.
Then at most four bullets: `doneWhen[]` acceptance criteria, or `execution.filesChanged` grouped by concern when the criteria are already obvious.
This is the contract the reviewer checks the diff against, not a narration of the diff.

### 2. `## Verification`

One bullet per verification `checks[]` entry as `name — result`; then `userVerification` (`required: false`, or its `status` and `routes[]`); then the review artifact — Auditor `verdict` with its findings count, and one line per `specialists[]` entry as `role — verdict — N findings`.
Include the RPSL outcome only when `--deep-review` was explicitly selected; omit it silently otherwise.

**This section does not degrade.** It has no stated-gap line because it cannot legitimately be empty: missing, failed, blocked, or stale Inspector, Auditor, or triggered-specialist evidence is a blocked ship gate (`commands/wrap.md` §1), so there is no PR to caveat.
Never omit required validation and never invent content to fill it — a gap here is a stop, not a caveat.

### 3. `## Review focus`

At most three bullets, each a repo-relative `path:line` with one clause saying why it ranks where it does.
The order is derived, not judged — apply these in sequence and stop at three:

1. files named by a review finding that shipped unfixed, highest severity first;
2. files named by a `plan.risks[].area` or a task-local `tasks[].risk`;
3. remaining `execution.filesChanged` by descending changed-line count from `git diff --numstat {BASE}...HEAD`.

## Stated gaps, never invented text

When a degradable section's source artifact is absent, its entire body is that section's italic stated-gap line from the table, naming the artifact that would have supplied it.

- A gap line is the only permitted substitute. `N/A`, `None`, an empty section, or a plausible guess are failures.
- A gap is real signal — it tells the reviewer this PR shipped without a captured goal or plan — so it belongs in the body rather than hidden.
- Clerk never writes a gap line. If Chief left a section empty, the preflight blocks and Chief re-renders.

## Repo PR template

If the repository ships its own PR template, its headings win and the three resolved values are placed under them. Detection is mechanical:

```bash
ls .github/pull_request_template.md \
   .github/PULL_REQUEST_TEMPLATE.md \
   .github/PULL_REQUEST_TEMPLATE/*.md \
   docs/pull_request_template.md \
   pull_request_template.md 2>/dev/null | head -1
```

Clerk may run that `ls` and report the path; the mapping itself is Chief's.

- **No template found** — use the three canonical headings verbatim. This repository has no PR template (`.github/` holds `workflows/ci.yml` only), so the canonical headings apply here.
- **Template found** — keep the repo's heading text and order. A repo heading with no source value gets the stated-gap line; a resolved value with no matching repo heading is appended under its canonical heading rather than dropped, because evidence is never lost to a template mismatch.

## Clerk preflight

Run before any git operation, alongside the Defense Brief preflight in `commands/wrap.md` Step 2. A pure text check: three headings present, no section empty.

```bash
SESSION_DIR="{TEAM_DIR}/sessions/{TICKET}"
BODY="$SESSION_DIR/pr-body.md"
for h in "What & why" "Verification" "Review focus"; do
  grep -qF "## $h" "$BODY" || exit 1
done
awk '/^## /{if (h) exit 1; h=1; next} NF {h=0} END {exit h}' "$BODY" || exit 1
```

## Example skeleton

```markdown
## What & why
ENG-1234: Explorer totals doubled when a user changed the date range mid-session.
Fixed the shared `useUsageRange` reducer instead of the Explorer component — two other callers had the identical bug.

- Totals match the API response after any range change
- Regression test added; existing tests pass
- `src/hooks/useUsageRange.ts` — reducer fix
- `src/hooks/useUsageRange.test.ts` — regression test

## Verification
- focused tests — passed
- lint — passed
- userVerification — required: false
- auditor — pass — 0 findings
- justice — pass — 0 findings

## Review focus
- `src/hooks/useUsageRange.ts:47` — plan risk: the return shape gains `rangeVersion` and every caller is bumped here
- `src/hooks/useUsageRange.ts:112` — largest changed hunk in the diff
```
