# Review Severity and the Review Prompt

> **Filename is historical.** This file was `temperature-review.md` when severity
> was scored as a "temperature" P0-P3. B10 retired that scale, and the file keeps
> its name only because live references point at it. Two things used to live
> here; the fix-loop ceiling moved to [`reference/fix-loop.md`](fix-loop.md), and
> what remains is severity and the review prompt.
>
> `review.temperature` in `verification.json` is a DIFFERENT thing and stays: it
> is a 0-1 knob on how hard the reviewer looks, orthogonal to how a finding is
> scored once found. Strictness is an input; severity is an output. Do not read
> one as the other.

## Severity Scale

The scale is DATA in `scripts/lib/review-standard.js` and this table is rendered
from it by `scripts/gen-review-standard.js`. Do not hand-edit it: F9 counted four
prose severity vocabularies for one concept precisely because prose is what
drifts.

<!-- BEGIN GENERATED review-standard:severity-table - regenerate with scripts/gen-review-standard.js; do not edit by hand -->
| Severity | Bar | Action |
| --- | --- | --- |
| `blocking` | the diff makes something WORSE than it was before, or fails the stated intent | enters the fix loop; the ship waits |
| `advisory` | worth the author knowing, but the diff neither degrades the file nor misses its intent | reported once; never enters the fix loop, never gates the ship |

These are the only two values. There is no third level and no P0-P3 ordinal: a finding that
clears neither bar is NOT REPORTED at all — lint, style, naming and preference nits are
enforced mechanically elsewhere, and restating them is noise the author pays for.
Legacy spellings still on disk are read as `P0`->`blocking`, `P1`->`blocking`, `P2`->`advisory`, `P3`->`advisory`, `warn`->`advisory`; never write them.
<!-- END GENERATED review-standard:severity-table -->

## Confidence Scale

The second axis, added by B11. It answers a different question from severity and
from `review.temperature`, and the table below names all three side by side so
the overlap this file's own header warns about cannot be re-derived by guesswork.

<!-- BEGIN GENERATED review-standard:confidence-table - regenerate with scripts/gen-review-standard.js; do not edit by hand -->
| Confidence | Bar | Action |
| --- | --- | --- |
| `confirmed` | you re-opened the cited file at the cited line and the behaviour the finding claims is there | reported normally |
| `possible` | the cited line reads as claimed, but whether it produces the stated impact depends on a path you could not follow | reported, and the author is told the consequence is the uncertain part - not the code |
| `needs-verification` | the cited source could not be re-read at all (generated, vendored, outside the worktree, unreadable) | reported ONLY with a matching `observationGaps` entry naming what blocked the re-read |

**Confidence is not severity.** Severity is importance, confidence is certainty, and neither is computed from the other. All six combinations are legal: an unsure bug is `blocking` and `possible`, a certain nit is `advisory` and `confirmed`.

Three axes, three questions, none of them derived from another:

| Axis | Field | Kind | Question | Values |
| --- | --- | --- | --- | --- |
| strictness | `review.temperature` | input, per review | how hard does the reviewer look? | 0-1 |
| severity | `findings[].severity` | output, per finding | how much does this finding matter? | `blocking` \| `advisory` |
| confidence | `findings[].confidence` | output, per finding | how sure are you the claim is true? | `confirmed` \| `possible` \| `needs-verification` |

The confidence axis is what the verification pass MOVES: an unverified claim is either
confirmed against the source or discarded. It is not a place to park a guess.
<!-- END GENERATED review-standard:confidence-table -->

## Reporting Rules

<!-- BEGIN GENERATED review-standard:finding-rules - regenerate with scripts/gen-review-standard.js; do not edit by hand -->
1. **Cite the source, not the name.** A behavioural claim must cite `file:line` in the source you actually read; an inference from a symbol's NAME is not evidence, because `validateInput()` may validate nothing. A `blocking` finding always carries a `line`; the schema rejects one that does not.
2. **Blocking means the diff made it worse.** Mark a finding `blocking` only when the diff makes something WORSE than it was before, or fails the stated intent, judged against the PRIOR state of the code rather than the repository ideal. Everything else is `advisory`.
3. **Pre-existing defects report, they never block.** A real defect the diff did NOT introduce is reported with `preExisting: true` and severity `advisory`: it never blocks, never enters the fix loop, and is never counted as a defect this diff caused.
4. **Source changed, tests did not.** Run `node scripts/review-gaps.js --from-git` (or pass the changed-file list with `--files`); it names every changed SOURCE file with no corresponding changed test file. Report each one as a single `advisory` finding citing the source file.
5. **Verify against the source before the finding lands.** Between finding something and writing the artifact, re-open the cited `file:line` and confirm the claimed behaviour is actually there. Anything you cannot confirm at the source is DISCARDED, not downgraded — record it in `discardedFindings` with the reason. This is a pass over the CODE, never a second look at your own finding list: same-context self-critique produces false negatives on your own output, while re-checking a claim against the source is what cuts false positives.
<!-- END GENERATED review-standard:finding-rules -->

## Verification Pass

<!-- BEGIN GENERATED review-standard:verification-pass - regenerate with scripts/gen-review-standard.js; do not edit by hand -->
Run this once, after investigating and BEFORE writing the artifact. Only findings that survive it are written.

1. RE-OPEN the file at the cited line with a read of the source, now. Not the diff hunk, not your earlier notes, not the summary you already wrote.
2. READ the whole enclosing definition, plus the callers you claimed are affected.
3. QUOTE what you just read into `evidence`.
4. DECIDE against the source, not against how good the finding sounds: the behaviour is there (`confirmed`); the line reads as claimed but the consequence depends on a path you could not follow (`possible`); or the source does not support the claim (DISCARD it).
5. DISCARD by moving the finding into `discardedFindings` with a `reason` naming what the source actually says. A discarded finding is never silently deleted and never quietly re-scored into an advisory.
6. Use `needs-verification` ONLY when the source could not be re-read at all, and add the matching `observationGaps` entry saying why.

**Not this:** If your check did not involve opening a file, it did not happen. Reading the finding list again and agreeing with it is not this pass.
<!-- END GENERATED review-standard:verification-pass -->

## Review Agent Prompt

Use this prompt when spawning the review agent:

    Review this diff against the intent. Score each finding on the one scale:

    blocking:  the diff makes something WORSE than it was before, or fails
               the stated intent. MUST be resolved before shipping.
    advisory:  worth the author knowing; does not gate the ship.

    A finding that clears neither bar is NOT REPORTED. Style, naming, minor
    refactors and preferences are enforced mechanically elsewhere.

    A behavioural claim must cite file:line in the source you read. An
    inference from a symbol's NAME is not evidence, and a blocking finding
    with no line is rejected by the schema.

    A real defect this diff did NOT introduce is preExisting: true and
    advisory. It reports; it never blocks and never enters a fix loop.

    Before you write anything: re-open each cited file at the cited line and
    confirm the claimed behaviour is actually there. Re-reading your own
    finding list is NOT this step. Score what survives on the confidence
    axis (confirmed / possible), and move what does not into
    discardedFindings with the reason the source gives. Confidence is not
    severity: an unsure bug is blocking + possible, never a downgrade.

    STATE MATRIX CHECK (mandatory for UI components):
    If the diff adds or modifies a component that reacts to enumerated
    states (sidebar: open/collapsed/pill, drawer: open/closed/expanded,
    panel: open/closed, etc.):
    1. List every enumerated state the component reacts to (switch/if)
    2. For each state, verify positioning doesn't collide with other
       fixed/absolute elements at those coordinates
    3. Flag as blocking any state where a new element occludes an existing
       interactive element (button, link, toggle)
    4. Flag as blocking any state where content margin/padding math doesn't
       account for the new element's width
    This is NOT optional. Missing state coverage is a blocking finding.

    Write the review to {SESSION_DIR}/reviews/gaze.json BEFORE you
    summarise anything in chat. That file is the deliverable; your final
    message is commentary on it. It carries the gate results, dimension
    scores, observation gaps, the VERDICT, and the findings as a JSON
    array under "findings" (canonical shape below).

    Empty array [] = clean code = SHIP IT. Always write the key, even
    when empty: a written [] is what tells commands/verify.md that you
    reviewed and found nothing, as against never having landed a review
    at all. Those are not the same result and must not report the same.
    Do NOT invent findings to justify your existence.

    Then restate the same findings array in your final message.

## Finding Shape

<!-- BEGIN GENERATED review-standard:finding-shape - regenerate with scripts/gen-review-standard.js; do not edit by hand -->
```json
{
  "role": "gaze",
  "model": "the model this review RAN on - omit unless the host told you",
  "verdict": "pass|fail|blocked",
  "findings": [
    {
      "severity": "blocking|advisory",
      "confidence": "confirmed|possible|needs-verification",
      "preExisting": false,
      "file": "src/example.ts",
      "line": 42,
      "evidence": "what you read at that line, quoted or paraphrased",
      "impact": "the user-visible consequence",
      "remediation": "the smallest valid fix"
    }
  ],
  "discardedFindings": [
    {
      "file": "src/example.ts",
      "evidence": "the claim you were going to make",
      "reason": "what the source actually says at the line you re-read"
    }
  ],
  "observationGaps": []
}
```

One shape, every reviewer, every path. `line` is required whenever `severity` is `blocking`.
`preExisting` may be omitted when false. `severity` and `confidence` are independent: score
each on its own axis and never derive one from the other. `discardedFindings` is what the
verification pass dropped and may be omitted when it dropped nothing — an omitted key and an
empty array both mean "nothing discarded". `id`, `disposition`, `dispositionReason` and
`convergence` are stamped mechanically after you report (`scripts/lib/review-finding.js`,
`hooks/loop-controller.js`, `scripts/review-round.js`) — never write them yourself.

`model` is OPTIONAL, and recorded once for the whole artifact: the model this review actually
RAN on. Write it only from what the host reports about the running model. NEVER copy it from a
frontmatter pin or from model-policy.json — a pin is what was requested, and F11 measured the
default reviewer running the cheaper tier on 7 of 25 spawns while its pin still read `opus`.
Omit the key when nothing told you; an absent model is honest, a guessed one is not. The B11
precision gate compares findings that carry a `confidence` against findings that do not. If
those two populations ran on different models the gate measures the MODEL, not the verification
pass, so it REFUSES to produce a verdict unless both sides share one recorded model.

A clean review is `"verdict": "pass"` with a written `"findings": []`. An absent key is a
DIFFERENT result — it means no review landed — and must never report as a clean one.
<!-- END GENERATED review-standard:finding-shape -->

## The Loop

Everything about attempt counts, the hard stop, escalation and what users see
lives in [`reference/fix-loop.md`](fix-loop.md). It is not restated here.
