# `decisions.json` Schema

Written by `phantom:brainstorm`'s Converge phase once the human picks a direction. Records the locked decision and what was ruled out.

<!-- BEGIN GENERATED FIELDS - regenerate with scripts/gen-schema-docs.js; do not edit by hand -->
| Field | Type | Required | Description |
| --- | --- | --- | --- |
| decisions | object[] | yes | Array of decision records (a `{ decisions: [] }` wrapper around the same array is also accepted) |
| decisions[].id | string | yes | Stable slug, e.g. `decision-001-state-management` |
| decisions[].decision | string | yes | What was decided |
| decisions[].status | string | yes | Decision lifecycle state, e.g. `"locked"` |
| decisions[].rationale | string | yes | Why this decision was made |
| decisions[].alternatives | string[] | yes | Alternatives considered and ruled out |
| councilUsed | boolean | no | Whether brainstorm Council Mode ran (see reference/brainstorm.md) |
| peerRankings | object[] | no | Aggregate rank per anonymized approach, present when councilUsed |
| chairmanRationale | string | no | Chairman synthesis rationale, present when councilUsed |
<!-- END GENERATED FIELDS -->

**Example:**
```json
{
  "_meta": { "...": "..." },
  "decisions": [
    {
      "id": "decision-001-state-management",
      "decision": "Use Jotai atoms for the cost-by-tag filter state",
      "status": "locked",
      "rationale": "Matches the existing @cloudzero/forms pattern; no new dependency",
      "alternatives": ["React Context (rejected — too much prop drilling)", "URL-only state (rejected — filter combos exceed a reasonable URL length)"]
    }
  ],
  "councilUsed": false
}
```

## Wrapper Leniency

The validator accepts the top-level `decisions` field as either a plain array (the canonical shape above) or an object shaped `{ decisions: [] }` — a common double-wrap mistake that is unwrapped rather than rejected.

## Council Fields

When brainstorm ran in Council Mode (see `reference/brainstorm.md` → Council Mode), also record `councilUsed: true`, `peerRankings` (aggregate rank per anonymized approach), and `chairmanRationale` — so the deliberation stays auditable.
