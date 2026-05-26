---
name: team:brainstorm
description: "Diverge/converge brainstorm — generates approaches, human picks direction. Use when scope is ambiguous, domain is new, or multiple valid approaches exist. Also use when user says 'brainstorm', 'explore options', 'what are our approaches', or 'let's think about this'."
argument-hint: "<requirement or problem statement>"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS"]
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md`

# /team:brainstorm "$ARGUMENTS"

Diverge → Converge. Output: locked decision in `decisions.json` feeding downstream planning.
READ `reference/brainstorm.md` for full protocol (question rules, anti-patterns, learnings check).

<brainstorm_context>

## Context Setup

1. Resolve TICKET from $ARGUMENTS, session state, or `git branch --show-current`
2. Ensure `state/sessions/{TICKET}/` exists
3. Load `learnings/INDEX.md` — scan for `[failed]` and `[validated:5+]` entries matching this domain
4. Load `context.json` if present (from `team:start`). If absent, write minimal version from $ARGUMENTS.

</brainstorm_context>

<diverge_protocol>

## Phase 1: Diverge

**Explore** — spawn Explorer agent (model: opus, mode: bypassPermissions):
- Research codebase for patterns, prior art, constraints (use graph tools)
- Check learnings for past approaches (validated = recommend, failed = exclude)
- Output: 500-token summary

**Question Filter** — per `reference/brainstorm.md` SS Question-Asking Rules:
- Only WHAT-questions (scope-changing). Auto-resolve HOW silently. Batch 2-5 with defaults. Max 2 rounds.

**Generate Approaches** — 2-3 genuinely distinct strategies:

```
Approach {N}: {name}
Summary:    {2-3 sentences}
Pros:       {bullet list}
Cons:       {bullet list}
Complexity: {S | M | L}
Risk:       {low | medium | high — with reason}
```

Constraints: never >3 (paralysis), never <2 (false certainty). `[failed]` = exclude. `[validated:5+]` = recommend.

</diverge_protocol>

<converge_protocol>

## Phase 2: Converge

1. Present all approaches with a **clear recommendation**
2. Explain WHY the recommended approach is best — cite specifics (codebase patterns, learnings, risk profile), not just "it's simpler"
3. **HUMAN GATE** — ask human to pick. Accept: number, name, "none" (triggers 1 more exploration round, max 2 total), or refinement request
4. On decision → record and lock (see artifact schema below)
5. Hand off: return control to caller (start.md routes to PLAN next). Planner reads `decisions.json` + `intent.json` — does NOT re-brainstorm.

</converge_protocol>

<artifact_schema>

## Artifacts

**Write `state/sessions/{TICKET}/decisions.json`:**

```json
{
  "_meta": {
    "writtenAt": "{ISO 8601}",
    "gitHead": "{HEAD sha}",
    "gitBranch": "{branch}",
    "phase": "brainstorm",
    "skill": "team:brainstorm",
    "version": 1
  },
  "decisions": [
    {
      "id": "D-1",
      "decision": "{chosen approach name}: {one-line summary}",
      "status": "locked",
      "rationale": "{why this was chosen over alternatives}",
      "alternatives": [
        { "name": "{rejected approach}", "reason": "{why rejected}" }
      ]
    }
  ]
}
```

**Update `state/sessions/{TICKET}/intent.json`** (merge, don't overwrite):
- `approach`: chosen approach name
- `scopeDecisions`: key constraints and choices made
- `exploredAlternatives`: what was ruled out and why

</artifact_schema>
