# AI-native SDLC — Gorkhali mapping (2026)

Source: [The AI-Native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook) (Louis Claxton, 21 Aug 2026).
This document is the decision record for S1. It is not a restatement of the playbook.

## Thesis we accept

Code is no longer the bottleneck. The human-speed stages around it are: plan,
design, review, deploy. Controls that assume a person wrote every line do not
scale. The fix is a loop, not a linear committee, with **one committed artifact
per stage** that the next stage can read, and **human judgment at the gates**.

Gorkhali already had the gates (approve, authorize, `ship-pr`), the parallel
build, Inspector as the in-session feedback loop, Auditor as a separate
context, hooks as deterministic controls, and evals as a config regression
suite. What it lacked was the **product-repo audit chain** the playbook treats
as the SDLC itself.

## Artifact chain

| Playbook | Gorkhali before | S1 |
|---|---|---|
| `intent.md` in the product repo | `intent.json` under `GORKHALI_DATA` only | `intake` writes `.gorkhali/sdlc/<task>/intent.md`; `start` ingests it |
| `spec.md` (requirements + design + flagged policy) | `brainstorm.json` + HTML review page | `spec.md` rendered from brainstorm when that artifact exists |
| `plan.md` | `plan.json` + HTML review page | `plan.md` rendered at wrap; JSON stays canonical |
| Diff + tests | Engineer + Inspector | unchanged |
| PR + review findings | wrap + Auditor + greploop | plus mechanical plan-compliance |
| Production → new `intent.md` | `loop` over Jira Ready tickets | same intake template; no auto-deploy (D2) |

JSON remains canonical for every lifecycle gate. Markdown is a projection, same
class as review HTML: never parsed back into state except `parse-intent`, which
only supplies `start --intent` text.

## Keep

- **D2.** Agent work stops at a ready-for-review PR. The playbook's production
  gate is a hook plus a named release manager. Gorkhali already refuses merge
  and production credentials. Do not close that loop until evals measure
  verification quality (D2's stated revisit condition).
- **Hooks over skills for must-hold rules.** The playbook says a skill is
  advisory and a hook is the deterministic layer. That is already Gorkhali's
  doctrine (`engineer-model-gate`, `routing-gate`, `greploop-gate`).
- **Verifier ≠ feedback loop.** Inspector runs through the work; Auditor is a
  fresh context after verification. Matches the playbook's verifier-subagent
  vs session feedback-loop split.
- **Plan before mutate.** `gorkhali-state.mjs` already refuses execute without
  authorization; plan-only mode is permanent for that session.
- **Learnings + evolve.** The playbook's `CLAUDE.md` twice-rule is the same
  idea in a repo instruction file. We keep learnings as the working store and
  promote repeats into `AGENTS.md` with approval.

## Adopt (this PR)

1. **Committed dual-readable chain** in the product repo (`.gorkhali/sdlc/`).
2. **`intake`** so non-engineers and incident triggers can write Plan-stage
   intent without starting implementation.
3. **Plan-compliance** as a mechanical Auditor input: `aligned` / `drift` /
   `wrong` / `n/a`. `n/a` is not a pass. `wrong` is blocking.
4. **`templates/REVIEW.md`** so a consumer repo can tune passes, severity, and
   nit caps the way the playbook's `REVIEW.md` does. We already read that file.
5. **Twice-rule on Corrections** in `learn`: a second `[failed]` with the same
   signature proposes promotion, it does not silently duplicate.

## Reject or defer

| Play | Why |
|---|---|
| Auto-merge / agent past the production gate | D2. Unmeasured verification quality. |
| `bands.yaml` control-band watcher invoking a headless agent | Needs a metrics store, managed settings, and a rehearsed rollback. `loop` already dispatches from a tracker. Build bands after T1 (tracker abstraction) and a real production hook, not as prose. |
| Scheduled Mythos/Claude Security scans | Host-specific product. Recurring scans can become an `intake` source later. |
| Claude Tag on-call | Same: channel identity is a host product. The artifact that re-enters Gorkhali is still `intent.md`. |
| Evals in CI on every `CLAUDE.md` / skill / hook change | We already gate on `npm test` + `validate:skill`. Live agent evals spend tokens and are `--gate` against a baseline, not a free CI job (E1, K3 still pending). |
| Making `spec.md` a fifth source of truth | `plan.json` is canonical. Spec is an optional projection of brainstorm. |
| Committing session JSON | Wrap still forbids it. Private paths, cost, and fingerprints do not belong in the product repo. |

## How to measure it (playbook indicators, Gorkhali sources)

| Stage | Leading | Where we already have the timestamp |
|---|---|---|
| Plan | Time to a committed `intent.md` | git history on `.gorkhali/sdlc/` |
| Design | Intent commit → spec/plan commit | same + session `plan.json` `updated_at` |
| Build | First-pass merge from one implementation | `scripts/baseline-report.js` |
| Test | First-pass CI for agent-written changes | CI + wrap verification artifact |
| Deploy | Time to first review | PR metadata; greploop |
| Maintain | Band/ticket → new intent | not instrumented until bands exist |

Do not invent DORA numbers we do not collect.

## Policy skills

The playbook's `.claude/skills/secure-api-review` pattern is the right split:
workflow adapters (`start`, `wrap`, `intake`) are not policy. Consumer repos
should add policy skills next to the code they constrain, with a hook or CI
check behind any rule that must always hold. Gorkhali will not ship a fake
universal security skill that pretends to be every org's standard.
