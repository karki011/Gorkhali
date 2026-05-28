# `review-panel.json` Schema

Written by wrap's Pre-Ship Review Panel (RPSL). Must pass before PR creation.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| perspectives | object[] | yes | Array of perspective verdicts |
| perspectives[].role | `"scope"` \| `"regression"` \| `"architecture"` \| `"skeptic"` | yes | Reviewer perspective |
| perspectives[].verdict | `"pass"` \| `"fail"` | yes | Pass/fail for this perspective |
| perspectives[].findings | string[] | yes | Key findings (empty if pass) |
| perspectives[].confidence | `"checked:clean"` \| `"checked:concerns"` \| `"not_observed"` | yes | Observation confidence |
| allPass | boolean | yes | True only if all perspectives pass |
| blockers | string[] | yes | Aggregated blocking issues (empty if allPass) |

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
