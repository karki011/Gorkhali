# `review-panel.json` Schema

Written by wrap's Pre-Ship Review Panel (RPSL). Must pass before PR creation.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| perspectives | object[] | yes | Array of perspective verdicts |
| perspectives[].role | `"scope"` \| `"regression"` \| `"architecture"` \| `"skeptic"` | yes | Reviewer perspective |
| perspectives[].verdict | `"pass"` \| `"fail"` \| `"not_observed"` | yes | Pass/fail for this perspective, or `not_observed` if this perspective never produced a verdict |
| perspectives[].findings | string[] | yes | Key findings (empty if pass) |
| perspectives[].confidence | `"checked:clean"` \| `"checked:concerns"` \| `"not_observed"` | yes | Observation confidence |
| allPass | boolean | yes | True only if EVERY `perspectives[].verdict` is `pass`. A single `fail` or `not_observed` makes it false. |
| blockers | string[] | yes | Aggregated blocking issues (empty if allPass) |

## The three verdicts

`pass` and `fail` are both observations: a reviewer looked and reached a conclusion. `not_observed` is the absence of one - the perspective was spawned but no verdict reached disk, so nobody knows. Reviewers never write it about themselves; Apex writes it during the merge for a role file still missing or verdict-less after the single resume in `reference/wrap/rpsl.md`. It always carries a matching `blockers[]` entry naming the unreviewed perspective.

**`verdict: "pass"` with `confidence: "not_observed"` is invalid.** Nothing was observed, so there is no basis for a pass, and writing one respells an unreviewed perspective as a reviewed clean one, moving the same hole from the verdict axis to the confidence axis. Use `verdict: "not_observed"`. The legal pairings:

| verdict | legal confidence |
|---------|------------------|
| `pass` | `checked:clean`, `checked:concerns` |
| `fail` | `checked:clean`, `checked:concerns` |
| `not_observed` | `not_observed` only |

`fail` and `not_observed` are not interchangeable either. A `fail` stops the wrap with no override; a `not_observed` ships a draft PR that names the gap. See the Panel Decision in `reference/wrap/rpsl.md`.

`review-panel.json` is not machine-validated: `scripts/validate-artifact.js` carries schemas for context, intent, brainstorm, decisions, plan, execution, verification and wrap, but none for review-panel. This document plus `test/reviewer-artifact-durability.test.js` are the whole contract, so an invalid combination gets written happily and only the tests notice.

**Example:**
```json
{
  "_meta": { "...": "..." },
  "perspectives": [
    {
      "role": "scope",
      "verdict": "pass",
      "findings": [],
      "confidence": "checked:clean"
    },
    {
      "role": "regression",
      "verdict": "pass",
      "findings": ["No removed test coverage detected"],
      "confidence": "checked:clean"
    },
    {
      "role": "architecture",
      "verdict": "pass",
      "findings": ["Follows existing hook pattern from useCostData"],
      "confidence": "checked:clean"
    },
    {
      "role": "skeptic",
      "verdict": "pass",
      "findings": ["API error path could surface better UX — logged as INFO, not blocking"],
      "confidence": "checked:concerns"
    }
  ],
  "allPass": true,
  "blockers": []
}
```

**Example with an unobserved perspective** (the skeptic file was still missing after the single resume):
```json
{
  "perspectives": [
    { "role": "scope", "verdict": "pass", "findings": [], "confidence": "checked:clean" },
    { "role": "regression", "verdict": "pass", "findings": [], "confidence": "checked:clean" },
    { "role": "architecture", "verdict": "pass", "findings": [], "confidence": "checked:clean" },
    {
      "role": "skeptic",
      "verdict": "not_observed",
      "findings": ["No verdict on disk after one resume - this perspective did not review the diff"],
      "confidence": "not_observed"
    }
  ],
  "allPass": false,
  "blockers": ["skeptic perspective not_observed - production-risk review did not run"]
}
```

`allPass` is `false` with no `fail` anywhere. That combination is what tells the ship ceremony to create the draft PR and name the skeptic gap in its body.
