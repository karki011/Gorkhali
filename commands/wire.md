---
name: phantom:wire
description: "Map dependency topology from approved plan — wave assignments, integration points, risk detection. Use after plan approval on FULL route or optionally on PLAN route (>5 files). Also use when user says 'wire it', 'show dependencies', 'what order', or 'map the topology'."
argument-hint: "[TICKET]"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS"]
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md`

# /phantom:wire "$ARGUMENTS"

Dependency topology from plan.json. Output: `wiring.json` with waves, risk points, parallel groups.
READ `reference/wiring.md` for full protocol (dependency mapping, wave rules, validation, v1 fallback).

<wire_context>

## Prerequisites

1. Resolve TICKET from $ARGUMENTS, session state, or `git branch --show-current`
2. **BLOCK** if `state/sessions/{TICKET}/plan.json` does not exist — must run planning first
3. Load `plan.json` — extract `tasks[]` with file targets and `dependsOn` fields
4. Skip wiring if task count <= 2 with no shared files (per `reference/wiring.md`)

</wire_context>

<analysis_protocol>

## Phase 1: Dependency Analysis

For each task in `plan.json → tasks[]`, determine:
- **produces**: files, exports, or API shapes this task creates or owns
- **consumes**: files or exports from OTHER tasks required to exist first

Build dependency edges: if task A produces X and task B consumes X → B depends on A.

**Graph validation** — use `phantom_graph_context` or `query_graph` (imports_of/callers_of) to validate declared deps against actual imports. Flag discrepancies.

**v1 fallback**: if graph tools unavailable, derive waves from `tasks[].dependsOn` directly. Emit `dependencies: []` with only `waves` + `riskPoints`.

</analysis_protocol>

<topology_protocol>

## Phase 2: Topology Generation

**Wave assignment** — topological sort:
- Wave 1: tasks with empty `consumes` (no plan-internal dependencies)
- Wave N: tasks whose `consumes` are all satisfied by waves < N
- Tasks in same wave = independent, can run in parallel

**Validation** (per `reference/wiring.md` SS Validation Rules):
- `consumes` entry references file not in any task's `produces` → ERROR
- Circular dependency detected → ERROR, plan is invalid, re-plan before continuing
- Task in wave N consumes from wave N+1 → ERROR

**Risk detection** (per `reference/wiring.md` SS Integration Risk Points):
- `merge`: 2+ producers feed one consumer → integration test after consumer's wave
- `interface`: producer consumed by 3+ tasks → lock exported shape before spawn
- `cycle`: circular dependency → plan invalid, block execution

</topology_protocol>

<artifact_schema>

## Output

**Write `state/sessions/{TICKET}/wiring.json`:**

```json
{
  "_meta": {
    "writtenAt": "{ISO 8601}",
    "gitHead": "{HEAD sha}",
    "gitBranch": "{branch}",
    "phase": "wire",
    "skill": "phantom:wire",
    "version": 1
  },
  "dependencies": [
    { "task": "T1", "produces": ["src/api/foo.ts"], "consumes": [] },
    { "task": "T2", "produces": ["src/hooks/useFoo.ts"], "consumes": ["src/api/foo.ts"] }
  ],
  "waves": [
    { "wave": 1, "tasks": ["T1"], "parallel": true },
    { "wave": 2, "tasks": ["T2"], "parallel": true }
  ],
  "riskPoints": [
    { "type": "merge|interface|cycle", "producer": "T1", "consumers": ["T2"], "mitigation": "{action}" }
  ],
  "integrationPoints": [
    { "file": "src/api/foo.ts", "touchedBy": ["T1", "T2"] }
  ],
  "parallelGroups": [["T1"], ["T2"]]
}
```

Present topology summary to human. On FULL route: **HUMAN GATE** — user approves wiring before execution.

</artifact_schema>
