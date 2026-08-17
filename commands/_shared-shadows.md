# Phantom — Shadows Context

> Loaded by commands that spawn agents. Always load `_shared.md` first.

---

## Model Routing

Canonical rubric - the delegate-everything-on-sonnet rule, precedence, the uniform-`high` effort
rule, and the visible scope-check line - is `reference/agents.md` → **Model Routing**. Deliberately
not restated here. This file carries only the agent → default-model lookup that goes with it:

| Agent | default model | role |
|-------|---------------|------|
| apex | inherits session model (effort high) | orchestrator |
| blade | sonnet (frontmatter pin) | implementation |
| hound | sonnet (frontmatter pin) | forensics |
| sage | sonnet (frontmatter pin; override via config `models.sage`) | deepest advisory |
| gaze | sonnet (frontmatter pin) | quality gate |
| archer | sonnet (frontmatter pin) | cross-file review |
| rival | sonnet (frontmatter pin) | the one plan critic: adversarial review + plan validation |
| ward | sonnet (frontmatter pin) | build/test QA |
| lens | sonnet (frontmatter pin; explicit user opt-in only) | advisory visual inspection |
| sweep | sonnet (frontmatter pin) | simplification |

- Every delegated role is `sonnet` on this host - the seniority differences in the table above are
  about how tightly Apex briefs each role, not about what each one costs. Opus is orchestration-only.
- `sonnet` resolves to `claude-sonnet-5`; `opus` to `claude-opus-5`; `haiku` to `claude-haiku-4-5`. Frontmatter and Agent-tool spawn params accept bare aliases only — never dated or full model IDs.
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
