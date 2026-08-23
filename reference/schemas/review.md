# `review.json` Schema

The reviewer artifact: `{SESSION_DIR}/reviews/auditor.json` from the one default
reviewer (`agents/auditor.md`), and `{SESSION_DIR}/reviews/specialists/justice.json`
from the risk-triggered specialist (`agents/justice.md`). Both write the same
shape. The optional RPSL deep-review preset has its own container schema,
[review-panel.json](review-panel.md), whose `perspectives[].findings` elements
are these findings.

The artifact is the deliverable and the final chat message is commentary on it:
a missing or unreadable file is `blocked`, never a clean review.

<!-- BEGIN GENERATED FIELDS - regenerate with scripts/gen-schema-docs.js; do not edit by hand -->
| Field | Type | Required | Description |
| --- | --- | --- | --- |
| role | string | yes | Reviewer that wrote the artifact: `"auditor"` for the one default reviewer, `"justice"` for the risk-triggered specialist |
| model | string | no | The model this review RAN on, recorded verbatim (F11). PER ARTIFACT, not per finding: one review run is one reviewer in one spawn, so every finding in the file shares it. Never inferred — a frontmatter pin or a `model-policy.json` profile is what was REQUESTED, and F11 measured `auditor` running `opus:18 sonnet:7` against an `opus` pin, so a copied pin would make a confounded comparison look controlled. Optional and absent on every artifact written before F11; while it is absent the B11 precision gate refuses to produce a verdict rather than compare two possibly-different reviewers |
| independence | object | no | Honest-degradation disclosure (adopted from the fable-foreman digest), recorded once for the whole artifact same as `model`. Optional for back-compat - absent on every artifact written before this field existed - but a present object is fully validated against the closed vocabularies below |
| independence.basis | `"same-model-independent-context"` \| `"cross-model"` \| `"reduced-assurance"` | yes (if `independence` present) | Whether this review is a genuine second opinion (`cross-model`), the same model reviewing in its own separate context (`same-model-independent-context` - the common case while balanced and deep resolve to the same delegate model), or a required independent check was structurally unavailable (`reduced-assurance`) |
| independence.evidenceTier | `"requested"` \| `"served"` | yes (if `independence` present) | What the `basis` claim itself rests on, borrowed from project-docs/seat-provenance-design.md's tier model: `requested` (what was asked for) or `served` (post-resolution proof of what actually answered). Every recorded `model` on this artifact is requested-tier today, so `basis` is too, until that design's served-tier probe lands |
| independence.label | string | yes (if `independence` present) | The human-readable sentence a reader sees without decoding the two tokens above. NOT free text: it is DERIVED, a pure function of `basis` and `evidenceTier` (`canonicalIndependenceLabel` in `scripts/lib/review-standard.js`), and must EXACTLY EQUAL that function's output for the recorded tokens - one strict-equality check, no prefix match, no phrase check. A hand-phrased label can always find wording no finite check enumerates, so the claim sentence is no longer something a reviewer writes; only `basis`/`evidenceTier` are choices |
| independence.reason | string | yes (if `basis` is `reduced-assurance`), optional otherwise | The human explanation the label used to embed as free text - what, specifically, made the independent check unavailable. Bounded free text (a reader's context, never a machine-checked claim): at most 500 UTF-8 bytes. Required non-empty when `basis` is `reduced-assurance` - a reduced-assurance acceptance with no stated reason is meaningless - optional for the other two bases |
| verdict | `"pass"` \| `"fail"` \| `"blocked"` | yes | Review result. A missing or unreadable artifact is `blocked`, never a clean review |
| findings | object[] | yes | Findings. A written `[]` is a clean review; an absent key is not the same result and must not report as one |
| findings[].id | string (`f_<12 hex>`) | no (required once a disposition is recorded) | Stable finding id, DERIVED from content: `f_` + first 12 hex of `sha256(file + US + claim)`. Reviewers do not write it — it is stamped mechanically by `scripts/lib/review-finding.js`, which is the derivation authority. When present it must equal the derived value |
| findings[].severity | `"blocking"` \| `"advisory"` | yes | Importance, on the one scale (`scripts/lib/review-standard.js`). `blocking` = the diff makes something WORSE than before or fails the stated intent; `advisory` = everything else worth saying. There is no third level: a finding clearing neither bar is not reported at all. Legacy spellings are accepted and normalized — `P0`/`P1` to `blocking`, `P2`/`P3`/`warn` to `advisory`, legacy key `temperature` to `severity` |
| findings[].confidence | `"confirmed"` \\| `"possible"` \\| `"needs-verification"` | no | Certainty, on its own axis (B11). `confirmed` = the cited line was re-read and the claimed behaviour is there; `possible` = the line reads as claimed but the impact depends on an unfollowed path; `needs-verification` = the source could not be re-read at all, which requires a matching `observationGaps` entry. ORTHOGONAL to `severity` — severity is importance, confidence is certainty, neither is derived from the other, and all six combinations are legal. Optional: artifacts written before B11 carry no confidence and are read as unverified, never as confirmed. SUPERSEDED (B13) by `evidenceClass` + `citation` for any finding that carries them - a reviewer self-rating, kept only for back-compat |
| findings[].evidenceClass | `"quoted"` \\| `"observed"` \\| `"derived"` \\| `"inferred"` | no | B13, adopted from the fable-foreman digest. How the claim was reached - never self-rated confidence, which it supersedes. `quoted` and `observed` require a matching structured `citation` (below); `derived` requires a non-empty free-text locator; only `inferred` may omit it. Resolved deterministically, never asked of the reviewer as a score, by `scripts/validate-citations.mjs`, which computes calibration = resolved/resolvable across the artifact |
| findings[].citation | object \| string \| `null` | yes when evidenceClass is `quoted`, `observed`, or `derived`; else no | Shape follows `evidenceClass`: `{ file, line?, quote }` for `quoted` (file must exist; must be a normalized workspace-relative path - no absolute path, `../` traversal, or backslash, since it is untrusted content that `scripts/validate-citations.mjs` resolves against the real filesystem, which re-checks by canonical path against the workspace root for the symlink escapes this shape check cannot see; `quote` is REQUIRED non-empty text - a quoted citation with no quote is unresolvable-as-quoted, not a weaker legal one; it must appear in the file, whitespace-normalized; a given line must be within 5 lines of an occurrence of the quote); `{ command, expect? }` for `observed` (command must be non-empty - resolution is structural, the command is never re-run); a REQUIRED non-empty free-text locator string for `derived`; `null` or omitted for `inferred` - the only class where an absent citation is legal. A resolved citation proves the cited text/command EXISTS, not that it supports the claim; that judgment stays with the reader |
| findings[].preExisting | boolean | no | True for a real defect the diff did NOT introduce. It reports, never blocks, and never enters a fix loop, so `preExisting: true` alongside severity `blocking` is rejected. Omit when false |
| findings[].dimension | `"cross-file-coherence"` \| `"regression"` \| `"semantic-accuracy"` \| `"dead-code"` \| `"convention-deviation"` | no | Justice's review dimension. Optional and closed: before B10 it existed only in Justice's chat output format, so `scripts/baseline-report.js` could report precision per severity and per agent but never per dimension. Auditor has no dimension vocabulary and omits the key |
| findings[].file | string | yes | File the finding is about. Legacy key `component` is accepted and folds onto `file` |
| findings[].line | number | yes for a `blocking` finding | The cited source line. Required on a blocking finding: a behavioural claim must cite `file:line` in source, and an inference from a symbol NAME is not evidence. Excluded from the id on purpose — an unrelated fix upstream shifts line numbers, and a finding that merely moved is the same finding |
| findings[].evidence | string | no | What was read at that line. Legacy keys `issue`/`message`/`description` fold onto it; the first one present is the claim text the id hashes |
| findings[].impact | string | no | User-visible consequence |
| findings[].remediation | string | no | Smallest valid fix. Legacy key `fix` folds onto it |
| findings[].disposition | `"fixed"` \| `"dismissed"` \| `"deferred"` | no | Outcome attributed to THIS finding when the fix loop closed, written by `hooks/loop-controller.js`. Absent until the loop closes; absent forever on artifacts written before B9. A `preExisting` finding closes as `deferred`, never `fixed` — it never entered the loop |
| findings[].dispositionReason | string | yes when disposition is `dismissed` or `deferred` | Why the finding was not fixed. Required for `dismissed`/`deferred` because nothing in the diff evidences them; `fixed` needs none — the changed code is the evidence |
| discardedFindings | object[] | no | What the B11 verification pass DROPPED: candidate findings whose claim the cited source did not support on re-read. Each element needs a `file` (legacy `component` accepted), a claim (`evidence`/`issue`/`message`/`description`), and a non-empty `reason` naming what the source actually says. Recorded rather than deleted so a dropped false positive is evidence the pass ran, and so the same claim reappearing next round is visible. Omit when nothing was discarded |
| convergence | object | no | Re-review convergence for this pass (B12), stamped mechanically by `scripts/review-round.js` — reviewers never write it. Absent on a round-1 review |
| convergence.round | number | yes (if present) | Which pass over this session this is, 1-based. Derived from the carry-over ledger `{SESSION_DIR}/reviews/rounds.json`, which survives the deliberate pre-pass delete of `auditor.json` because it is a different file and holds no verdict |
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
binary before acting: the legacy Justice triage was `P0`/`P1` -> FIX and `P2` -> SKIP, and the legacy temperature table fixed `P0`/`P1` and DROPPED `P2`/`P3` unreported.
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

**Evidence class and citation, superseding self-rated confidence (B13).**
Adopted from the fable-foreman digest's finding contract: a reviewer asked to
self-rate confidence can rate confidently and be wrong, because nothing checks
the rating against anything. `findings[].evidenceClass` replaces the rating
with a closed vocabulary naming HOW the claim was reached - `quoted` (verbatim
text cited from source), `observed` (a command was run and its output cited),
`derived` (reasoned from other cited facts), or `inferred` (a hypothesis with
no direct citation) - paired with `findings[].citation`, a machine-resolvable
pointer. `quoted` and `observed` REQUIRE a structured citation in the shape
that class needs to be checked: `{ file, line?, quote }` for `quoted` (`quote`
is REQUIRED non-empty text - a quoted citation with no quote is unresolvable-
as-quoted, not a weaker legal one), `{ command, expect? }` for `observed`.
`derived` REQUIRES a non-empty free-text locator string; `inferred` may omit
`citation` or set it `null` - the only class where an absent citation is
legal.

Calibration is COMPUTED, never self-reported: `scripts/validate-citations.mjs`
resolves every `quoted` citation by confirming the file exists and that its
required `quote` text appears in it (whitespace-normalized) - if the quote
recurs and a `line` is also given, any occurrence within 5 lines of it is
enough - and every `observed` citation structurally (the command is
non-empty; it is never re-run). `--root <workspace-root>` is REQUIRED on
every invocation: an artifact lives in a session directory but citation file
paths are workspace-relative, so there is no safe default to resolve them
against. It reports `{ total, resolvable, resolved, calibration:
resolved/resolvable }` across the artifact and prints unresolved findings
prominently; `--strict` exits 1 on any unresolved finding. A resolved
citation proves the cited text or command EXISTS - it does not prove the
citation supports the claim, which stays a human judgment call, same as it
always has.

`confidence` is unchanged and kept for back-compat - nothing on disk before
B13 carries `evidenceClass`, and every consumer that reads `confidence` (B11's
precision gate among them) keeps working. A reviewer writing a NEW finding
should carry `evidenceClass`/`citation` instead of self-rating `confidence`.

**Re-review convergence (B12).** On the second and later pass over a session,
only `blocking` findings are itemized; non-blocking ones are reported as the
`convergence.suppressed` counts. The prior rounds' finding ids live in
`{SESSION_DIR}/reviews/rounds.json`, which survives the deliberate pre-pass
delete of `auditor.json` because it is a different file — and it carries ids,
severities and files only, with no verdict anywhere in it, so the freshness
property that delete exists to protect cannot be violated through it.
`scripts/review-round.js` owns that ledger and stamps `convergence`.

**Independence disclosure (honest-degradation labels).** Adopted from the
fable-foreman digest: a review that resolves to the same model as the work it
checks must say so plainly rather than let the report imply an independent
second opinion nobody obtained, and an acceptance with no legal independent
check available is labeled reduced, never a silent clean pass. In Gorkhali this
is the norm rather than the exception - balanced and deep both resolve to
sonnet on claude-code, so same-tier review pairs are common - so
`independence` states that evidence basis honestly instead of dressing it up.
`basis` is one of `same-model-independent-context` (today's honest default),
`cross-model` (a genuine second opinion), or `reduced-assurance` (a required
independent check was structurally unavailable). `evidenceTier` says what
`basis` itself rests on, using the REQUESTED/SERVED tier model from
[seat-provenance-design.md](../../project-docs/seat-provenance-design.md):
`requested` (what was asked for) or `served` (post-resolution proof of what
answered) - every recorded `model` on this artifact is requested-tier today,
so `basis` is too, until that design's served-tier probe lands. `label` is the
one human-readable sentence a reader sees without decoding the two tokens, for
example `"blind-verified (same model, independent context; model identity is
requested-tier evidence)"` or `"accepted under reduced assurance: <what was
unavailable>"`. Optional for back-compat - absent on every artifact written
before this field existed - but a present object is fully validated: an
unknown `basis` or `evidenceTier` token is rejected, not silently accepted.

**Example:**
```json
{
  "role": "auditor",
  "independence": {
    "basis": "same-model-independent-context",
    "evidenceTier": "requested",
    "label": "blind-verified (same model, independent context; model identity is requested-tier evidence)"
  },
  "verdict": "fail",
  "findings": [
    {
      "id": "f_e8f6c15ee2d0",
      "severity": "blocking",
      "confidence": "confirmed",
      "evidenceClass": "quoted",
      "citation": { "file": "src/session/resume.ts", "line": 42, "quote": "state.ticket.id" },
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
