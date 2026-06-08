---
name: phantom:brainstorm
description: "Diverge/converge brainstorm — generates approaches, human picks direction. Use when scope is ambiguous, domain is new, or multiple valid approaches exist. Also use when user says 'brainstorm', 'explore options', 'what are our approaches', or 'let's think about this'."
argument-hint: "<requirement or problem statement> [--council|--simple]"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS"]
user-invocable: false
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md`

# /phantom:brainstorm "$ARGUMENTS"

Diverge → Converge. Output: locked decision in `decisions.json` feeding downstream planning.
READ `reference/brainstorm.md` for full protocol (question rules, anti-patterns, learnings check).

<brainstorm_context>

## Context Setup

1. Resolve TICKET from $ARGUMENTS, session state, or `git branch --show-current`
2. Ensure `{TEAM_DIR}/sessions/{TICKET}/` exists
3. Load `learnings/INDEX.md` — scan for `[failed]` and `[validated:5+]` entries
4. Load `context.json` if present. If absent, write minimal version from $ARGUMENTS.

</brainstorm_context>

<diverge_protocol>

## Phase 1: Diverge

### Parallel Research Agents

Spawn 2-3 research agents **in parallel** to gather context before forming approaches. All agents run concurrently and return 500-token structured summaries. Each is a `subagent_type: "blade"` with a read-only ROLE FOCUS: scout directive. (effort = session `high`; model per `reference/agents.md` → Model Routing)

**Agent 1: Codebase Explorer** (always spawned)
- subagent_type: `blade` (ROLE FOCUS: scout, read-only), mode: `bypassPermissions`, run_in_background: `true`
- Scans existing patterns, conventions, and related code in the project
- Checks how similar problems were solved before
- Returns: relevant files, patterns found, reusable abstractions

**Agent 2: Constraint Mapper** (always spawned)
- subagent_type: `blade` (ROLE FOCUS: scout, read-only), mode: `bypassPermissions`, run_in_background: `true`
- Checks `learnings/INDEX.md` for `[failed]` and `[validated:5+]` entries matching the problem space
- Checks package constraints, API contracts, type boundaries
- Returns: hard constraints, soft constraints, learnings that apply

**Agent 3: Domain Researcher** (optional — only for unfamiliar domains)
- subagent_type: `blade` (ROLE FOCUS: scout, read-only), mode: `bypassPermissions`, run_in_background: `true`
- Explores documentation, type definitions, external API patterns
- Only spawn when the problem touches a domain the codebase hasn't solved before
- Returns: relevant API patterns, type signatures, integration examples

### Synthesis

After all agents return, the coordinator synthesizes their summaries into context for approach generation.

**Questions** — per `reference/brainstorm.md` SS Question-Asking Rules: only WHAT-questions (scope-changing), batch 2-5, max 2 rounds.

**Approaches** — produce 2-3 genuinely distinct strategies via ONE path:
- **Council** (route is FULL, architecture choice, high uncertainty, or `--council`): independent
  lens-agents generate candidates → Apex anonymizes + peer-ranks them → a Chairman synthesizes the
  recommended approach + ranked alternatives. Full steps: `reference/brainstorm.md` → **Council Mode**.
  The Chairman's output becomes the approaches presented at Convergence.
- **Simple** (default for clearer brainstorms, or `--simple`): the coordinator drafts them directly —
  no extra spawns.

Either path: `[failed]` = exclude, `[validated:5+]` = recommend, and each approach uses:

```
Approach {N}: {name}
Summary:    {2-3 sentences}
Pros/Cons:  {bullets}
Complexity: {S | M | L}
Risk:       {low | medium | high — with reason}
```

</diverge_protocol>

<converge_protocol>

## Phase 2: Converge

1. Present approaches with clear recommendation (cite specifics, not "it's simpler")
2. **HUMAN GATE** — pick number/name, "none" (1 more round, max 2 total), or refinement
3. Record and lock decision → hand off to PLAN phase

</converge_protocol>

<artifact_schema>

## Artifacts

**Write `{TEAM_DIR}/sessions/{TICKET}/decisions.json`:** `_meta` header + `decisions[]` array with id, decision, status "locked", rationale, alternatives. When Council Mode ran, also record `councilUsed: true`, `peerRankings` (aggregate rank per anonymized approach), and `chairmanRationale` — so the deliberation is auditable and feeds learnings.

**Update `intent.json`** (merge): `approach`, `scopeDecisions`, `exploredAlternatives`.

Full schemas in `reference/schemas/`.

</artifact_schema>
