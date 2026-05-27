# Agent Registry

## Personas

| Agent | Model | Role | File |
|-------|-------|------|------|
| Apex | opus | Orchestrator — plans, decomposes, coordinates | agents/apex.md |
| Blade | sonnet | Implementation — code, tests, config | agents/blade.md |
| Ward | sonnet | QA — runs verify commands, checks contracts | agents/ward.md |
| Gaze | sonnet | Quality gate — power level, scoring | agents/gaze.md |
| Sage | opus | Advisory — <100 words, no tools, no user output | agents/sage.md |
| Lens | sonnet | Visual — browser verification, screenshots | agents/lens.md |
| Archer | opus | Cross-file — cache coherence, regression, dead code | agents/archer.md |
| Rival | opus | Plan challenger — 5 categories, verdict | agents/rival.md |
| Plan Checker | sonnet | Pre-execution validator — learnings, blast radius, coverage, scope, deps | agents/plan-checker.md |

## Spawning Rules

- All agents: `mode: "bypassPermissions"`
- Model override: check `MODEL_OVERRIDE` from session context. NEVER use 4.7 variants.
- Parallel agents: use `isolation: "worktree"` to prevent file conflicts
- Sage: max 3 calls per Blade. No tools. No user output.
- Background: use `run_in_background: true` for non-blocking agents

## SOLO vs CREW Routing

| Condition | Route |
|-----------|-------|
| 1-3 files, single concern | SOLO |
| 4+ files, multi-concern, cross-package | CREW |
| API + tests, security, schema + app | CREW |
| Auto-CREW trigger (Iron Law 10) fires | CREW |

## Effort Guidance

- Simple fix (1-2 files): SOLO, sonnet, ~5 min
- Feature (3-5 files): SOLO or CREW, sonnet, ~15 min
- Complex feature (5+ files): CREW, sonnet sparks + opus sage, ~30 min
