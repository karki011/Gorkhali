# `execution.json` Schema

Written by Phase C after agents complete. Summarizes what was actually done.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| tasks | object[] | yes | Per-task execution results |
| tasks[].id | string | yes | Task ID from plan.json |
| tasks[].status | `"done"` \| `"failed"` \| `"skipped"` | yes | Final task status |
| tasks[].agent | string | no | Agent that ran this task |
| tasks[].filesChanged | string[] | yes | Files actually modified |
| tasks[].selfReviewScore | number | no | Agent's self-review score (0-10) |
| tasks[].outputSummary | string | yes | 1-2 sentence summary of what was done |
| totalSpawns | number | yes | Total agent instances spawned |
| agentOutputs | string | no | Path to raw agent output logs |

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
      "selfReviewScore": 9,
      "outputSummary": "Hook added with memoized selector and error boundary."
    },
    {
      "id": "T2",
      "status": "done",
      "agent": "frontend",
      "filesChanged": ["src/components/CostByTagTable.tsx", "src/components/CostByTagTable.test.tsx"],
      "selfReviewScore": 8,
      "outputSummary": "Table renders with loading/empty states; snapshot test added."
    }
  ],
  "totalSpawns": 2,
  "agentOutputs": "~/.claude/phantom-data/repos/{REPO_NAME}/sessions/ENG-1234/agent-logs/"
}
```
