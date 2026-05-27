# Wiring Protocol

## Purpose

Wiring answers "how do these pieces connect?" — not generating ideas (brainstorm) nor ordering
tasks (plan). It maps the **dependency topology** of a solution: what each task produces, what
it consumes, and which tasks can run in parallel.

---

## When It Runs

FULL route only (multi-component, cross-cutting tasks). Sequence:

```
plan.json written → Rival PROCEED → [WIRING] → Phase C execute
```

Solo route: skip wiring. Task count ≤ 2 with no shared files: skip wiring.

---

## Dependency Mapping

For each task in `plan.json → tasks[]`, identify:

| Field | Question |
|-------|----------|
| `produces` | What files, exports, or API shapes does this task create or own? |
| `consumes` | What files or exports from OTHER tasks does this task require to exist first? |

Build edges: if task A `produces` X and task B `consumes` X → B depends on A.

Use `code-review-graph` (`query_graph`) or `phantom_graph_context` to validate declared
dependencies against actual import chains. Flag discrepancies.

---

## Wave Assignment

Topological sort of the dependency graph → group into parallel waves:

- **Wave 1:** tasks with empty `consumes` (no plan-internal dependencies)
- **Wave N:** tasks whose `consumes` are all satisfied by Wave N-1 outputs
- Tasks in the same wave are independent and can be spawned in parallel

---

## Integration Risk Points

Flag these for human review or extra verification:

| Risk type | Condition | Mitigation suggestion |
|-----------|-----------|-----------------------|
| `merge` | 2+ producers feed one consumer | Integration test after consumer's wave |
| `interface` | A producer is consumed by 3+ tasks | Lock the exported shape before spawn; use a contract file |
| `cycle` | Circular dependency detected | Plan is invalid — re-plan before continuing |

---

## Wiring Artifact

Write to `state/sessions/{TICKET}/wiring.json` before spawning agents:

```json
{
  "_meta": {
    "writtenAt": "2026-05-23T00:00:00Z",
    "gitHead": "abc1234",
    "gitBranch": "feat/eng-1234",
    "phase": "B",
    "skill": "phantom:start",
    "version": 1
  },
  "dependencies": [
    { "task": "T1", "produces": ["src/api/billing.ts"], "consumes": [] },
    { "task": "T2", "produces": ["src/hooks/useBilling.ts"], "consumes": ["src/api/billing.ts"] },
    { "task": "T3", "produces": ["src/components/BillingTable.tsx"], "consumes": ["src/hooks/useBilling.ts"] }
  ],
  "waves": [
    { "wave": 1, "tasks": ["T1"], "parallel": true },
    { "wave": 2, "tasks": ["T2"], "parallel": true },
    { "wave": 3, "tasks": ["T3"], "parallel": false }
  ],
  "riskPoints": [
    {
      "type": "interface",
      "producer": "T1",
      "consumers": ["T2"],
      "mitigation": "Define and freeze BillingAPI type in T1 before T2 starts"
    }
  ]
}
```

`_meta` fields follow the schema in `artifact-schemas.md`.

---

## v1 Simplified Mode

If graph tools are unavailable, derive waves from `plan.json → tasks[].dependsOn` directly —
no producer/consumer mapping required. Emit `wiring.json` with `dependencies: []` and only
`waves` + `riskPoints`. Upgrade to full mapping when graph tools are present.

---

## Validation Rules

Wiring is invalid if any of the following:

- A `consumes` entry references a file not in any other task's `produces`
- A cycle exists in the dependency graph (task A → B → A)
- A task in Wave N has a `consumes` entry satisfied only by Wave N+1

Invalid wiring → re-plan before execute. Do not proceed to Phase C with broken topology.
