# `context.json` Schema

Written by Phase A (`phantom:start`). Provides ticket context for all downstream phases.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ticket | string | yes | Ticket key or task label |
| summary | string | yes | Human-readable ticket summary |
| source | `"jira"` \| `"args"` \| `"branch"` | yes | Where context was sourced from |
| jira | object \| `null` | no | Raw Jira issue fields (if source=jira) |
| learningsRefs | string[] | no | Paths to relevant learning files |
| phantomStrategy | string | no | Strategy from phantom_orchestrator_process |
| blastRadius | string[] | no | Files flagged by phantom_graph_blast_radius |
| modelOverride | string \| `null` | no | Force a specific model for spawns |

**Example:**
```json
{
  "_meta": { "...": "..." },
  "ticket": "ENG-1234",
  "summary": "Add cost-per-tag breakdown to the dashboard",
  "source": "jira",
  "jira": { "status": "In Progress", "priority": "High" },
  "learningsRefs": ["~/.claude/phantom/repos/feature-web-apps/learnings/frontend.md"],
  "phantomStrategy": "decompose",
  "blastRadius": ["src/components/Dashboard.tsx", "src/hooks/useCostData.ts"],
  "modelOverride": null
}
```
