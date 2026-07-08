# `brainstorm.json` Schema

Written by `phantom:brainstorm`'s Diverge phase. Holds the candidate approach cards presented at the Convergence human gate, before a decision is locked into `decisions.json`.

<!-- BEGIN GENERATED FIELDS - regenerate with scripts/gen-schema-docs.js; do not edit by hand -->
| Field | Type | Required | Description |
| --- | --- | --- | --- |
| approaches | object[] | yes | Candidate approach cards from the diverge phase |
| approaches[].id | string | yes | Stable slug identifying this approach |
| approaches[].name | string | yes | Short approach label |
| approaches[].thesis | string | yes | One-sentence core argument for this approach |
| approaches[].description | string | yes | Fuller explanation of the approach |
| approaches[].whyLens | string | yes | Generating lens (e.g. `simplest`, `robust`, `reuse`) or reasoning behind proposing this shape |
| approaches[].effort | string | yes | Relative implementation effort (e.g. `low`/`medium`/`high`) |
| approaches[].risk | string | yes | Relative risk level (e.g. `low`/`medium`/`high`) |
| approaches[].reversibility | string | yes | How easily this choice can be undone later |
| approaches[].whatBreaks | string[] | yes | Things that would need rework if this approach is chosen |
| approaches[].whenToPick | string | yes | Guidance on when this approach is the right call |
| approaches[].mutualExclusivity | string[] | no | IDs of other approaches this one cannot be combined with |
| approaches[].visualType | `"diagram"` \| `"flow"` \| `"sitemap"` \| `"mockup"` \| `null` | no | Kind of visual artifact best suited to convey this approach, if any |
| recommendedDefault | object | yes | The coordinator's or Chairman's recommended pick |
| recommendedDefault.id | string | yes | Must match one of `approaches[].id` |
| recommendedDefault.reason | string | yes | Why this approach is recommended |
<!-- END GENERATED FIELDS -->

**Example:**
```json
{
  "_meta": { "...": "..." },
  "approaches": [
    {
      "id": "approach-a-hooks-first",
      "name": "Hooks-first refactor",
      "thesis": "Extract the shared fetch/memo logic into one hook and let both callers consume it",
      "description": "Add useCostByTag alongside the existing useCostData, sharing the underlying query client instance",
      "whyLens": "reuse",
      "effort": "low",
      "risk": "low",
      "reversibility": "high",
      "whatBreaks": ["Any code relying on useCostData's current return shape would need a follow-up pass"],
      "whenToPick": "Pick this when the two call sites are expected to stay close in shape",
      "mutualExclusivity": ["approach-b-new-endpoint"],
      "visualType": null
    }
  ],
  "recommendedDefault": {
    "id": "approach-a-hooks-first",
    "reason": "Lowest risk, reuses the existing query pattern, and validated:5+ in learnings/frontend.md"
  }
}
```

## Field Notes

- `approaches[].id` is the stable slug other fields reference — `recommendedDefault.id` and `mutualExclusivity[]` entries must match one.
- `whyLens` names the generating lens (`simplest` / `robust` / `reuse` in Council Mode) or otherwise records why the approach takes its shape.
- `visualType` is a hint for whether the approach is best conveyed as a diagram/flow/sitemap/mockup before the human gate; `null` or omitted means a text card is enough.
- The schema is intentionally open beyond the spine above — additional free-text fields (e.g. `pros`, `cons`) are not rejected. Don't rely on this to skip the required spine fields.
