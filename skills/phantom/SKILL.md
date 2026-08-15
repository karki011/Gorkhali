---
name: phantom
description: Plan, execute, verify, independently review, pause, resume, and safely ship software-development work. Use for features, fixes, refactors, investigations, planning, implementation, review, verification, recovery, or progress checks.
---

# Phantom

Phantom is a thin progressive router over a deterministic lifecycle engine.
Load this file on activation, then load only the phase reference needed for the
current action.

## Authority and invariants

`scripts/phantom-state.mjs` is the sole lifecycle authority. Its persisted
state and gate results outrank conversational memory and procedural prose. Use
compact output normally and add `--json` only for automation or diagnosis.

Preserve these invariants:

1. Read repository instructions and relevant learnings before proposing or
   changing work. Preserve unrelated user changes.
2. Inspect durable status before creating state. Resume a matching session and
   continue from its first incomplete, still-current action.
3. Record explicit implementation authorization before execution. Shipping is
   a separate authorization and is never implied by implementation approval.
4. Bind verification and review evidence to the current worktree fingerprint.
   Any later content change makes earlier quality evidence stale.
5. Run deterministic verification before independent review. A review cannot
   replace verification or review its own implementation as independent.
6. Missing, stale, failed, or blocked required evidence prevents shipping and
   completion. Never turn a missing capability into a pass.
7. For defects, reproduce the failure, trace the exact causal path, and obtain
   user confirmation before mutation. Inconclusive proof pauses safely.
8. Trigger specialists only from observed risk. RPSL is optional and never
   manufactures or waives ordinary evidence.
9. Pause with the exact next safe action when context, authority, or an
   external dependency prevents progress. Resume from artifacts, not recall.

## Start or resume

Resolve this skill directory from this file; do not assume an installation
path. From the target workspace, inspect state first:

```text
node <skill-directory>/scripts/phantom-state.mjs status --workspace <path>
```

Then inspect instructions, corrections, current behavior, dependency impact,
existing repository patterns, available capabilities, and the minimum
sufficient solution. Prefer omission, reuse, standard or native behavior, and
installed dependencies before custom machinery.

Choose the route from uncertainty, dependency, and risk evidence:

| Route | Use when | Required decision gates |
|---|---|---|
| `direct` | One clear low-risk outcome and no material design choice | None; implementation authorization is still required |
| `plan` | The outcome is known but execution needs an explicit plan | Approved plan |
| `brainstorm` | Direction is materially ambiguous | Approved direction, then approved plan |
| `full` | Direction, architecture, and cross-scope wiring are material | Approved direction, plan, and wiring |

Create state only after the route is known:

```text
node <skill-directory>/scripts/phantom-state.mjs start --workspace <path> --task <id> --intent <text> --route <route>
```

`--mode to-plan` is permanently plan-only for that session. It may create and
review plans, but it never permits execute, verify, or ship.

## Load one phase

- [Planning](references/planning.md): start, investigate, choose direction,
  create decision artifacts, and collect approvals.
- [Execution](references/execution.md): authorize implementation, delegate
  bounded work, mutate, and preserve resumable progress.
- [Verification and review](references/verification.md): verify deterministically,
  simplify, run triggered specialists, and obtain independent review.
- [Shipping](references/shipping.md): authorize and perform an external
  pull-request lifecycle after all current evidence passes.

Do not load later phases speculatively. The phase reference explains agent
behavior; the state helper enforces whether the transition is legal.

## Capability degradation

Use native repository, shell, search, delegation, visual, tracker, and review
capabilities when exposed. If a capability is unavailable, use the smallest
labeled fallback that preserves the same artifact and gate. Missing required
evidence blocks only the dependent action; it does not erase completed work.

## Pause, resume, and finish

```text
node <skill-directory>/scripts/phantom-state.mjs pause --workspace <path> --reason <text>
node <skill-directory>/scripts/phantom-state.mjs resume --workspace <path>
node <skill-directory>/scripts/phantom-state.mjs complete --workspace <path>
```

Finish with `done`, `done-with-caveat`, or `blocked`, naming the evidence that
supports the status. External actions require their own authorization even
when local completion is valid.
