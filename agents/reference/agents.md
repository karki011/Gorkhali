# Agents Reference

Detailed routing tables, spawn decision logic, and dispatch protocols for Apex.

## Agent Roster (Full Details)

| Agent | Model | Role | When to spawn |
|---|---|---|---|
| **Blade** | opus | All implementation | Any code change — features, fixes, refactors, config |
| **Ward** | opus | Tests + verification | After Blade completes, during fix loops, pre-ship check |
| **Gaze** | opus | Quality gate | After Ward passes, gauntlet mode for high-risk changes |
| **Sage** | opus | Guidance oracle | When Blade is stuck (2+ approaches, ambiguous req) |
| **Lens** | opus | Visual verification | UI tasks after build passes, Figma extraction |
| **Hound** | opus | Forensic investigation | Unknown bugs, regressions, post-deploy issues |
| **Archer** | opus | Cross-file review | Pre-PR review, cache coherence, regression detection |
| **Sweep** | opus | Code simplification | During gauntlet, cleanup passes |

## SOLO vs SHADOWS Routing

### Auto-SHADOWS Checklist (Core Discipline #10)

If ANY of these are true, route SHADOWS. No exceptions, no "borderline."

- [ ] 4+ files across 2+ packages
- [ ] API changes + test changes in same task
- [ ] Security-sensitive (auth, secrets, RBAC, input validation)
- [ ] Schema/migration + application code
- [ ] Cross-layer (frontend + backend in same task)
- [ ] Performance-critical path changes

**All boxes unchecked = SOLO.** Blade can escalate to Apex and pivot to SHADOWS if overwhelmed.

## Task Tier Classification

For each task in the plan, Apex assigns a model tier:

| Task Profile | Tier | Model |
|---|---|---|
| Mechanical edit (rename, import, typo, format) | Haiku | `haiku` |
| Single-file, no logic (docs, config, copy, simple prop) | Haiku | `haiku` |
| Standard implementation (feature, hook, multi-file, tests) | Sonnet | `sonnet` |
| Architecture-sensitive, security, cross-cutting | Opus | `opus` |

Include tier in plan output: `Task 1: [sonnet] Implement UserProfile component`

## Visual Fix Dispatch (Autonomous)

When Lens reports visual issues during automated verification:

1. Parse fix packets from Lens output
2. Group by affected file (one Blade per file, max)
3. For each fix packet group:
   - Spawn Blade (UI Engineering focus) with:
     - Fix packets as structured input
     - Instruction: "Fix visual issues only. Do not change behavior or logic."
     - Scoped to affected files (no wandering)
   - After Blade completes, re-run Ward (verify code still passes)
4. After all visual fixes, re-spawn Lens for re-inspection
5. Max 3 visual fix loops — escalate to user if unresolved

## Failure Triage Table

When Ward reports failures, Apex classifies and assigns scoped repairs:

| Class | Description | Assign to |
|---|---|---|
| **build** | Compilation, import, barrel export | Blade |
| **type** | TypeScript errors, shape mismatch | Blade (React Architecture focus) |
| **test** | Failing or missing tests | Ward |
| **ui** | Component logic, prop handling, state bugs | Blade (UI Engineering focus) |
| **visual** | Layout, spacing, color, responsive, a11y | Blade (UI Engineering) — fix packet from Lens |
| **integration** | Cross-file wiring failure | Blade |

Create a fix packet with: error output, affected files, root cause hypothesis, and scope boundary. Assign to appropriate agent. **Fix-loop ceiling owned by `hooks/loop-controller.js`** (canonical: `reference/temperature-review.md`) — escalate to user when the controller says stop and no operator override applies. (This is the code/test fix loop; the VISUAL fix loop above is separate, ceiling 3.)

## GOAP Precondition/Effect Modeling

For SHADOWS tasks, declare preconditions and effects per task. Catches ordering bugs before execution. SOLO tasks skip this.

Full GOAP format, validation rules, and subtask decomposition protocol: see `reference/planning.md`.

## Subtask Decomposition

Decompose before spawning: SHADOWS always, SOLO 2+ files, skip single-file simple changes. Use `templates/decomposition-templates.md`. Each subtask = single concern with evidence requirement.
