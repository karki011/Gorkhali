# Verification contract

Verification is evidence, not ceremony. Discover repository-native commands
from instructions, manifests, build files, and continuous-integration config.

## Required evidence

The compiled workflow declares the checks, evaluator rubric, acceptance policy,
and limits for each node. It must require:

1. Inspect the diff and changed-file list for scope and accidental changes.
2. Run the narrowest relevant tests and static checks.
3. Run broader repository-required checks in proportion to risk.
4. Apply the complexity check once to every changed file. If it changes code,
   repeat only the affected correctness checks.
5. Run an independent evaluator only when route, risk, or measurable acceptance
   criteria require one. A fixed reviewer stack is not a quality signal.
6. Preserve the complete finding record, then apply the deterministic
   acceptance policy as a separate decision.
7. Record commands, exit status, meaningful output, skipped checks, and reasons.

Use the smallest sufficient execution topology. Deterministic checks and the
complexity check normally run in the active context. A bounded independent
evaluator may use native delegation when isolated context materially reduces
bias; do not create a delegate merely to repeat checks that already ran. When a
required evaluator cannot be delegated, run one fresh labeled pass without
changing its evidence contract.

## Complexity check

The complexity check follows correctness evidence and is not a replacement for
it. Review each material change in order: deletion, existing repository
behavior, the standard library, a native platform capability, an installed
dependency, one clear direct expression, then the smallest custom code. Stop at
the first option that still satisfies the approved contract.

Report either the edits made or an evidence-backed no-change result. Never use
line count as the quality gate, and never remove explicit requirements,
trust-boundary validation, data-loss prevention, security, accessibility,
required compatibility, or focused tests for non-trivial logic. Preserve all
risk-proportionate and repository-required verification.

## Evidence states

Use only these results:

- `passed`: the check ran successfully with captured evidence.
- `failed`: the check ran and did not meet its contract.
- `blocked`: the check could not run because a required capability, dependency,
  credential, environment, or authorization was missing.
- `not-applicable`: the check does not apply, with a reason.

Never translate `blocked` into `passed`. Optional visual capability absence is a
documented caveat for visual work.

## Quality findings

Report each finding with severity, file or component, evidence, user impact, and
the smallest valid remediation. Record every evidence-backed supported
severity; never suppress a finding merely because it is non-blocking. The
acceptance policy separately identifies blockers such as correctness defects,
security regressions, data loss, broken imports or references, violated explicit
requirements, and missing required tests.

## Bounded evaluation

An evaluator-optimizer node declares its rubric, maximum iterations, spend and
duration limits, failure classification, and worktree fingerprint before it
runs. It stops immediately on acceptance and otherwise terminates as
`rejected`, `budget_exhausted`, `iteration_limit`,
`stuck_same_failure`, `missing_evidence`, or
`human_decision_required`. An evaluator's general suggestion that a result
could improve never authorizes another iteration.

The final status is:

- `done` when every required criterion and check passed;
- `done-with-caveat` when requested work is complete but a non-blocking check or
  optional capability remains unavailable;
- `blocked` when correctness, authorization, or required verification remains.
