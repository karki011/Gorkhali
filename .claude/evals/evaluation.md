# Phantom Evaluation Contract

Author: Subash Karki

Phantom evaluates recorded evidence against an explicit rubric. Models may
produce findings and recommendations; the typed workflow contract owns
acceptance, retry eligibility, budgets, terminal states, and freshness.

The public `eval` action is a direct Agent Skill at `skills/eval/SKILL.md`. It
applies `skills/phantom/SKILL.md` and does not create a separate evaluation
runtime. It runs only when selected by the workflow and never authorizes a
lifecycle effect.

## Two Evaluation Surfaces

Phantom has two related but distinct evaluation surfaces:

1. **Workflow evaluator nodes** assess a specific artifact or integrated result
   inside a compiled workflow. Their machine-readable result validates against
   `skills/phantom/schemas/evaluation-result.schema.json`.
2. **The behavioral harness** in `scripts/run-evals.js` runs the trigger, route,
   and convention cases declared in `evals/evals.json`. It materializes isolated
   fixtures and uses independently reviewed route truth from
   `evals/route-truth.json`.

Neither surface infers success from prose, a missing artifact, or remembered
criteria.

## When a Workflow Evaluator Runs

The compiled graph adds an `evaluate-optimize` node only when route, risk, or a
measurable acceptance rubric justifies independent evaluation. Deterministic
checks run first. A reviewer is not added merely to repeat checks that already
passed.

Before evaluation, the node declares:

- the artifact or behavior under evaluation;
- the evaluator role and explicit rubric;
- the current worktree fingerprint;
- required evidence and acceptance policy;
- maximum iterations, cost, duration, and repeated-failure limit; and
- the allowed repair scope, when refinement is possible.

## Evidence Rules

These rules are load-bearing:

1. Every finding or rubric judgment cites a recorded artifact, journal event,
   or captured command result and states the fact drawn from it.
2. Missing, stale, conflicting, or unreadable evidence yields `blocked` or
   `missing_evidence`; it never becomes a pass or a guessed middle score.
3. The evaluator records every evidence-backed supported severity. The complete
   finding record stays separate from the deterministic acceptance decision.
4. The result binds the current worktree fingerprint. A later content change
   makes the result stale.
5. Historical model output is recorded data. Replay never regenerates it and
   never calls a model to recreate evaluation evidence.

A human-facing rubric may use numeric or qualitative scores, but each score
must cite evidence. Scores are explanatory output; they do not replace the
typed verdict or authorize another iteration.

## Typed Result

A workflow evaluator returns contract version 1 with exactly these fields:

| Field | Meaning |
|---|---|
| `schema_version` | Must be `1` |
| `node_id` | Matching active evaluator node |
| `verdict` | `pass`, `fail`, or `blocked` |
| `worktree_fingerprint` | Exact current `sha256:` fingerprint |
| `evaluator.role` | Role declared by the node |
| `evidence[]` | Named `passed` or `failed` observations |
| `failure_class` | Stable failure category, or `null` |
| `feedback[]` | Evidence-backed bounded feedback |
| `retryable` | Evaluator recommendation; policy still decides |
| `cost_units` | Non-negative measured cost |
| `duration_ms` | Non-negative measured duration |

Unknown fields, wrong roles, stale fingerprints, and malformed evidence are
rejected before the workflow state changes.

## Bounded Evaluation

The kernel stops immediately on acceptance. Otherwise it terminates in one of
these explicit states:

```text
accepted
rejected
budget_exhausted
iteration_limit
stuck_same_failure
missing_evidence
human_decision_required
```

An evaluator's suggestion that work could improve does not authorize another
iteration. Policy permits a scoped retry only when the result is retryable,
evidence is current, budgets remain, the failure class is not stuck, and no
human decision is required.

## Behavioral Harness Contract

The repository harness evaluates published skill behavior, not worker personas.
Each case has an ID, skill, realistic prompt, kind, expected check, and optional
declarative fixture:

- **trigger** cases check whether the expected direct skill activates;
- **route** cases compare the typed route with digest-bound independent truth;
- **convention** cases use deterministic evidence or a bounded semantic judge.

Cases run in isolated materialized repositories with separate mutable state and
judge context. Unsafe fixture paths or environment overrides, stale route
truth, missing cases, and judge failures fail closed. See `evals/README.md` for
the fixture and execution contract.

## Acceptance and Reporting

A valid evaluation report includes the typed verdict, current fingerprint,
complete evidence, complete findings, acceptance decision, measured cost and
duration, and the terminal reason. If required evidence cannot be read, report
the failure and stop; do not invent a rubric, result, or pass.
