# Phantom — Shadows Context

> Loaded by commands that spawn agents. Always load `_shared.md` first.

---

## Model Routing

Canonical rubric - floors, the escalation ladder, precedence, the uniform-`high` effort rule, and the
visible scope-check line - is `reference/agents.md` → **Model Routing**. Deliberately not restated
here. This file carries only the agent → default-model lookup that goes with it:

| Agent | default model | role |
|-------|---------------|------|
| apex | inherits session model (effort high) | orchestrator |
| blade | sonnet for well-scoped/contract-backed work; opus hard ceiling - never fable | implementation |
| hound | opus (pinned - forensic root-cause tracing) | forensics |
| sage | opus (pinned — top-tier advisory; override via config `models.sage`) | deepest advisory |
| gaze | opus (pinned — review tier) | quality gate |
| archer | opus (pinned — review tier) | cross-file review |
| rival | sonnet (frontmatter pin) · escalate for large/complex plans | the one plan critic: adversarial review + plan validation |
| ward | haiku (frontmatter pin) | build/test QA |
| lens | sonnet (frontmatter pin; explicit user opt-in only) | advisory visual inspection |
| sweep | sonnet | simplification |

- `opus` resolves to `claude-opus-5` (Phantom's top tier); `sonnet` to `claude-sonnet-5`; `haiku` to `claude-haiku-4-5`. Frontmatter and Agent-tool spawn params accept bare aliases only — never dated or full model IDs.
- Check MODEL_OVERRIDE at session start.

Agent registry, spawning rules, SOLO/SHADOWS routing, role focus directives, and worktree isolation also live in `reference/agents.md`.

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
| **Lens** | Explicit routes, expected behavior, worktree path/branch, and resolved URL when known | All shared context; loaded only after opt-in |

---

## Handoff Pipeline

Blade → Ward → Gaze → Apex (only failures route back). See `reference/agents.md` for details.
