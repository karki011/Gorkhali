# `verification.json` Schema

Written by `phantom:verify`. Read by `phantom:wrap` to decide PR strategy.

<!-- BEGIN GENERATED FIELDS - regenerate with scripts/gen-schema-docs.js; do not edit by hand -->
| Field | Type | Required | Description |
| --- | --- | --- | --- |
| correctness | object | yes | Mechanical checks (lint, build, tests) |
| correctness.lint | boolean | yes | Lint passed |
| correctness.build | boolean | yes | Build passed |
| correctness.tests | boolean | yes | Tests passed |
| correctness.commands | string[] | yes | Commands actually run |
| correctness.observations | object | yes | Per-check observation confidence |
| correctness.observations.lint | `"checked:pass"` \| `"checked:fail"` \| `"not_observed"` | yes | Lint check status |
| correctness.observations.build | `"checked:pass"` \| `"checked:fail"` \| `"not_observed"` | yes | Build check status |
| correctness.observations.tests | `"checked:pass"` \| `"checked:fail"` \| `"not_observed"` | yes | Test check status |
| review | object | yes | Self-review results |
| review.temperature | number | yes | Reviewer strictness (0-1). NOT a severity: it is a knob on how hard the reviewer looks, orthogonal to how a finding is scored once found (`findings[].severity`) |
| review.findings | object[] | yes | Array of finding objects. Element shape is the review artifact's finding (`reference/schemas/review.md`) — ONE shape and ONE severity scale, enforced there; array-only here so no verification artifact already on disk starts failing |
| review.fixLoops | number | yes | How many fix/re-verify loops ran. LEGACY source: the portable flow counts the review round ledger (`{SESSION_DIR}/reviews/rounds.json`) instead, and this field is read only for sessions written before that move. Either way the count is owned by `hooks/loop-controller.js` and capped at the fix-loop ceiling (canonical: `reference/fix-loop.md`) unless a logged operator override extended it |
| simplifyRan | boolean | yes | Whether simplify was run on changed files |
| intentAlignment | `"aligned"` \| `"drift"` \| `"wrong"` | yes | How well output matches intent.json |
| userVerification | object | yes for passed verdict | Compact UI classification and conditional user-verification result; use `{ "required": false }` for non-UI work |
| userVerification.required | boolean | yes | Whether this change requires user verification |
| userVerification.status | `"confirmed"` \| `"pending"` | yes when required | `confirmed` is an explicit user confirmation; `pending` cannot produce a passing verdict |
| userVerification.routes | string[] | yes when required | Routes presented to the user; non-empty when verification is required |
| userVerification.confirmedBy | `"user"` | yes (when confirmed) | Records that confirmation came from the user |
| userVerification.observations | string[] | yes when required | User observations; may be empty when the user confirmed without notes |
| verdict | `"pass"` \| `"fail"` | yes | Overall gate result |
| score | number (0-10) | no | Numeric quality score |
<!-- END GENERATED FIELDS -->

**Example:**
```json
{
  "_meta": { "...": "..." },
  "correctness": {
    "lint": true,
    "build": true,
    "tests": true,
    "commands": ["{LINT_CMD}", "{BUILD_CMD}", "{TEST_CMD}"],
    "observations": {
      "lint": "checked:pass",
      "build": "checked:pass",
      "tests": "checked:pass"
    }
  },
  "review": {
    "temperature": 0.7,
    "findings": [
      { "file": "src/foo.ts", "line": 42, "severity": "advisory", "evidence": "loadConfig() returns before closing the file handle on the error path" }
    ],
    "fixLoops": 1
  },
  "simplifyRan": true,
  "userVerification": {
    "required": true,
    "status": "confirmed",
    "routes": ["/dashboard"],
    "confirmedBy": "user",
    "observations": ["Dashboard renders correctly"]
  },
  "intentAlignment": "aligned",
  "verdict": "pass",
  "score": 8
}
```

`{LINT_CMD}` / `{BUILD_CMD}` / `{TEST_CMD}` are resolved via the discovery protocol in `skills/phantom/references/verification.md`. The real file records the concrete commands actually run.

`review.findings[]` elements are review findings: one shape, one severity scale,
defined and enforced in [`review.md`](review.md). The example above used to read
`{"severity": "warn", "message": "Unused import"}` — a fifth severity spelling
attached to a lint nit that `agents/auditor.md` explicitly forbids reporting because
it is enforced mechanically elsewhere. Corrected in B10: the worked example is now
something a reviewer is actually allowed to report.

`review.temperature` is NOT a severity. It is a 0-1 knob on how hard the reviewer
looks — an input to the review. `findings[].severity` is how a finding is scored
once found — an output of it. F9 counted the two as overlapping vocabularies; they
are orthogonal axes and both stay.
