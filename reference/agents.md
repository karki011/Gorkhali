# Agent Registry

## Personas

| Agent | Default model | Role | File |
|-------|---------------|------|------|
| Apex | inherits session model (effort: high) | Orchestrator — plans, decomposes, coordinates, routes models | agents/apex.md |
| Blade | inherits session model · sonnet when subtask is small + well-scoped | Implementation — code, tests, config | agents/blade.md |
| Ward | sonnet | QA — runs verify commands, checks contracts | agents/ward.md |
| Gaze | opus (pinned — review tier) | Quality gate — power level, scoring | agents/gaze.md |
| Sage | fable (pinned — top tier) | Advisory — <100 words, no tools, no user output | agents/sage.md |
| Lens | sonnet | Visual — browser verification, screenshots | agents/lens.md |
| Archer | opus (pinned — review tier) | Cross-file — cache coherence, regression, dead code | agents/archer.md |
| Rival | inherits session model | Plan challenger — 5 categories, verdict | agents/rival.md |
| Plan Checker | inherits session model · sonnet for simple plans | Pre-execution validator — learnings, blast radius, coverage, scope, deps | agents/plan-checker.md |
| Hound | inherits session model | Forensic investigator — root-cause tracing, HTML report | agents/hound.md |
| Sweep | sonnet | Code clarity — simplify changed files post-verify | agents/sweep.md |

## Model Routing (Apex decides at spawn)

Model is NOT pinned in agent frontmatter, with three deliberate exceptions: Gaze and Archer pin
`opus` (review tier — independent benchmarks (CodeRabbit review bench, 2026-06) show Fable 5 is no
better than Opus 4.8 at code review at 2x the price), and Sage pins `fable` (top-tier advisory —
Fable 5 by default, falling back to `opus` when Fable 5 is unavailable).
Apex selects the model per spawn via the Agent tool `model:` param only to downshift; if omitted,
the agent inherits the session model (or its agent definition's pinned model for gaze/archer/sage).
**Effort is uniform `high`**, inherited from the session — there is NO per-spawn effort param, so
never try to set effort at spawn time.

**Default = inherit.** Drop a spawn to `model: "sonnet"` ONLY when the subtask is:
- single-file or single-concern, AND
- backed by an explicit contract (clear inputs/outputs, named file owner), AND
- free of open design decisions or ambiguity.

"Good tasking earns Sonnet" — if decomposition left a subtask fuzzy, keep the session model rather
than paper over weak scoping with a cheaper model. Reasoning-heavy roles (Rival, Hound) stay on the
session model regardless of size. Mechanical tool-drivers (Ward, Lens, Sweep) default to Sonnet.

When decomposing, tag each subtask `mechanical | standard | complex`:
- mechanical, or standard with a tight contract → eligible for Sonnet
- complex / ambiguous / cross-cutting → session model

## Spawning Rules

- All agents: `mode: "bypassPermissions"`
- Model: Apex picks per spawn per **Model Routing** above (default = inherit the session model, Sonnet for small/well-scoped). Honor `MODEL_OVERRIDE` from session context if set. Use bare aliases (fable/opus/sonnet/haiku); never pin dated or prior-generation model IDs.
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
- Feature (3-5 files): SOLO or SHADOWS, Blade on the session model (sonnet for any small, tightly-scoped subtask), ~15 min
- Complex feature (5+ files): SHADOWS, Blade on the session model + Sage (top tier), ~30 min
