---
name: phantom:wire
description: "Map dependency topology from approved plan — wave assignments, integration points, risk detection. Use after plan approval on FULL route or optionally on PLAN route (>5 files). Also use when user says 'wire it', 'show dependencies', 'what order', or 'map the topology'."
argument-hint: "[TICKET]"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS"]
user-invocable: false
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md`

# /phantom:wire "$ARGUMENTS"

Dependency topology from plan.json. Main LLM = **coordinator**: validate prereqs → spawn Blade for analysis → review + present.

<wire_context>

## Step 1: Prerequisites (Coordinator)

1. Resolve TICKET from $ARGUMENTS, session state, or `git branch --show-current`
2. **BLOCK** if `plan.json` missing — must plan first
3. Read `plan.json` — extract `tasks[]` (file targets, `dependsOn`)
4. Skip if task count <= 2 with no shared files (per `reference/wiring.md`)
5. Serialize plan contents for agent prompt

</wire_context>

<agent_spawn>

## Step 2: Spawn Dependency Analyst

Agent tool — `subagent_type: "blade"`, `mode: "bypassPermissions"`, `run_in_background: false` (effort = session `high`; model per `reference/agents.md` → Model Routing):

```
description: "Wire topology for {TICKET}: {task_count} tasks"
prompt: |
  You are a BLADE with ROLE FOCUS: dependency analyst.
  Job: analyze task dependencies, generate wiring topology.

  ## Plan Contents
  {serialized plan.json tasks — id, description, file targets, dependsOn}

  ## Protocol — READ reference/wiring.md for full protocol.

  ### Phase 1: Dependency Analysis
  Per task: PRODUCES (files/exports created), CONSUMES (files/exports from other tasks).
  Edges: A produces X, B consumes X -> B depends on A.
  Validate with graph tools (phantom_graph_context, query_graph) if available.
  v1 fallback: derive from tasks[].dependsOn directly.

  ### Phase 2: Topology Generation
  Wave assignment via topological sort:
  - Wave 1: no plan-internal deps
  - Wave N: all consumes satisfied by waves < N
  - Same wave = independent = parallel
  Validation: missing produces -> ERROR; circular dep -> ERROR (re-plan); cross-wave violation -> ERROR.
  Risk detection: "merge" (2+ producers -> 1 consumer); "interface" (1 producer -> 3+ consumers); "cycle" (circular -> block).

  ## Output
  Write {TEAM_DIR}/sessions/{TICKET}/wiring.json, schema:
  - _meta: timestamp, taskCount, waveCount
  - dependencies[]: task, produces[], consumes[]
  - waves[]: waveNumber, tasks[], canParallelize
  - riskPoints[]: type, description, severity, tasks
  - integrationPoints[]: producer, consumers[], sharedFile
  - parallelGroups[]: waveNumber, groups[]
  Full schema in reference/wiring.md.

  Return topology summary: wave count + task distribution per wave; risk points (if any); integration points needing coordination; recommended execution order.
```

</agent_spawn>

<review_and_present>

## Step 3: Review and Present (Coordinator)

After Blade completes:
1. Read `{TEAM_DIR}/sessions/{TICKET}/wiring.json` — verify written correctly
2. Validate: no ERROR-level risk points blocking execution
3. Present summary: wave breakdown (tasks per wave), risk points, integration points
4. FULL route: **HUMAN GATE** — user must approve wiring before execution
5. PLAN route: informational, auto-continue

If validation finds errors (circular deps, missing produces): report specific error → recommend re-running `/phantom:start` to re-plan with corrected deps.

</review_and_present>

<constraints>

## Rules

- Coordinator does NOT run analysis — delegates entirely to the Blade agent.
- Agent spawn MUST use `subagent_type: "blade"` (ROLE FOCUS: dependency analyst), `mode: "bypassPermissions"` (effort = session `high`; model per `reference/agents.md` → Model Routing).
- BLOCK if plan.json missing. No exceptions.
- HUMAN GATE on FULL route mandatory. Do not skip.
- Task count <= 2 with no shared files → skip wiring entirely (inform user why).

</constraints>
