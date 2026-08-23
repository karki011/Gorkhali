# `wrap.json` Schema

Written by `gorkhali:wrap` after all post-merge actions complete.

<!-- BEGIN GENERATED FIELDS - regenerate with scripts/gen-schema-docs.js; do not edit by hand -->
| Field | Type | Required | Description |
| --- | --- | --- | --- |
| brief | string | yes | 3-6 sentence plain-language recap of the whole session: goal, what changed, notable decisions/corrections, outcome + open follow-ups. Rendered above the SESSION WRAPPED box. |
| pr | object \| `null` | yes | PR details, or null if no PR |
| pr.number | number | yes | PR number |
| pr.url | string | yes | PR URL |
| pr.status | string | yes | PR status: `"open"` is what wrap writes — PRs are created ready for review (see `reference/wrap/ship-ceremony.md` §4); `"merged"`, `"closed"`. `"draft"` stays legal for legacy sessions. The Stop-hook gate (`hooks/greploop-gate.js`) gates on PR *liveness* — it blocks any PR that is NOT `merged`/`closed` (matched case-insensitively), so `"open"` or legacy `"draft"` is still gated until greploop settles. |
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
<!-- END GENERATED FIELDS -->

**Example:**
```json
{
  "_meta": { "...": "..." },
  "brief": "Set out to fix the Explorer usage_amount bug where totals double-counted on date-range changes. Traced it to a stale timestamp in the range reducer, fixed the reducer and added a regression test. Mid-session we switched from patching the component to fixing the shared hook after finding two other callers. Ships green; follow-up: backfill tests for the sibling callers.",
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
