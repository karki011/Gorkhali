# `wrap.json` Schema

Written by `phantom:wrap` after all post-merge actions complete.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| pr | object \| `null` | yes | PR details, or null if no PR |
| pr.number | number | yes | PR number |
| pr.url | string | yes | PR URL |
| pr.status | string | yes | PR status: `"draft"` (wrap ALWAYS creates draft PRs — see `reference/wrap/ship-ceremony.md` §4), `"open"`, `"merged"`, `"closed"`. The Stop-hook gate (`hooks/greploop-gate.js`) gates on PR *liveness* — it blocks any PR that is NOT `merged`/`closed` (matched case-insensitively), so a draft labeled `"draft"` OR `"open"` is still gated until greploop settles. |
| jira | object \| `null` | no | Jira update result |
| jira.ticket | string | yes (if present) | Ticket key |
| jira.transition | string | yes (if present) | Transition applied |
| jira.commented | boolean | yes (if present) | Whether comment was posted |
| greptile | object \| `null` | no | Greptile review result |
| greptile.requested | boolean | yes (if present) | Whether review was requested |
| greptile.status | string | yes (if present) | Canonical values greploop writes: `"done"` (completed, 5/5) and `"skipped"` (Greptile unavailable on the repo) — greploop is the sole writer of these. `"pending"` (or missing) = loop not yet run → the Stop-hook gate `hooks/greploop-gate.js` blocks the session at end while a live PR sits here. The gate matches **case-insensitively by PREFIX**, so freeform suffixes are tolerated as settled (e.g. `"skipped — availability guard (Greptile not installed on this repo)"`, `"done — 5/5"`); only `"pending…"`/`"requested"`/empty/missing block. Bias is to ALLOW on unknown values. |
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
    "status": "draft"
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
