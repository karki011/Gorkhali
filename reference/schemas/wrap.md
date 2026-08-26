# `wrap.json` Schema

Written by `gorkhali:wrap` when the session opens a ready-for-review PR. Closeout after merge is `close.json`.

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
| greptile.status | string | yes (if present) | Canonical values greploop writes: `"done"` (loop completed) and `"skipped"` (Greptile unavailable on the repo) — greploop is the sole writer of these. `"pending"` (or missing) = loop not yet run → the Stop-hook gate `hooks/greploop-gate.js` blocks the session at end while a live PR sits here. The gate matches **case-insensitively by PREFIX**, so freeform suffixes are tolerated as settled (e.g. `"skipped — availability guard (Greptile not installed on this repo)"`, legacy `"done — 5/5"`); only `"pending…"`/`"requested"`/empty/missing block. Bias is to ALLOW on unknown values. |
| learnings | object | yes | Learning record actions |
| learnings.recorded | string[] | yes | Learnings written this session |
| learnings.promoted | string[] | yes | Learnings promoted to validated |
| learnings.pruned | string[] | yes | Stale learnings removed |
| defenseBrief | object | no | `{ path, questions, sections }` pointer to `defense-brief.md`. Never a substitute for the brief. |
| prBody | object | no | `{ path, sections, gaps }` pointer to `pr-body.md`. |
| commit | string | no | HEAD commit at wrap time. |
| base | string | no | Base branch name. |
| head | string | no | Head branch name. |
| qualityArtifacts | object | no | Pointers to verification/review artifacts used at wrap. |
| caveats | string[] | no | Known caveats. Empty array when none. |
| summary | string | no | Portable-envelope alias of `brief`. Native wrap uses `brief`. |
| modelRouting | object | no | Observable model-routing diagnostics. Measurement still belongs in `outcome.json`. |
<!-- END GENERATED FIELDS -->

**Closed keys.** The table plus portable envelope keys (`schema_version`, `artifact_type`, `evidence`, …) are the only legal top-level wrap fields. Measurement (`route`, `wall_time_ms`, `agents`, gh `pr_state`) is authored by `scripts/outcome-write.js` into `outcome.json` — never copied onto `wrap.json`. Historical files on disk may still carry extra keys; new writes are rejected.

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
