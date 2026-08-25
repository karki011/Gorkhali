# `brainstorm.json` Schema

Written by `gorkhali:brainstorm`'s Diverge phase. Schema v3 is a
decision-first review contract presented at the Convergence human gate before a
choice is locked into `decisions.json`.

<!-- BEGIN GENERATED FIELDS - regenerate with scripts/gen-schema-docs.js; do not edit by hand -->
| Field | Type | Required | Description |
| --- | --- | --- | --- |
| briefing | object | _meta.version >= 3: yes; older: no | Plain-English What/Problem/How the human gate leads with |
| briefing.tackling | string | _meta.version >= 3: yes; older: no | What this decision is tackling, in one sentence |
| briefing.problem | string | _meta.version >= 3: yes; older: no | The pain the approaches address, in plain language |
| briefing.how | string | _meta.version >= 3: yes; older: no | How the recommendation solves it; a How without evidence is an assumption |
| briefing.scope | string | _meta.version >= 3: yes; older: no | What is in and out of this decision, in plain language |
| briefing.risks | string | _meta.version >= 3: yes; older: no | Material risks of the recommended direction, in plain language |
| decision | object | _meta.version >= 3: yes; older: no | Decision frame shown before approaches |
| decision.question | string | _meta.version >= 3: yes; older: no | The choice the user is being asked to make |
| decision.outcome | string | _meta.version >= 3: yes; older: no | Desired observable outcome |
| decision.constraints | string[] | _meta.version >= 3: yes; older: no | Hard boundaries every approach must satisfy |
| decision.evaluationCriteria | string[] | _meta.version >= 3: yes; older: no | Criteria fixed before candidate evaluation |
| evidence | object[] | _meta.version >= 3: yes; older: no | Claims and sources gathered before divergence |
| openQuestions | object[] | _meta.version >= 3: yes; older: no | Unresolved questions, including whether each blocks the decision |
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
| cheapestExperiment | object | _meta.version >= 3: yes; older: no | Lowest-cost experiment that can resolve material uncertainty |
| directionGate | object | _meta.version >= 3: yes; older: no | Explicit user choice prompt and valid approach IDs |
<!-- END GENERATED FIELDS -->

**Example:**
```json
{
  "_meta": { "version": 3, "...": "..." },
  "briefing": {
    "tackling": "How planning results should be presented",
    "problem": "Users see tasks and waves instead of a researched recommendation",
    "how": "Lead with What, Problem, and How, then a comparison of distinct approaches",
    "scope": "Review presentation for planning results",
    "risks": "A task-first review delays informed approval"
  },
  "decision": {
    "question": "How should planning results be presented?",
    "outcome": "Users understand and can approve the direction before execution",
    "constraints": ["Offline deterministic HTML"],
    "evaluationCriteria": ["Decision clarity", "Evidence", "Review speed"]
  },
  "evidence": [
    { "claim": "The current schema requires task mechanics but not rationale", "source": "scripts/validate-artifact.js", "status": "verified" }
  ],
  "openQuestions": [],
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
    },
    {
      "id": "approach-b-endpoint-first",
      "name": "Endpoint-first refactor",
      "thesis": "Create a dedicated API contract before changing callers",
      "description": "Introduce a focused endpoint and migrate consumers after its contract is verified",
      "whyLens": "risk-first",
      "effort": "medium",
      "risk": "medium",
      "reversibility": "medium",
      "whatBreaks": ["The endpoint contract adds a migration boundary"],
      "whenToPick": "Pick when callers are expected to diverge",
      "mutualExclusivity": ["approach-a-hooks-first"],
      "visualType": "flow"
    }
  ],
  "recommendedDefault": {
    "id": "approach-a-hooks-first",
    "reason": "Lowest risk, reuses the existing query pattern, and validated:5+ in learnings/frontend.md"
  },
  "cheapestExperiment": {
    "question": "Does decision-first ordering improve review comprehension?",
    "method": "Generate the same plan in both orders and compare",
    "successSignal": "Reviewer identifies the recommendation without reading tasks",
    "cost": "One representative review and comprehension check"
  },
  "directionGate": {
    "question": "Which approach should planning use?",
    "options": ["approach-a-hooks-first", "approach-b-endpoint-first"]
  }
}
```

## Field Notes

- `approaches[].id` is the stable slug other fields reference — `recommendedDefault.id` and `mutualExclusivity[]` entries must match one.
- `whyLens` names the generating lens (`simplest` / `robust` / `reuse` in Council Mode) or otherwise records why the approach takes its shape.
- `visualType` is a hint for whether the approach is best conveyed as a diagram/flow/sitemap/mockup before the human gate; `null` or omitted means a text card is enough.
- The schema is intentionally open beyond the spine above — additional free-text fields (e.g. `pros`, `cons`) are not rejected. Don't rely on this to skip the required spine fields.
- v1/v2 artifacts remain readable. New brainstorms use v3, which additionally
  requires the decision frame, evidence, open-question ledger, 2-3 approaches,
  cheapest discriminating experiment, and explicit direction gate.
