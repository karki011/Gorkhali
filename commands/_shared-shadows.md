# Phantom — Shadows Context

> Loaded by commands that spawn agents. Always load `_shared.md` first.

---

## Model Routing

All agents: `"opus"`, `"sonnet"`, or `"haiku"` only. **NEVER 4.7 variants.** Check MODEL_OVERRIDE at session start.

- **Bypass:** Apex edits inline (rename, import, typo). No agent spawned.
- **Haiku:** Single-file, routine, no cross-file deps. `model: "haiku"`.
- **Sonnet:** Standard Blade work (default).
- **Opus:** Apex, Gaze, Sage, planning, security-sensitive.

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
