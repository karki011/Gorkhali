# `pause-state.json` Schema

Written by `phantom:pause`. Read by `phantom:resume` to restore context.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ticket | string | yes | Jira ticket key or task ID |
| phase | string (`A`/`B`/`C`/`D`) | yes | Phase where work was paused |
| phaseStep | string | no | Sub-step within the phase |
| status | `"paused"` | yes | Always `"paused"` |
| intent | string | no | File path to `intent.json` |
| plan | string | no | File path to `plan.json` |
| contracts | string[] | no | File paths to contract files |
| contractsCompleted | string[] | no | Contract IDs already fulfilled |
| contractsPending | string[] | no | Contract IDs still pending |
| route | `"solo"` \| `"shadows"` | no | Execution route chosen in phase B |
| verifyStatus | `"pass"` \| `"fail"` \| `null` | no | Result of last verify run |
| resumeNotes | string | yes | Human-readable context for resume |

**Example:**
```json
{
  "_meta": { "...": "..." },
  "ticket": "ENG-1234",
  "phase": "C",
  "phaseStep": "agent-spawn",
  "status": "paused",
  "intent": "~/.claude/team/state/sessions/ENG-1234/intent.json",
  "plan": "~/.claude/team/state/sessions/ENG-1234/plan.json",
  "contracts": ["~/.claude/team/state/sessions/ENG-1234/contracts/api.md"],
  "contractsCompleted": [],
  "contractsPending": ["api.md"],
  "route": "shadows",
  "verifyStatus": null,
  "resumeNotes": "Paused mid-spawn; frontend agent finished, backend pending."
}
```
