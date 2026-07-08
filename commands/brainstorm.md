---
name: phantom:brainstorm
description: "Diverge/converge brainstorm — generates approaches, human picks direction. Use when scope is ambiguous, domain is new, or multiple valid approaches exist. Also use when user says 'brainstorm', 'explore options', 'what are our approaches', or 'let's think about this'."
argument-hint: "<requirement or problem statement> [--council|--simple]"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
# Generic triggers ('explore options', 'let's think about this') are intentionally muted by user-invocable:false — brainstorm is dispatched by phantom:start, not auto-selected from NL. Do not flip this flag without re-checking auto-dispatch safety (it would over-fire on casual "let's think" prose).
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

**Questions** — per `reference/brainstorm.md` SS Question-Asking Rules: only WHAT-questions (scope-changing), batch 2-5, max 2 rounds, skip anything the scout agents already answered, stop once every open question has a confirmed answer/accepted default or answers degrade to "up to you".

**Approaches** — produce 2-3 genuinely distinct strategies via ONE path. Both paths generate ALL
approaches before any evaluation touches any of them (anti-anchoring), and each states a concrete
lens (`whyLens`) — never a vague "be creative". Full rules: `reference/brainstorm.md` → **Exploration
Protocol**.
- **Council** (route is FULL, architecture choice, high uncertainty, or `--council`): independent
  lens-agents generate candidates in parallel → Apex anonymizes + peer-ranks them → a Chairman synthesizes the
  recommended approach + ranked alternatives. Full steps: `reference/brainstorm.md` → **Council Mode**.
  The Chairman's output becomes the approaches presented at Convergence.
- **Simple** (default for clearer brainstorms, or `--simple`): the coordinator drafts all approaches in
  one pass, then steps back and evaluates — no extra spawns.

Either path: `[failed]` = exclude, `[validated:5+]` = recommend as `recommendedDefault`, and each
approach fills the full spine in `reference/schemas/brainstorm.md` (`id`, `name`, `thesis`, `whyLens`,
`effort`, `risk`, `reversibility`, `whatBreaks`, `whenToPick`, optional `mutualExclusivity`/`visualType`).

**Rival Pass** — before Convergence, one lightweight adversarial pass challenges the approaches
themselves (borrows `agents/rival.md`'s stance, scoped to the spine not a full plan). It tightens the
cards; it does not block or re-loop. Full protocol: `reference/brainstorm.md` → **Rival Pass**.

</diverge_protocol>

<converge_protocol>

## Phase 2: Converge

1. **Write `brainstorm.json`** (schema: `reference/schemas/brainstorm.md`) — full `approaches[]` spine
   plus mandatory `recommendedDefault{id,reason}`. **Render:** `node scripts/render-brainstorm.js
   {TEAM_DIR}/sessions/{TICKET}/brainstorm.json` → `brainstorm.html`. Lead with the recommendation
   (cite specifics, not "it's simpler"), then the full side-by-side. The rendered HTML MUST be surfaced
   via `Skill(skill="phantom:annotate", args="<brainstorm.html>")` before GATE 1, with a fallback chain
   — never block the gate — of `phantom:annotate` unavailable, then plain `open` of the HTML, then the
   artifact cannot be rendered or opened, then chat-only approval with the reason stated; every step
   still ends at GATE 1.
2. **HUMAN GATE** — pick number/name, "none" (1 more round, max 2 total), or refinement
3. Record and lock decision → hand off to PLAN phase

</converge_protocol>

<artifact_schema>

## Artifacts

**Write `{TEAM_DIR}/sessions/{TICKET}/brainstorm.json`** during Diverge, before Convergence's human
gate: full `approaches[]` spine + mandatory `recommendedDefault{id,reason}`. Schema:
`reference/schemas/brainstorm.md`. Rendered to `brainstorm.html` by `scripts/render-brainstorm.js` for
the annotate gate.

**Write `{TEAM_DIR}/sessions/{TICKET}/decisions.json`:** `_meta` header + `decisions[]` array with id, decision, status "locked", rationale, alternatives. When Council Mode ran, also record `councilUsed: true`, `peerRankings` (aggregate rank per anonymized approach), and `chairmanRationale` — so the deliberation is auditable and feeds learnings.

**Update `intent.json`** (merge): `approach`, `scopeDecisions`, `exploredAlternatives`.

Full schemas in `reference/schemas/`.

</artifact_schema>
