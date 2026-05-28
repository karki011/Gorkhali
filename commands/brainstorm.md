---
name: phantom:brainstorm
description: "Diverge/converge brainstorm — generates approaches, human picks direction. Use when scope is ambiguous, domain is new, or multiple valid approaches exist. Also use when user says 'brainstorm', 'explore options', 'what are our approaches', or 'let's think about this'."
argument-hint: "<requirement or problem statement>"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS"]
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md`

# /phantom:brainstorm "$ARGUMENTS"

Diverge → Converge. Output: locked decision in `decisions.json` feeding downstream planning.
READ `reference/brainstorm.md` for full protocol (question rules, anti-patterns, learnings check).

<brainstorm_context>

## Context Setup

1. Resolve TICKET from $ARGUMENTS, session state, or `git branch --show-current`
2. Ensure `state/sessions/{TICKET}/` exists
3. Load `learnings/INDEX.md` — scan for `[failed]` and `[validated:5+]` entries
4. Load `context.json` if present. If absent, write minimal version from $ARGUMENTS.

</brainstorm_context>

<diverge_protocol>

## Phase 1: Diverge

**Explore** — spawn Explorer (model: opus, mode: bypassPermissions): research codebase, check learnings, output 500-token summary.

**Questions** — per `reference/brainstorm.md` SS Question-Asking Rules: only WHAT-questions (scope-changing), batch 2-5, max 2 rounds.

**Approaches** — 2-3 genuinely distinct strategies. `[failed]` = exclude. `[validated:5+]` = recommend.

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

**Write `state/sessions/{TICKET}/decisions.json`:** `_meta` header + `decisions[]` array with id, decision, status "locked", rationale, alternatives.

**Update `intent.json`** (merge): `approach`, `scopeDecisions`, `exploredAlternatives`.

Full schemas in `reference/schemas/`.

</artifact_schema>
