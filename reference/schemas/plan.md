# `plan.json` Schema

Written by Phase B after devil's advocate review. Drives Phase C execution.

<!-- BEGIN GENERATED FIELDS - regenerate with scripts/gen-schema-docs.js; do not edit by hand -->
| Field | Type | Required | Description |
| --- | --- | --- | --- |
| route | `"solo"` \| `"shadows"` | yes | Whether to spawn agents or work inline |
| devilsAdvocateVerdict | `"PROCEED"` \| `"REVISE"` \| `"RETHINK"` | yes | Grill gate outcome |
| tasks | object[] | yes | Ordered list of task objects |
| tasks[].id | string | yes | Unique task ID |
| tasks[].description | string | yes | What this task does |
| tasks[].files | string[] | yes | Files expected to be touched |
| tasks[].dependsOn | string[] | no | Task IDs this task must wait for |
| tasks[].agent | string | no | Agent role for shadows route |
| antiRepetition | string[] | no | Patterns to avoid (from learnings) |
| estimatedSpawns | number | no | Expected agent count for shadows route |
<!-- END GENERATED FIELDS -->

**Example:**
```json
{
  "_meta": { "...": "..." },
  "route": "shadows",
  "devilsAdvocateVerdict": "PROCEED",
  "tasks": [
    {
      "id": "T1",
      "description": "Add useCostByTag hook",
      "files": ["src/hooks/useCostByTag.ts"],
      "dependsOn": [],
      "agent": "backend"
    },
    {
      "id": "T2",
      "description": "Build CostByTagTable component",
      "files": ["src/components/CostByTagTable.tsx"],
      "dependsOn": ["T1"],
      "agent": "frontend"
    }
  ],
  "antiRepetition": ["Do not use instanceof across module boundaries"],
  "estimatedSpawns": 2
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

> `read_first` and `acceptance_criteria` are extensions to the base schema.
> Agents read them from the task object; Ward reads `acceptance_criteria` to validate task completion.
