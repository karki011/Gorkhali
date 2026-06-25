# Agent Registry

## Personas

| Agent | Default model | Role | File |
|-------|---------------|------|------|
| Apex | inherits session model (effort: high) | Orchestrator — plans, decomposes, coordinates, routes models | agents/apex.md |
| Blade | sonnet for well-scoped/contract-backed work · escalate to session model / opus for complex, ambiguous, cross-cutting work | Implementation — code, tests, config | agents/blade.md |
| Ward | sonnet (frontmatter pin) | QA — runs verify commands, checks contracts | agents/ward.md |
| Gaze | opus (pinned — review tier) | Quality gate — power level, scoring | agents/gaze.md |
| Sage | fable (pinned — top tier) | Advisory — <100 words, no tools, no user output | agents/sage.md |
| Lens | sonnet (frontmatter pin) | Visual — browser verification, screenshots | agents/lens.md |
| Archer | opus (pinned — review tier) | Cross-file — cache coherence, regression, dead code | agents/archer.md |
| Rival | inherits session model | Plan challenger — 5 categories, verdict | agents/rival.md |
| Plan Checker | sonnet (frontmatter pin) · escalate for large/complex plans | Pre-execution validator — learnings, blast radius, coverage, scope, deps | agents/plan-checker.md |
| Hound | inherits session model | Forensic investigator — root-cause tracing, HTML report | agents/hound.md |
| Sweep | sonnet (frontmatter pin) | Code clarity — simplify changed files post-verify | agents/sweep.md |

## Model Routing (Apex decides at spawn)

**Default = task-appropriate tier, not "inherit everything."** The session model (often Opus) is the
ceiling, not the floor. Route the cheapest model that fits the work, and escalate only when the task
proves it needs more. Apex picks the model per spawn via the Agent tool `model:` param.
**Effort is uniform `high`**, inherited from the session — there is NO per-spawn effort param, so
never try to set effort at spawn time. Tune speed/cost via **model**, not effort.

Apex has OPTIONS, not a rigid lookup. Use these criteria per role:

- **Mechanical / tool-driver roles** (Sweep, Ward, Lens, Plan Checker, and search/Explore-style
  spawns) → default **CHEAP (sonnet)**. These pin `sonnet` in frontmatter. Escalate to the session
  model ONLY if the task proves non-trivial (e.g. a sweep spanning many files with subtle semantics,
  a plan check over a large/ambiguous plan, verification requiring real debugging).
- **Implementation** (Blade) → default **sonnet** for well-scoped, contract-backed subtasks
  (clear inputs/outputs, named file owner, no open design decisions). Escalate to the session model
  or `opus` for complex, ambiguous, or cross-cutting work, or where decomposition left the subtask
  fuzzy. "Good tasking earns Sonnet" — fix weak scoping by re-decomposing, not by throwing the
  expensive model at it.
- **Reasoning / review roles** (Gaze, Archer, Hound, Rival, Sage) → **UNCHANGED**. Gaze and Archer
  pin `opus` in frontmatter (review tier — independent benchmarks (CodeRabbit review bench, 2026-06)
  show Fable 5 is no better than Opus 4.8 at code review at 2x the price). Sage pins `fable` (top-tier
  advisory — Fable 5 by default, falling back to `opus` when Fable 5 is unavailable). Hound and Rival
  inherit the session model regardless of task size. Do NOT downshift these.
- **Orchestration** (Apex) → the session model.

When decomposing, keep tagging each subtask `mechanical | standard | complex`. CHEAP (sonnet) is the
**floor** for mechanical work and for standard work that has a tight contract:
- mechanical → sonnet (escalate only if it turns out non-trivial)
- standard with a tight contract → sonnet
- standard but fuzzy, or complex / ambiguous / cross-cutting → session model (or `opus`)

**Precedence (highest wins):** explicit spawn `model:` param > config override (`config.yaml`
`models:` block, if present) > agent frontmatter pin > this rubric default. Frontmatter pins are
honored, and any user-supplied config override is honored on top of them — the rubric only fills the
gap when nothing more specific is set.
Use bare aliases (fable/opus/sonnet/haiku); never pin dated or prior-generation model IDs.

## Spawning Rules

- All agents: `mode: "bypassPermissions"`
- Model: Apex picks per spawn per **Model Routing** above (default = task-appropriate tier; sonnet floor for mechanical and well-scoped work, escalate for complex/ambiguous/cross-cutting). Honor `MODEL_OVERRIDE` from session context if set. Use bare aliases (fable/opus/sonnet/haiku); never pin dated or prior-generation model IDs.
- Parallel agents: use `isolation: "worktree"` to prevent file conflicts
- Sage: max 3 calls per Blade. No tools. No user output.
- Background: use `run_in_background: true` for non-blocking agents

## SOLO vs SHADOWS Routing

| Condition | Route |
|-----------|-------|
| 1-3 files, single concern | SOLO |
| 4+ files, multi-concern, cross-package | SHADOWS |
| API + tests, security, schema + app | SHADOWS |
| Auto-SHADOWS trigger (Iron Law 10) fires | SHADOWS |

## Route & Model Guidance

Effort is uniform `high` for every agent (session-inherited; Apex pinned). Tune speed via **model**,
not effort.

- Simple fix (1-2 files): SOLO, Blade on sonnet, ~5 min
- Feature (3-5 files): SOLO or SHADOWS, Blade on sonnet for tightly-scoped subtasks, escalate fuzzy/cross-cutting subtasks to the session model, ~15 min
- Complex feature (5+ files): SHADOWS, Blade on the session model (or `opus`) for the hard subtasks + Sage (top tier), ~30 min
