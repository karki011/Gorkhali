# `review.json` Schema

The reviewer artifact: `{SESSION_DIR}/reviews/gaze.json` from the one default
reviewer (`agents/gaze.md`), and `{SESSION_DIR}/reviews/specialists/archer.json`
from the risk-triggered specialist (`agents/archer.md`). Both write the same
shape. The optional RPSL deep-review preset has its own container schema,
[review-panel.json](review-panel.md), whose `perspectives[].findings` elements
are these findings.

The artifact is the deliverable and the final chat message is commentary on it:
a missing or unreadable file is `blocked`, never a clean review.

<!-- BEGIN GENERATED FIELDS - regenerate with scripts/gen-schema-docs.js; do not edit by hand -->
| Field | Type | Required | Description |
| --- | --- | --- | --- |
| role | string | yes | Reviewer that wrote the artifact: `"gaze"` for the one default reviewer, `"archer"` for the risk-triggered specialist |
| model | string | no | The model this review RAN on, recorded verbatim (F11). PER ARTIFACT, not per finding: one review run is one reviewer in one spawn, so every finding in the file shares it. Never inferred — a frontmatter pin or a `model-policy.json` profile is what was REQUESTED, and F11 measured `gaze` running `opus:18 sonnet:7` against an `opus` pin, so a copied pin would make a confounded comparison look controlled. Optional and absent on every artifact written before F11; while it is absent the B11 precision gate refuses to produce a verdict rather than compare two possibly-different reviewers |
| verdict | `"pass"` \| `"fail"` \| `"blocked"` | yes | Review result. A missing or unreadable artifact is `blocked`, never a clean review |
| findings | object[] | yes | Findings. A written `[]` is a clean review; an absent key is not the same result and must not report as one |
| findings[].id | string (`f_<12 hex>`) | no (required once a disposition is recorded) | Stable finding id, DERIVED from content: `f_` + first 12 hex of `sha256(file + US + claim)`. Reviewers do not write it — it is stamped mechanically by `scripts/lib/review-finding.js`, which is the derivation authority. When present it must equal the derived value |
| findings[].severity | `"blocking"` \| `"advisory"` | yes | Importance, on the one scale (`scripts/lib/review-standard.js`). `blocking` = the diff makes something WORSE than before or fails the stated intent; `advisory` = everything else worth saying. There is no third level: a finding clearing neither bar is not reported at all. Legacy spellings are accepted and normalized — `P0`/`P1` to `blocking`, `P2`/`P3`/`warn` to `advisory`, legacy key `temperature` to `severity` |
| findings[].confidence | `"confirmed"` \\| `"possible"` \\| `"needs-verification"` | no | Certainty, on its own axis (B11). `confirmed` = the cited line was re-read and the claimed behaviour is there; `possible` = the line reads as claimed but the impact depends on an unfollowed path; `needs-verification` = the source could not be re-read at all, which requires a matching `observationGaps` entry. ORTHOGONAL to `severity` — severity is importance, confidence is certainty, neither is derived from the other, and all six combinations are legal. Optional: artifacts written before B11 carry no confidence and are read as unverified, never as confirmed |
| findings[].preExisting | boolean | no | True for a real defect the diff did NOT introduce. It reports, never blocks, and never enters a fix loop, so `preExisting: true` alongside severity `blocking` is rejected. Omit when false |
| findings[].dimension | `"cross-file-coherence"` \| `"regression"` \| `"semantic-accuracy"` \| `"dead-code"` \| `"convention-deviation"` | no | Archer's review dimension. Optional and closed: before B10 it existed only in Archer's chat output format, so `scripts/baseline-report.js` could report precision per severity and per agent but never per dimension. Gaze has no dimension vocabulary and omits the key |
| findings[].file | string | yes | File the finding is about. Legacy key `component` is accepted and folds onto `file` |
| findings[].line | number | yes for a `blocking` finding | The cited source line. Required on a blocking finding: a behavioural claim must cite `file:line` in source, and an inference from a symbol NAME is not evidence. Excluded from the id on purpose — an unrelated fix upstream shifts line numbers, and a finding that merely moved is the same finding |
| findings[].evidence | string | no | What was read at that line. Legacy keys `issue`/`message`/`description` fold onto it; the first one present is the claim text the id hashes |
| findings[].impact | string | no | User-visible consequence |
| findings[].remediation | string | no | Smallest valid fix. Legacy key `fix` folds onto it |
| findings[].disposition | `"fixed"` \| `"dismissed"` \| `"deferred"` | no | Outcome attributed to THIS finding when the fix loop closed, written by `hooks/loop-controller.js`. Absent until the loop closes; absent forever on artifacts written before B9. A `preExisting` finding closes as `deferred`, never `fixed` — it never entered the loop |
| findings[].dispositionReason | string | yes when disposition is `dismissed` or `deferred` | Why the finding was not fixed. Required for `dismissed`/`deferred` because nothing in the diff evidences them; `fixed` needs none — the changed code is the evidence |
| discardedFindings | object[] | no | What the B11 verification pass DROPPED: candidate findings whose claim the cited source did not support on re-read. Each element needs a `file` (legacy `component` accepted), a claim (`evidence`/`issue`/`message`/`description`), and a non-empty `reason` naming what the source actually says. Recorded rather than deleted so a dropped false positive is evidence the pass ran, and so the same claim reappearing next round is visible. Omit when nothing was discarded |
| convergence | object | no | Re-review convergence for this pass (B12), stamped mechanically by `scripts/review-round.js` — reviewers never write it. Absent on a round-1 review |
| convergence.round | number | yes (if present) | Which pass over this session this is, 1-based. Derived from the carry-over ledger `{SESSION_DIR}/reviews/rounds.json`, which survives the deliberate pre-pass delete of `gaze.json` because it is a different file and holds no verdict |
| convergence.suppressed | object | yes (if present) | Non-blocking findings this round reported as a count instead of itemizing: `{ total, carriedOver, new }`, all numbers. On round 2+ a non-blocking finding is suppressed whether or not round 1 raised it; the split says which |
| observationGaps | string[] | yes | Parts of the assigned scope that were not observed. ONE spelling, camelCase like every other artifact key; the legacy `observation_gaps` is accepted and normalized |
| _meta | object | no | Validated when present, never required. DECIDED in B10: the reviewer artifact is the one documented exception to `reference/schemas/_meta.md`, because a subagent-written artifact would have to GUESS the session `phase`/`skill`/`version`, and the portable lifecycle already binds the review to a worktree fingerprint — a guessed provenance header is worse than an absent one |
<!-- END GENERATED FIELDS -->

**Finding identity.** `findings[].id` is derived from the finding's own content,
not minted at random:

```
id = "f_" + sha256(<file> + U+001F + <claim>).hex.slice(0, 12)
```

where `<file>` is `file` (or `component`) with `\` normalized to `/` and a
leading `./` stripped, and `<claim>` is the first non-empty of `evidence`,
`issue`, `message`, `description`, trimmed, internal whitespace collapsed, and
lowercased. `scripts/lib/review-finding.js` is the derivation authority; the
validator recomputes it and rejects any `id` that disagrees.

Derived rather than random because the question the id exists to answer —
*was this finding acted on?* — requires recognising the same finding across
re-review rounds. A random id mints a new identity every round, which makes a
carried-over finding indistinguishable from a newly invented one and leaves
nothing to count. `line` is excluded because a fix upstream shifts line numbers
and a finding that merely moved is the same finding; `severity` is excluded
because it is re-scored between rounds and its vocabulary is due to change.
The honest limit: a reviewer that *rewords* the same claim gets a new id. Text
equality is what a hash can promise.

**Disposition.** `findings[].disposition` records the outcome of the individual
finding when the fix loop closes, written by `hooks/loop-controller.js`
(`closeFixLoop`), which is also the authority for how many loops that is —
counted from the review round ledger, `reference/fix-loop.md`. The
attribution rules, in order: an explicit human dismissal wins; otherwise a
disposition already recorded stands; otherwise `fixed` when the finding's file
is among the files the loop changed (the code changed after the finding — a
behavioral true-positive proxy that needs no human labelling); otherwise
`deferred`, because a finding nobody fixed and nobody dismissed is a real
outcome and is never silently dropped.

**One scale, one shape (B10).** `severity` is `blocking` or `advisory` and
nothing else. The four legacy vocabularies F9 counted (`blocking`/`advisory`, `P0`-`P2`, `P0`-`P3`, `warn`),
the three finding shapes, and the two spellings
of the gaps array are collapsed onto these. The vocabulary is DATA in
`scripts/lib/review-standard.js`; the field table above is generated from the
validator that imports it, and the reviewer prose that tells agents what to
write is generated by `scripts/gen-review-standard.js` and drift-checked in CI
(`test/review-standard.test.js`). No file restates the scale in prose, because a
restated value is what drifted four ways in the first place.

Two levels rather than four because every consumer already collapsed to a
binary before acting: the legacy Archer triage was `P0`/`P1` -> FIX and `P2` -> SKIP, and the legacy temperature table fixed `P0`/`P1` and DROPPED `P2`/`P3` unreported.
The extra levels carried no decision. There is no third level here either: a finding
clearing neither bar is not reported at all.

**Backward compatibility, and the migration path.** Nothing on disk fails.
Legacy severities are accepted and normalized (`P0`/`P1` -> `blocking`,
`P2`/`P3`/`warn` -> `advisory`), and legacy keys fold onto their canonical key
(`temperature` -> `severity`, `component` -> `file`, `issue`/`message`/
`description` -> `evidence`, `fix` -> `remediation`, `observation_gaps` ->
`observationGaps`). None of this changes a finding id: the id hashes
`file || component` and the first present claim key, and deliberately excludes
`severity` — which is exactly why B9 left severity out. Run
`node scripts/migrate-review-findings.js <artifact>...` to rewrite an artifact
into the canonical shape in place when you want the file itself cleaned up;
`--check` reports what would change without writing.

**The one new rejection.** A `blocking` finding that cites a `file` must carry a
`line`. That is B10(a) made mechanical: a behavioural claim must cite `file:line`
in source, and an inference from a symbol's NAME is not evidence. All three
legacy shapes already carried a line, so this is a tightening rather than a
break; a blocking claim with no line to cite is an `advisory`.

**Pre-existing defects.** `preExisting: true` marks a real defect the diff did
not introduce. It reports, never blocks, never enters a fix loop — the schema
rejects `preExisting: true` alongside `blocking`, and `hooks/loop-controller.js`
closes such a finding as `deferred` rather than `fixed` even when the loop
touched its file, so a defect the diff never caused cannot inflate the precision
number B9 exists to measure.

**Two axes, not one (B11).** `severity` is importance and `confidence` is
certainty, and neither is derived from the other: all six combinations are legal
and nothing in the validator couples them. This is the same mistake F9 recorded
once already — `review.temperature` (an input knob on how hard the reviewer
looks) read as a severity (an output score) — so the three axes are named
together rather than left to be inferred: strictness is a per-review input,
severity and confidence are per-finding outputs.

Confidence is what the **verification pass** moves. Between finding something and
writing this artifact, the reviewer re-opens the cited `file:line` and confirms
the claimed behaviour is there. It is a pass over the SOURCE, never a second read
of the finding list: same-context self-critique produces false negatives on the
model's own output, while re-checking a claim against the code is what cuts false
positives. What survives is `confirmed` or `possible`; what does not is DISCARDED
into `discardedFindings` with the reason the source gives, never downgraded to an
advisory. `needs-verification` means the source could not be re-read at all and
requires a matching `observationGaps` entry — it is not a label for "not checked".

Absent `confidence` means UNVERIFIED, never confirmed. Every artifact written
before B11 is in that state, which is exactly the population
`scripts/baseline-report.js` compares the verified one against in its
promote/revert gate.

**Re-review convergence (B12).** On the second and later pass over a session,
only `blocking` findings are itemized; non-blocking ones are reported as the
`convergence.suppressed` counts. The prior rounds' finding ids live in
`{SESSION_DIR}/reviews/rounds.json`, which survives the deliberate pre-pass
delete of `gaze.json` because it is a different file — and it carries ids,
severities and files only, with no verdict anywhere in it, so the freshness
property that delete exists to protect cannot be violated through it.
`scripts/review-round.js` owns that ledger and stamps `convergence`.

**Example:**
```json
{
  "role": "gaze",
  "verdict": "fail",
  "findings": [
    {
      "id": "f_e8f6c15ee2d0",
      "severity": "blocking",
      "confidence": "confirmed",
      "file": "src/session/resume.ts",
      "line": 42,
      "evidence": "resumeSession() reads state.ticket before the null guard on line 39",
      "impact": "Resuming a session written before v3 throws instead of reporting a stale artifact",
      "remediation": "Move the guard above the read",
      "disposition": "fixed"
    },
    {
      "id": "f_dd0ddbfd6161",
      "severity": "advisory",
      "confidence": "confirmed",
      "file": "src/session/resume.ts",
      "evidence": "src/session/resume.ts changed and no test file with the stem \"resume\" changed with it (scripts/review-gaps.js)",
      "impact": "The regression above can return unnoticed",
      "remediation": "Add one case to resume.test.ts",
      "disposition": "deferred",
      "dispositionReason": "fix-loop ceiling reached; tracked for the next pass"
    },
    {
      "id": "f_3a5b1c0d9e77",
      "severity": "advisory",
      "confidence": "possible",
      "preExisting": true,
      "file": "src/session/store.ts",
      "line": 88,
      "evidence": "readStore() indexes entries[0] with no length check; the diff only renamed the caller",
      "impact": "An empty store throws on resume, as it did before this diff",
      "remediation": "Guard the index; out of scope for this change",
      "disposition": "deferred",
      "dispositionReason": "pre-existing: reported, never entered the fix loop"
    }
  ],
  "discardedFindings": [
    {
      "file": "src/session/store.ts",
      "evidence": "writeStore() was going to be flagged for writing before the lock is taken",
      "reason": "re-read store.ts:61 - the lock is acquired by the decorator on line 54, so the claim is false"
    }
  ],
  "convergence": { "round": 2, "suppressed": { "total": 2, "carriedOver": 2, "new": 0 } },
  "observationGaps": []
}
```

The ids above are illustrative. The real ones are whatever
`scripts/lib/review-finding.js` derives from each finding's file and claim text;
the validator recomputes them and rejects any that disagrees.
