# `intent.json` Schema

Written by Phase B (`phantom:start`). Defines the goal contract for verify and wrap.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| goal | string | yes | Single clear goal statement |
| doneWhen | string[] | yes | Acceptance criteria (observable, testable) |
| priority | string[] | yes | Ordered implementation priorities |
| tradeoffs | string[] | no | Acknowledged tradeoffs |
| nonNegotiables | string[] | no | Hard constraints that must not be violated |
| specDelta | string | yes | What changed from original requirements — or `"none"` if first pass |

**Example:**
```json
{
  "_meta": { "...": "..." },
  "goal": "Render a cost-per-tag breakdown table below the existing cost summary",
  "doneWhen": [
    "Table renders with correct tag keys and summed costs",
    "Loading and empty states are handled",
    "Existing tests pass; new snapshot test added"
  ],
  "priority": [
    "Correctness of cost rollup",
    "Accessible table markup",
    "Performance — avoid redundant API calls"
  ],
  "tradeoffs": ["No pagination for now; defer until >50 tags is common"],
  "nonNegotiables": ["No new dependencies without approval"],
  "specDelta": "Narrowed from 'full cost analytics page' to 'tag breakdown table only' — deferring chart views per user decision"
}
```
