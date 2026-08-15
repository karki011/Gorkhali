# Defense Brief

> **Context:** Called during `/phantom:wrap` Step 2, on every wrap - no file-count threshold, no skip flag. Authored by Apex (session-model judgment work, never warden). Writes `{TEAM_DIR}/sessions/{TICKET}/defense-brief.md`. A missing brief, or a brief missing any of the six section headings, blocks Step 4 ship - see the warden preflight grep in `commands/wrap.md` Step 2.

## Purpose

The user faces PR review right after wrap. This brief is their prep sheet: what changed, why, what's fragile, and the questions a reviewer will actually ask - answered in advance, with receipts. It is not a changelog and not a second session brief; it exists to make the user confident and specific when defending the diff.

## Sections

Write exactly these six headings, in this order, verbatim:

### 1. `## What we did`

Feeds from: `execution.json`, the `main...HEAD` diff. A concrete summary of the change - files/areas touched and the shape of the work. Not the goal (that's Section 2) - the actual mechanics of what landed.

### 2. `## Why we did it`

Feeds from: `intent.json`, `decisions.json`. The problem or ticket goal, and why this approach over the alternatives that were on the table.

### 3. `## Watch out for`

Feeds from: `plan.json` risks, `review-panel.json` findings (including findings the panel passed with caveats), and any Gaze fix loops that ran. Fragile spots, known gaps, follow-ups left open, anything a reviewer could trip on that isn't obvious from the diff.

### 4. `## What you need to know`

Feeds from: `verification.json`, `execution.json`, session decisions. Context a reviewer needs but would not guess from the diff alone - migration steps, config/env changes, ordering constraints, things that only make sense with the session's history in hand.

### 5. `## Likely questions and answers`

Feeds from: RPSL findings (Scope/Regression/Architecture/Skeptic), Gaze fix loops, plan risks, and the diff's blast radius. Q/A pairs. Every question must be one a real reviewer would ask about this specific diff - not a generic template question. Every answer must cite a `file:line` or name a session artifact (`verification.json`, `review-panel.json`, `decisions.json`, etc). No generic reassurance ("tests pass", "should be fine", "this is safe") without a citation backing it.

### 6. `## Decision log`

Feeds from: `decisions.json` (`alternatives[]`), `intent.json` (`exploredAlternatives`, `tradeoffs`). One line per decision: choice - rejected alternatives - why.

## Quality bar

- Exactly six sections, exact heading text and order as listed above. These are grepped verbatim by the warden preflight (`commands/wrap.md` Step 2) and by `test/wrap-defense-brief.test.js` - a paraphrased heading fails both.
- Every answer in "Likely questions and answers" cites a `file:line` or a session artifact path. An answer with no citation is not acceptable, regardless of how confident it reads.
- Questions must be the hard ones - seeded from RPSL findings, Gaze fix loops, plan risks, and blast radius - not softballs a reviewer would never bother asking.
- Anchor to what actually happened this session. Do not invent content to fill a section that has nothing to report; write "None flagged this session" instead of padding.

## Example skeleton

```markdown
## What we did
Reworked the range reducer in useUsageRange.ts to stop double-counting on
date-range changes; added a regression test in useUsageRange.test.ts.

## Why we did it
ENG-1234: Explorer totals doubled when a user changed the date range mid-session.
Root cause was a stale timestamp retained across reducer calls (see decisions.json).
Considered patching the consuming component instead - rejected once two other
callers of the same hook turned up with the identical bug.

## Watch out for
The fix changes the reducer's return shape (adds `rangeVersion`). Any other
caller relying on the old shape will need the same bump - see review-panel.json
Scope Agent note.

## What you need to know
No migration needed - the reducer is stateless per-mount. Verification ran the
full suite plus the new regression test (verification.json).

## Likely questions and answers
**Q: Why add a rangeVersion field instead of just clearing state on range change?**
A: Clearing state re-triggers a fetch on every range tweak (useUsageRange.ts:42) -
rangeVersion lets the reducer detect staleness without an extra network call.

**Q: Did this touch the other two callers of useUsageRange?**
A: No - out of scope for this ticket, flagged as a follow-up (review-panel.json,
Scope Agent finding #2).

## Decision log
- Fixed the shared hook, not the component - rejected the component-level patch
  after finding two additional callers with the same bug (decisions.json).
```
