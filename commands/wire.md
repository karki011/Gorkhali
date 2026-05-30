---
name: phantom:wire
description: "Map dependency topology from approved plan — wave assignments, integration points, risk detection. Use after plan approval on FULL route or optionally on PLAN route (>5 files). Also use when user says 'wire it', 'show dependencies', 'what order', or 'map the topology'."
argument-hint: "[TICKET]"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS"]
user-invocable: false
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md`

# /phantom:wire "$ARGUMENTS"

Dependency topology from plan.json. The main LLM acts as **coordinator** — it validates prerequisites, spawns a Blade agent for analysis, then reviews and presents the topology.

<wire_context>

## Step 1: Prerequisites (Coordinator)

1. Resolve TICKET from $ARGUMENTS, session state, or `git branch --show-current`
2. **BLOCK** if `plan.json` does not exist — must plan first
3. Read `plan.json` — extract `tasks[]` with file targets and `dependsOn`
4. Skip if task count <= 2 with no shared files (per `reference/wiring.md`)
5. Serialize plan contents for the agent prompt

</wire_context>

<agent_spawn>

## Step 2: Spawn Dependency Analyst

Use the Agent tool to spawn a dedicated analyst:

```
Agent call:
  description: "Wire topology for {TICKET}: {task_count} tasks"
  subagent_type: "blade"
  mode: "bypassPermissions"
  run_in_background: false
  # model + effort come from the blade agent definition
  prompt: |
    You are a BLADE with ROLE FOCUS: dependency analyst.
    Your job: analyze task dependencies and generate a wiring topology.

    ## Plan Contents
    {serialized plan.json tasks — id, description, file targets, dependsOn}

    ## Protocol
    READ reference/wiring.md for the full wiring protocol.

    ### Phase 1: Dependency Analysis
    For each task:
    - Determine PRODUCES (files/exports created)
    - Determine CONSUMES (files/exports from other tasks)
    - Build edges: A produces X, B consumes X -> B depends on A

    Validate with graph tools (phantom_graph_context, query_graph) if available.
    v1 fallback: derive from tasks[].dependsOn directly.

    ### Phase 2: Topology Generation
    Wave assignment via topological sort:
    - Wave 1: no plan-internal dependencies
    - Wave N: all consumes satisfied by waves < N
    - Same wave = independent = parallel

    Validation checks:
    - Missing produces -> ERROR
    - Circular dep -> ERROR (re-plan needed)
    - Cross-wave violation -> ERROR

    Risk detection:
    - "merge": 2+ producers -> 1 consumer
    - "interface": 1 producer -> 3+ consumers
    - "cycle": circular -> block

    ## Output
    Write {TEAM_DIR}/sessions/{TICKET}/wiring.json with this schema:
    - _meta: timestamp, taskCount, waveCount
    - dependencies[]: task, produces[], consumes[]
    - waves[]: waveNumber, tasks[], canParallelize
    - riskPoints[]: type, description, severity, tasks
    - integrationPoints[]: producer, consumers[], sharedFile
    - parallelGroups[]: waveNumber, groups[]

    Full schema in reference/wiring.md.

    Return a topology summary:
    - Wave count and task distribution per wave
    - Risk points found (if any)
    - Integration points requiring coordination
    - Recommended execution order
```

</agent_spawn>

<review_and_present>

## Step 3: Review and Present (Coordinator)

After the Blade agent completes:
1. Read `{TEAM_DIR}/sessions/{TICKET}/wiring.json` to verify it was written correctly
2. Validate: no ERROR-level risk points that block execution
3. Present topology summary to the user:
   - Wave breakdown (which tasks in which wave)
   - Risk points highlighted
   - Integration points needing attention
4. On FULL route: **HUMAN GATE** — user must approve wiring before execution proceeds
5. On PLAN route: present as informational, auto-continue

If validation finds errors (circular deps, missing produces):
- Report the specific error to the user
- Recommend re-running `/phantom:start` to re-plan with corrected dependencies

</review_and_present>

<constraints>

## Rules

- The coordinator does NOT run dependency analysis — it delegates entirely to the Blade agent.
- Agent spawn MUST use `subagent_type: "blade"` (ROLE FOCUS: dependency analyst), `mode: "bypassPermissions"` (model + effort from the agent definition).
- BLOCK if plan.json missing. No exceptions.
- HUMAN GATE on FULL route is mandatory. Do not skip.
- If task count <= 2 with no shared files, skip wiring entirely (inform user why).

</constraints>
