# Phantom — Shadows Context

> Loaded by commands that spawn agents. Always load `_shared.md` first.

---

## Model Routing

**Apex routes the model; effort is uniform.** Apex pins only effort (`high`) in frontmatter. Default = task-appropriate tier, NOT "inherit the session model" — the session model is the ceiling, not the floor. Mechanical/tool-driver roles (sweep/lens/plan-checker) pin `sonnet`; ward pins `haiku`; gaze/archer pin `opus` (review tier); sage pins `opus` (top-tier advisory). Apex picks the `model:` param per spawn — cheap (sonnet) for mechanical & well-scoped work, escalate to opus (hard ceiling for implementers - Fable 5 never implements) for complex, ambiguous, or cross-cutting work. There is no per-spawn effort param.

| Agent | default model | role |
|-------|---------------|------|
| apex | inherits session model (effort high) | orchestrator |
| blade | sonnet for well-scoped/contract-backed work; opus hard ceiling - never fable | implementation |
| hound | opus (pinned - forensic root-cause tracing) | forensics |
| sage | opus (pinned — top-tier advisory; override via config `models.sage`) | deepest advisory |
| gaze | opus (pinned — review tier) | quality gate |
| archer | opus (pinned — review tier) | cross-file review |
| rival | sonnet (frontmatter pin) | adversarial plan review |
| plan-checker | sonnet (frontmatter pin) · escalate for large/complex plans | plan validation |
| ward | haiku (frontmatter pin) | build/test QA |
| lens | sonnet | visual QA |
| sweep | sonnet | simplification |

- `opus` resolves to `claude-opus-5` (Phantom's top tier); `sonnet` to `claude-sonnet-5`; `haiku` to `claude-haiku-4-5`. Frontmatter and Agent-tool spawn params accept bare aliases only — never dated or full model IDs.
- **Default = task-appropriate tier.** Sonnet is the floor for mechanical and well-scoped, contract-backed subtasks; escalate to opus (hard ceiling for implementers - Fable 5 never implements) for complex, ambiguous, or cross-cutting work, or where decomposition left a subtask fuzzy. "Good tasking earns Sonnet" — fix weak scoping by re-decomposing, not by throwing the expensive model at it.
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
