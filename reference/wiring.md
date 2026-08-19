# Wiring Protocol

## Purpose

Wiring maps the **dependency topology** of a solution: what each task produces, what it consumes, and which tasks can run in parallel.

## When It Runs

FULL route only (multi-component, cross-cutting tasks):
```
plan.json written -> Opposition PROCEED (plan-check.json) -> [WIRING] -> Phase C execute
```
Skip wiring if: Solo route, or task count <= 2 with no shared files.

## Dependency Mapping

For each task in `plan.json -> tasks[]`, identify:

| Field | Question |
|-------|----------|
| `produces` | What files, exports, or API shapes does this task create? |
| `consumes` | What files or exports from OTHER tasks does this task need first? |

Build edges: if task A `produces` X and task B `consumes` X -> B depends on A.

Use `code-review-graph` (`query_graph`) when available, otherwise inspect repository imports and references to validate declared dependencies against actual import chains. Flag discrepancies.

## Wave Assignment

Topological sort of the dependency graph -> group into parallel waves:
- **Wave 1:** tasks with empty `consumes` (no plan-internal dependencies)
- **Wave N:** tasks whose `consumes` are all satisfied by Wave N-1 outputs
- Tasks in the same wave can be spawned in parallel

## Integration Risk Points

| Risk type | Condition | Mitigation |
|-----------|-----------|------------|
| `merge` | 2+ producers feed one consumer | Integration test after consumer's wave |
| `interface` | A producer is consumed by 3+ tasks | Lock exported shape before spawn; use contract file |
| `cycle` | Circular dependency detected | Plan is invalid -- re-plan before continuing |

## Wiring Artifact

Written to `{TEAM_DIR}/sessions/{TICKET}/wiring.json`. `_meta` fields follow `artifact-schemas.md`.

```json
{
  "dependencies": [
    { "task": "T1", "produces": ["src/api/billing.ts"], "consumes": [] },
    { "task": "T2", "produces": ["src/hooks/useBilling.ts"], "consumes": ["src/api/billing.ts"] }
  ],
  "waves": [
    { "wave": 1, "tasks": ["T1"], "parallel": true },
    { "wave": 2, "tasks": ["T2"], "parallel": true }
  ],
  "riskPoints": [
    { "type": "interface", "producer": "T1", "consumers": ["T2"], "mitigation": "Freeze BillingAPI type before T2" }
  ]
}
```

## v1 Simplified Mode

If graph tools are unavailable, derive waves from `plan.json -> tasks[].dependsOn` directly -- no producer/consumer mapping. Emit `wiring.json` with `dependencies: []` and only `waves` + `riskPoints`. Upgrade to full mapping when graph tools are present.

## Validation Rules

Wiring is invalid if any of:
- A `consumes` entry references a file not in any other task's `produces`
- A cycle exists in the dependency graph (task A -> B -> A)
- A task in Wave N has a `consumes` entry satisfied only by Wave N+1

Invalid wiring -> re-plan before execute. Do not proceed to Phase C with broken topology.
