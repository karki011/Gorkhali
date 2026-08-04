# Verification contract

Verification is evidence, not ceremony. Discover repository-native commands
from instructions, manifests, build files, and continuous-integration config.

## Required order

1. Inspect the diff and changed-file list for scope and accidental changes.
2. Run the narrowest relevant tests and static checks.
3. Run broader repository-required checks in proportion to risk.
4. Run the Sweep simplification pass on every changed file.
5. If Sweep changes anything, repeat affected tests and checks.
6. Run Gaze as an independent review. Add Archer for structural changes and Lens
   for user-visible rendering.
7. Resolve blocking findings and repeat the affected portion of this sequence.
8. Record commands, exit status, meaningful output, skipped checks, and reasons.

Apply the automatic topology policy to verification passes. Prefer a native
independent worker for Gaze when available so implementation intent does not
bias the review; otherwise run Gaze as a fresh labeled sequential pass. Ward,
Sweep, Lens, and Archer may use native workers when their scopes are bounded,
but their required order and evidence contracts never change. Missing
delegation never removes a verification gate.

## Sweep complexity gate

Sweep is a complexity review after correctness checks, not a replacement for
them. Review each material change in order: deletion, existing repository
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
the smallest valid remediation. Blocking findings include correctness defects,
security regressions, data loss, broken imports or references, violated explicit
requirements, and missing required tests.

The final status is:

- `done` when every required criterion and check passed;
- `done-with-caveat` when requested work is complete but a non-blocking check or
  optional capability remains unavailable;
- `blocked` when correctness, authorization, or required verification remains.
