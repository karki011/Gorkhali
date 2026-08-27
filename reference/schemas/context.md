# `context.json` Schema

Written by Phase A (`gorkhali:start`). Provides ticket context for all downstream phases.

<!-- BEGIN GENERATED FIELDS - regenerate with scripts/gen-schema-docs.js; do not edit by hand -->
| Field | Type | Required | Description |
| --- | --- | --- | --- |
| ticket | string | yes | Ticket key or task label |
| summary | string | yes | Human-readable ticket summary |
| source | `"jira"` \| `"args"` \| `"branch"` | yes | Where context was sourced from |
| jira | object \| `null` | no | Raw Jira issue fields (if source=jira) |
| learningsRefs | string[] | no | Paths to relevant learning files |
| learningsCited | string[] | no | Keywords injected this session |
| modelOverride | string \| `null` | no | Force a specific model for spawns |
<!-- END GENERATED FIELDS -->

**Example:**
```json
{
  "_meta": { "...": "..." },
  "ticket": "PROJ-123",
  "summary": "Add cost-per-tag breakdown to the dashboard",
  "source": "jira",
  "jira": { "status": "In Progress", "priority": "High", "assigned": "assigned | already-mine | reassigned | skipped | unavailable", "transition": "in-progress | already | skipped | no-match | terminal | unavailable" },
  "learningsRefs": ["~/.gorkhali/repos/{REPO_NAME}/learnings/frontend.md"],
  "modelOverride": null
}
```
