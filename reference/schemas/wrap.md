# `wrap.json` Schema

Written by `phantom:wrap` after all post-merge actions complete.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| pr | object \| `null` | yes | PR details, or null if no PR |
| pr.number | number | yes | PR number |
| pr.url | string | yes | PR URL |
| pr.status | string | yes | PR status (e.g., `"open"`, `"merged"`) |
| jira | object \| `null` | no | Jira update result |
| jira.ticket | string | yes (if present) | Ticket key |
| jira.transition | string | yes (if present) | Transition applied |
| jira.commented | boolean | yes (if present) | Whether comment was posted |
| greptile | object \| `null` | no | Greptile review result |
| greptile.requested | boolean | yes (if present) | Whether review was requested |
| greptile.status | string | yes (if present) | `"pending"`, `"done"`, `"skipped"` |
| learnings | object | yes | Learning record actions |
| learnings.recorded | string[] | yes | Learnings written this session |
| learnings.promoted | string[] | yes | Learnings promoted to validated |
| learnings.pruned | string[] | yes | Stale learnings removed |

**Example:**
```json
{
  "_meta": { "...": "..." },
  "pr": {
    "number": 1042,
    "url": "https://github.com/org/repo/pull/1042",
    "status": "open"
  },
  "jira": {
    "ticket": "ENG-1234",
    "transition": "In Review",
    "commented": true
  },
  "greptile": {
    "requested": true,
    "status": "pending"
  },
  "learnings": {
    "recorded": ["Use duck-type checks across module boundaries"],
    "promoted": [],
    "pruned": []
  }
}
```
