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
| tasks[].acceptance_criteria | string[] | _meta.version >= 2: yes; v1: no | Shell commands or observable facts Ward checks; each item a command/fact, never prose |
| tasks[].verify | string | _meta.version >= 2: yes; v1: no | Single command that exits 0 on success; must be runnable by Ward |
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

> `read_first` is a doc-only extension to the base schema (not enforced by the validator).
> `acceptance_criteria` and `verify` are enforced starting at `_meta.version: 2` — see Schema
> Version Gate below. Agents read all three from the task object; Ward reads `acceptance_criteria`
> to validate task completion.

---

## Schema Version Gate

- **v1** (`_meta.version: 1`, or absent): `tasks[].acceptance_criteria` and `tasks[].verify` are optional. Older plans keep validating without them.
- **v2** (`_meta.version: 2`): both become required and non-empty. Plans written by the current planner set `_meta.version: 2`; `validate-artifact.js` rejects a v2 plan whose tasks are missing either field, naming the offending task index.
