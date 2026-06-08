# Phantom — Shadows Context

> Loaded by commands that spawn agents. Always load `_shared.md` first.

---

## Model Routing

**Apex routes the model; effort is uniform.** Only Apex pins its model + effort (`opus` / `high`) in frontmatter. Every other agent leaves `model` + `effort` UNSET, so they inherit the model Apex passes at spawn (default Opus) and the session effort (`high`). There is no per-spawn effort param — model is the only lever Apex tunes per task.

| Agent | default model | role |
|-------|---------------|------|
| apex | opus (pinned, effort high) | orchestrator |
| blade | opus · sonnet for small, well-scoped subtasks | implementation |
| hound | opus | forensics |
| sage | opus | deepest advisory |
| gaze | opus | quality gate |
| archer | opus | cross-file review |
| rival | opus | adversarial plan review |
| plan-checker | opus · sonnet for simple plans | plan validation |
| ward | sonnet | build/test QA |
| lens | sonnet | visual QA |
| sweep | sonnet | simplification |

- `opus` resolves to `claude-opus-4-8` (1M context); `sonnet` to `claude-sonnet-4-6`.
- **Default Opus.** Use `model: "sonnet"` only for small, single-concern subtasks with a tight contract and no open design decisions. "Good tasking earns Sonnet."
- `haiku` is reserved ONLY for trivial mechanical single-file edits (rename, import, typo, config) with no cross-file deps.
- Effort is uniform `high` (session-inherited); never set effort at spawn. Check MODEL_OVERRIDE at session start.

Full rule: `reference/agents.md` → Model Routing. Agent registry, spawning rules, SOLO/SHADOWS routing, role focus directives, worktree isolation also there.

---

## Lean Context Loading

Agents load ONLY what they need — Apex holds the full picture.

| Codename | Gets | Does NOT Get |
|----------|------|-------------|
| **Apex** | All shared tiers + all learnings + decisions.ndjson (last 50) | — |
| **Blade** | Persona + ROLE FOCUS + contract + CLAUDE.md + domain learnings + Anti-Repetition Block | _shared-shadows, _shared-contracts |
| **Ward** | Persona + locked contracts + `learnings/testing.md` + `_shared-repo-detection.md` | discipline tiers |
| **Gaze** | Persona + full diff + `coding-principles.md` | discipline/planning tiers |
| **Sage** | Decision context passed by Blade only | Everything — never loads files |
| **Lens** | Persona + Figma specs (extraction) or route list (verification) | Full shared context |

---

## Handoff Pipeline

Blade → Ward → Gaze → Apex (only failures route back). See `reference/agents.md` for details.
