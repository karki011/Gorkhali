# `execution.json` Schema

Written by Phase C after agents complete. Summarizes what was actually done.

Each `tasks[]` entry is the typed Blade→Apex completion record — Apex reads these fields directly instead of parsing free-text handoff prose.

<!-- BEGIN GENERATED FIELDS - regenerate with scripts/gen-schema-docs.js; do not edit by hand -->
| Field | Type | Required | Description |
| --- | --- | --- | --- |
| tasks | object[] | yes | Per-task execution results |
| tasks[].id | string | yes | Task ID from plan.json |
| tasks[].status | `"done"` \| `"failed"` \| `"skipped"` | yes | Final task status |
| tasks[].agent | string | no | Agent that ran this task |
| tasks[].filesChanged | string[] | yes | Files actually modified |
| tasks[].filesRead | string[] | no | Files read but NOT changed (wave-handoff awareness) |
| tasks[].selfReviewScore | number | no | Agent's self-review score (0-10) |
| tasks[].testResult | object \| string | no | `{ passed: bool, summary?: string }` or a short string |
| tasks[].blocker | string \| null | no | Blocker description; null/absent when none |
| tasks[].wave | object | no | Wave membership `{ index, isLastInWave }` — drives the wake classifier's last-in-wave surface |
| tasks[].drift | boolean | no | True when output drifted from stated intent; drives an actionable wake |
| tasks[].outputSummary | string | yes | 1-2 sentence summary of what was done |
| totalSpawns | number | yes | Total agent instances spawned |
| agentOutputs | string | no | Path to raw agent output logs |
<!-- END GENERATED FIELDS -->

**Example:**
```json
{
  "_meta": { "...": "..." },
  "tasks": [
    {
      "id": "T1",
      "status": "done",
      "agent": "backend",
      "filesChanged": ["src/hooks/useCostByTag.ts"],
      "filesRead": ["src/api/costClient.ts"],
      "selfReviewScore": 9,
      "testResult": { "passed": true, "summary": "12 unit tests green" },
      "blocker": null,
      "outputSummary": "Hook added with memoized selector and error boundary."
    },
    {
      "id": "T2",
      "status": "done",
      "agent": "frontend",
      "filesChanged": ["src/components/CostByTagTable.tsx", "src/components/CostByTagTable.test.tsx"],
      "selfReviewScore": 8,
      "testResult": "snapshot + loading/empty render tests pass",
      "outputSummary": "Table renders with loading/empty states; snapshot test added."
    }
  ],
  "totalSpawns": 2,
  "agentOutputs": "~/.phantom/repos/{REPO_NAME}/sessions/ENG-1234/agent-logs/"
}
```
