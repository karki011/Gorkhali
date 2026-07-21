# `plan.json` Schema

Written by Phase B after plan-check and Rival review. Schema v3 is a
decision-first review contract; its task list drives Phase C execution only
after the human or delegated approval is recorded separately.

<!-- BEGIN GENERATED FIELDS - regenerate with scripts/gen-schema-docs.js; do not edit by hand -->
| Field | Type | Required | Description |
| --- | --- | --- | --- |
| depth | `"quick"` \| `"standard"` \| `"deep"` | _meta.version >= 3: yes; older: no | Adaptive planning depth; controls optional architecture and research breadth |
| problem | string | _meta.version >= 3: yes; older: no | Problem the plan resolves |
| decision | object | _meta.version >= 3: yes; older: no | Recommendation and approval question shown first |
| decision.question | string | _meta.version >= 3: yes; older: no | What the user is approving |
| decision.recommendation | string | _meta.version >= 3: yes; older: no | Recommended direction in one sentence |
| decision.rationale | string[] | _meta.version >= 3: yes; older: no | Evidence-backed reasons for the recommendation |
| decision.status | `"pending"` \| `"delegated"` | _meta.version >= 3: yes; older: no | Approval state; the model never marks its own plan approved |
| outcome | object | _meta.version >= 3: yes; older: no | Goal and observable definition of done |
| scope | object | _meta.version >= 3: yes; older: no | In-scope, out-of-scope, and constraints |
| solution_shape | object | v3 standard/deep: yes; v3 quick and older: no | Architecture summary, components, and data flow |
| evidence | object[] | _meta.version >= 3: yes; older: no | Claims, sources, and evidence states |
| alternatives | object[] | _meta.version >= 3: array; standard/deep non-empty | Considered alternatives and why they were not selected |
| assumptions | object[] | _meta.version >= 3: yes; older: no | Explicit assumptions rather than hidden guesses |
| open_questions | object[] | _meta.version >= 3: yes; older: no | Unresolved questions and whether they block execution |
| risks | object[] | _meta.version >= 3: yes; older: no | Risks, mitigations, reversibility, and recovery |
| validation | object | _meta.version >= 3: yes; older: no | Validation strategy, checks, and definition of done |
| route | `"solo"` \| `"shadows"` | yes | Whether to spawn agents or work inline |
| devilsAdvocateVerdict | `"PROCEED"` \| `"REVISE"` \| `"RETHINK"` | yes | Grill gate outcome |
| tasks | object[] | yes | Ordered list of task objects |
| tasks[].id | string | yes | Unique task ID |
| tasks[].description | string | yes | What this task does |
| tasks[].files | string[] | yes | Files expected to be touched |
| tasks[].acceptance_criteria | string[] | _meta.version >= 2: yes; v1: no | Shell commands or observable facts Ward checks; each item a command/fact, never prose |
| tasks[].verify | string | _meta.version >= 2: yes; v1: no | Single command that exits 0 on success; must be runnable by Ward |
| tasks[].dependsOn | string[] | no | Task IDs this task must wait for |
| tasks[].agent | string | no | Agent role for shadows route |
| tasks[].read_first | string[] | _meta.version >= 3: yes; older: no | Files and references to inspect before editing |
| tasks[].action | string | _meta.version >= 3: yes; older: no | Concrete implementation action |
| tasks[].risk | string | v3 standard/deep: yes; quick/older: no | Task-local failure risk |
| tasks[].recovery | string | v3 standard/deep: yes; quick/older: no | Task-local rollback or recovery path |
| tasks[].profile | `"economy"` \| `"balanced"` \| `"deep"` | _meta.version >= 3: yes; older: no | Lowest sufficient delegated compute profile |
| antiRepetition | string[] | no | Patterns to avoid (from learnings) |
| estimatedSpawns | number | no | Expected agent count for shadows route |
<!-- END GENERATED FIELDS -->

**Schema v3 example:**
```json
{
  "_meta": { "version": 3, "...": "..." },
  "depth": "standard",
  "problem": "The current planning gate exposes execution mechanics without explaining the decision",
  "decision": {
    "question": "Approve a decision-first plan and HTML review contract?",
    "recommendation": "Lead with evidence and rationale, then show tasks as an appendix",
    "rationale": ["Users must understand why the plan is correct before approving implementation"],
    "status": "pending"
  },
  "outcome": {
    "goal": "Every plan gate communicates a researched recommendation",
    "doneWhen": ["Decision brief appears before the first task"]
  },
  "scope": { "in": ["plan artifacts and AI-authored review HTML"], "out": [], "constraints": ["offline HTML"] },
  "solution_shape": {
    "summary": "One machine artifact with a generated human review surface",
    "components": ["plan validator", "AI-authored review", "review safety validator"],
    "dataFlow": ["plan.json", "validate JSON", "author HTML", "validate HTML", "human approval"]
  },
  "evidence": [{ "claim": "The v2 schema only requires task mechanics", "source": "scripts/validate-artifact.js", "status": "verified" }],
  "alternatives": [{ "name": "Task-first plan", "tradeoffs": ["Fast to emit but weak to review"], "reason": "Rejected" }],
  "assumptions": [],
  "open_questions": [],
  "risks": [],
  "validation": {
    "strategy": "Schema, review-safety, and end-to-end tests",
    "definitionOfDone": ["A canonical v3 plan validates and produces a safe AI-authored review"],
    "checks": ["npm test"]
  },
  "route": "solo",
  "devilsAdvocateVerdict": "PROCEED",
  "tasks": [
    {
      "id": "T1",
      "description": "Validate the AI-authored decision review before presentation",
      "read_first": ["skills/phantom/scripts/validate-review-html.mjs"],
      "action": "Enforce the review HTML safety and decision-fidelity contract",
      "files": ["skills/phantom/scripts/validate-review-html.mjs"],
      "dependsOn": [],
      "acceptance_criteria": ["Unsafe or decision-incomplete review HTML cannot replace the accepted page"],
      "verify": "node --test test/validate-review-html.test.js",
      "risk": "A generated page may omit decision-critical text",
      "recovery": "Regenerate from canonical plan.json or fall back to the chat review",
      "profile": "balanced"
    }
  ]
}
```

---

## Task Structure Template (extended fields)

Each entry in `plan.json -> tasks[]` must follow this shape:

```json
{
  "id": "T1",
  "description": "Add useCostByTag hook that calls /api/cost-by-tag and memoizes result",
  "read_first": [
    "src/hooks/useCostData.ts",
    "src/api/client.ts"
  ],
  "acceptance_criteria": [
    "grep -r 'export.*useCostByTag' src/hooks/ finds exactly one match",
    "{TEST_CMD} -- useCostByTag exits 0",
    "Hook returns { data, loading, error } matching CostByTagResponse type"
  ],
  "action": "Create src/hooks/useCostByTag.ts with memoized selector, error boundary, and TypeScript types",
  "verify": "{TEST_CMD} && {LINT_CMD}",
  "files": ["src/hooks/useCostByTag.ts", "src/hooks/useCostByTag.test.ts"],
  "dependsOn": [],
  "agent": "backend"
}
```

`{TEST_CMD}` / `{LINT_CMD}` are resolved via the discovery protocol in `reference/verification.md`. Generated plans must contain the resolved concrete commands, not the placeholders.

**Field rules:**

| Field | Rule |
|-------|------|
| `read_first` | Files the agent reads BEFORE writing. Prevents blind edits. |
| `acceptance_criteria` | Each item is a shell command or observable fact. Never prose. |
| `action` | One sentence. Subject = what file. Verb = what operation. No "etc." |
| `verify` | Single command that exits 0 on success. Must be runnable by Ward. |
| `files` | Non-empty. Files agent is expected to create or modify. |

`read_first`, `action`, non-empty `files`, `risk`, `recovery`, and `profile` are
enforced for v3 plans. Ward reads `acceptance_criteria` and `verify` to validate
task completion.

---

## Schema Version Gate

- **v1** (`_meta.version: 1`, or absent): `tasks[].acceptance_criteria` and `tasks[].verify` are optional. Older plans keep validating without them.
- **v2** (`_meta.version: 2`): both become required and non-empty. Existing v2
  plans remain supported; `validate-artifact.js` names any offending task index.
- **v3** (`_meta.version: 3`): adds the required decision-first narrative,
  architecture, evidence, alternatives, assumptions, risks, validation contract,
  research-free task fields, unique dependency graph, and placeholder checks.
  v1/v2 artifacts remain readable and valid for backward compatibility; all new
  plans use v3. `depth: quick` may omit `solution_shape`, use an empty
  `alternatives` array, and omit task-local risk/recovery; standard/deep plans
  require those fields so concise plans do not manufacture ceremony.
