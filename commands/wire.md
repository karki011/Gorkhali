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
2. **BLOCK** if `plan.json` does not exist — must plan first
3. Load `plan.json` — extract `tasks[]` with file targets and `dependsOn`
4. Skip if task count <= 2 with no shared files (per `reference/wiring.md`)

</wire_context>

<analysis_protocol>

## Phase 1: Dependency Analysis

For each task: determine **produces** (files/exports created) and **consumes** (files from other tasks).
Build edges: A produces X, B consumes X → B depends on A.

Validate with graph tools (`phantom_graph_context`, `query_graph`) if available. v1 fallback: derive from `tasks[].dependsOn` directly.

</analysis_protocol>

<topology_protocol>

## Phase 2: Topology Generation

**Wave assignment** — topological sort per `reference/wiring.md`:
- Wave 1: no plan-internal dependencies. Wave N: all consumes satisfied by waves < N.
- Same wave = independent = parallel.

**Validation:** missing produces → ERROR. Circular dep → ERROR (re-plan). Cross-wave violation → ERROR.

**Risk detection:** `merge` (2+ producers → 1 consumer), `interface` (1 producer → 3+ consumers), `cycle` (circular → block).

</topology_protocol>

<artifact_schema>

## Output

**Write `state/sessions/{TICKET}/wiring.json`:** `_meta` + `dependencies[]` (task/produces/consumes) + `waves[]` + `riskPoints[]` + `integrationPoints[]` + `parallelGroups[]`.

Full schema in `reference/wiring.md`.

Present topology summary. On FULL route: **HUMAN GATE** — approve wiring before execution.

</artifact_schema>
