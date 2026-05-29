# Phantom — Shadows Context

> Loaded by commands that spawn agents. Always load `_shared.md` first.

---

## Model Routing

**Single model, differentiated by effort.** All agents are registered Claude Code subagents whose `model` + `effort` come from their definition frontmatter (`agents/*.md`). Every agent runs `opus` (resolves to `claude-opus-4-8`); the **`effort`** parameter — not the model — is the lever that trades thoroughness vs token efficiency.

| Agent | model | effort | role |
|-------|-------|--------|------|
| apex | opus | xhigh | orchestrator |
| blade | opus | xhigh | implementation |
| hound | opus | xhigh | forensics |
| sage | opus | max | deepest advisory |
| gaze | opus | high | quality gate |
| archer | opus | high | cross-file review |
| rival | opus | high | adversarial plan review |
| plan-checker | opus | high | plan validation |
| ward | opus | medium | build/test QA |
| lens | opus | medium | visual QA |
| sweep | opus | low | simplification |

- `opus` resolves to `claude-opus-4-8` (1M context, adaptive thinking — no manual thinking budgets).
- Effort governs all tokens including tool calls: `xhigh` for implementation/orchestration, `high` for review, `medium`/`low` for QA/cleanup, `max` for deepest advisory.
- `haiku` is reserved ONLY for trivial mechanical single-file edits (rename, import, typo, config) with no cross-file deps.
- Effort is the lever, not model. Check MODEL_OVERRIDE at session start.

Agent registry, spawning rules, SOLO/SHADOWS routing, role focus directives, worktree isolation: see `reference/agents.md`.

---

## Lean Context Loading

Agents load ONLY what they need — Apex holds the full picture.

| Codename | Gets | Does NOT Get |
|----------|------|-------------|
| **Apex** | All shared tiers + all learnings + decisions.ndjson (last 50) | — |
| **Blade** | Persona + ROLE FOCUS + contract + CLAUDE.md + domain learnings + Anti-Repetition Block | _shared-shadows, _shared-contracts, _shared-board |
| **Ward** | Persona + locked contracts + `learnings/testing.md` + `_shared-repo-detection.md` | Board, discipline tiers |
| **Gaze** | Persona + full diff + `coding-principles.md` | Board tier |
| **Sage** | Decision context passed by Blade only | Everything — never loads files |
| **Lens** | Persona + Figma specs (extraction) or route list (verification) | Full shared context |

---

## Handoff Pipeline

Blade → Ward → Gaze → Apex (only failures route back). See `reference/agents.md` for details.
