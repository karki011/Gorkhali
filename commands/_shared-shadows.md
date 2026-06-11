# Phantom — Shadows Context

> Loaded by commands that spawn agents. Always load `_shared.md` first.

---

## Model Routing

**Apex routes the model; effort is uniform.** Apex pins only effort (`high`) in frontmatter — `model` is UNSET everywhere except gaze/archer (`opus`, review tier) and sage (`fable`, top-tier advisory). Unset model = inherit the session model (Fable 5 recommended). Apex tunes the `model:` param per spawn only to downshift. There is no per-spawn effort param.

| Agent | default model | role |
|-------|---------------|------|
| apex | inherits session model (effort high) | orchestrator |
| blade | inherits session model · sonnet for small, well-scoped subtasks | implementation |
| hound | inherits session model | forensics |
| sage | fable (pinned — top-tier advisory; override via config `models.sage`) | deepest advisory |
| gaze | opus (pinned — review tier) | quality gate |
| archer | opus (pinned — review tier) | cross-file review |
| rival | inherits session model | adversarial plan review |
| plan-checker | inherits session model · sonnet for simple plans | plan validation |
| ward | sonnet | build/test QA |
| lens | sonnet | visual QA |
| sweep | sonnet | simplification |

- `fable` resolves to `claude-fable-5` (Mythos tier above Opus, 1M context, 128K output, $10/$50 per MTok); `opus` to `claude-opus-4-8`; `sonnet` to `claude-sonnet-4-6`; `haiku` to `claude-haiku-4-5`. Frontmatter and Agent-tool spawn params accept bare aliases only — never dated or full model IDs.
- **Default = inherit.** Leave `model` unset so the agent runs the session model. Use `model: "sonnet"` only for small, single-concern subtasks with a tight contract and no open design decisions. "Good tasking earns Sonnet."
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
