# Team Skill — Crew Context

> Loaded by commands that spawn agents. Always load `_shared.md` first.

---

## Model Routing

All agents: `"opus"`, `"sonnet"`, or `"haiku"` only. **NEVER 4.7 variants.** Check MODEL_OVERRIDE at session start.

- **Bypass:** Cortex edits inline (rename, import, typo). No agent spawned.
- **Haiku:** Single-file, routine, no cross-file deps. `model: "haiku"`.
- **Sonnet:** Standard Spark work (default).
- **Opus:** Cortex, Prism, Oracle, planning, security-sensitive.

Agent registry, spawning rules, SOLO/CREW routing, role focus directives, worktree isolation: see `reference/agents.md`.

---

## Lean Context Loading

Agents load ONLY what they need — Cortex holds the full picture.

| Codename | Gets | Does NOT Get |
|----------|------|-------------|
| **Cortex** | All shared tiers + all learnings + decisions.ndjson (last 50) | — |
| **Spark** | Persona + ROLE FOCUS + contract + CLAUDE.md + domain learnings + Anti-Repetition Block | _shared-crew, _shared-contracts, _shared-board |
| **Sentinel** | Persona + locked contracts + `learnings/testing.md` + `_shared-repo-detection.md` | Board, discipline tiers |
| **Prism** | Persona + full diff + `coding-principles.md` | Board tier |
| **Oracle** | Decision context passed by Spark only | Everything — never loads files |
| **Lens** | Persona + Figma specs (extraction) or route list (verification) | Full shared context |

---

## Handoff Pipeline

Spark → Sentinel → Prism → Cortex (only failures route back). See `reference/agents.md` for details.
