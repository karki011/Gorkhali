# Gorkhali — Shadows Context

> Loaded by commands that spawn agents. Always load `_shared.md` first.

---

## Model Routing

Canonical rubric - the delegate-everything-on-sonnet rule, precedence, the uniform-`high` effort
rule, and the visible scope-check line - is `reference/agents.md` → **Model Routing**. Deliberately
not restated here. This file carries only the agent → default-model lookup that goes with it:

| Agent | default model | role |
|-------|---------------|------|
| chief | inherits session model (effort high) | orchestrator |
| engineer | sonnet (frontmatter pin) | implementation |
| detective | sonnet (frontmatter pin) | forensics |
| advisor | sonnet (frontmatter pin; override via config `models.advisor`) | deepest advisory |
| auditor | sonnet (frontmatter pin) | quality gate |
| justice | sonnet (frontmatter pin) | cross-file review |
| opposition | sonnet (frontmatter pin) | the one plan critic: adversarial review + plan validation |
| inspector | sonnet (frontmatter pin) | build/test QA |
| surveyor | sonnet (frontmatter pin; explicit user opt-in only) | advisory visual inspection |
| steward | sonnet (frontmatter pin) | simplification |

- Every delegated role is `sonnet` on this host - the seniority differences in the table above are
  about how tightly Chief briefs each role, not about what each one costs. One exception: `research`
  (`opus`) for planner/explore/scout spawns that read the codebase and author `plan.json` for
  Chief. Opus is otherwise orchestration-only.
- `sonnet` resolves to `claude-sonnet-5`; `opus` to `claude-opus-5`; `haiku` to `claude-haiku-4-5`. Frontmatter and Agent-tool spawn params accept bare aliases only — never dated or full model IDs.
- Check MODEL_OVERRIDE at session start.

Agent registry, spawning rules, SOLO/SHADOWS routing, role focus directives, and worktree isolation also live in `reference/agents.md`.

---

## Lean Context Loading

Agents load ONLY what they need — Chief holds the full picture.

| Codename | Gets | Does NOT Get |
|----------|------|-------------|
| **Chief** | All shared tiers + all learnings + decisions.ndjson (last 50) | — |
| **Engineer** | Persona + ROLE FOCUS + contract + CLAUDE.md + domain learnings + Anti-Repetition Block | _shared-shadows, _shared-contracts |
| **Inspector** | Persona + locked contracts + `learnings/testing.md` + `_shared-repo-detection.md` | discipline tiers |
| **Auditor** | Persona + full diff + `coding-principles.md` | discipline/planning tiers |
| **Advisor** | Decision context passed by Engineer only | Everything — never loads files |
| **Surveyor** | Explicit routes, expected behavior, worktree path/branch, and resolved URL when known | All shared context; loaded only after opt-in |

---

## Handoff Pipeline

Engineer → Inspector → Auditor → Chief (only failures route back). See `reference/agents.md` for details.
