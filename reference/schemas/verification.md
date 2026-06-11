# `verification.json` Schema

Written by `phantom:verify`. Read by `phantom:wrap` to decide PR strategy.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
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
| review.temperature | number | yes | Reviewer strictness (0-1) |
| review.findings | object[] | yes | Array of finding objects |
| review.fixLoops | number | yes | How many fix/re-verify loops ran. Counter owned by `hooks/loop-controller.js`; capped at the fix-loop ceiling (canonical: `reference/temperature-review.md`, currently 2) unless a logged operator override extended it |
| simplifyRan | boolean | yes | Whether simplify was run on changed files |
| intentAlignment | `"aligned"` \| `"drift"` \| `"wrong"` | yes | How well output matches intent.json |
| verdict | `"pass"` \| `"fail"` | yes | Overall gate result |
| score | number (0-10) | no | Numeric quality score |

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
      { "file": "src/foo.ts", "line": 42, "severity": "warn", "message": "Unused import" }
    ],
    "fixLoops": 1
  },
  "simplifyRan": true,
  "intentAlignment": "aligned",
  "verdict": "pass",
  "score": 8
}
```

`{LINT_CMD}` / `{BUILD_CMD}` / `{TEST_CMD}` are resolved via the discovery protocol in `reference/verification.md`. The real file records the concrete commands actually run.
