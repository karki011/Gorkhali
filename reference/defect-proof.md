# Defect Proof Gate

Author: Subash Karki

This gate applies to every reported bug, defect, incident, flaky failure, or
regression before implementation work begins. Defect work is classified as
`investigation` first. A route may be selected for the eventual fix only after
the gate reaches `ready_for_fix`.

## Required artifact

Write `{SESSION_DIR}/defect-proof.json` as the evidence source of truth:

```json
{
  "_meta": {
    "version": 1,
    "writtenAt": "2026-07-24T18:00:00Z",
    "observedGitHead": "0123456789abcdef",
    "repoId": "project-0123456789",
    "taskId": "TASK-1",
    "baselineFingerprint": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  },
  "workKind": "investigation",
  "state": "waiting_for_evidence",
  "verdict": "unconfirmed_defect",
  "reproduction": {
    "status": "observed",
    "scenario": "Exact command or bounded scenario",
    "expected": "Expected current behavior",
    "actual": "Observed current failure",
    "observedAt": "2026-07-24T17:55:00Z",
    "evidenceRefs": ["logs/reproduction.txt"]
  },
  "rootCause": {
    "status": "hypothesis",
    "exactCodePath": ["src/entry.ts:handler", "src/core.ts:transform"],
    "claim": "One falsifiable causal claim",
    "evidenceRefs": ["logs/trace.txt"],
    "confirmedByUser": false,
    "confirmedAt": null
  },
  "focusedRegressionCheck": {
    "commandOrScenario": "npm test -- failing-case",
    "preFixStatus": "failed",
    "evidenceRefs": ["logs/reproduction.txt"]
  },
  "diagnosticGrant": null,
  "missingEvidence": ["User confirmation of the root-cause claim"],
  "nextObservation": "Present the traced claim and evidence for confirmation"
}
```

`reproduction.status` is `observed` or `not_observed`.
`rootCause.status` is `hypothesis` or `confirmed`.
The only valid gate-state/verdict combinations are:

| State | Verdict | Meaning |
|---|---|---|
| `ready_for_fix` | `confirmed_defect` | The current failure was reproduced, its exact path and causal evidence were recorded, and the user confirmed the root cause. Mutation may proceed within the approved fix scope. |
| `waiting_for_evidence` | `unconfirmed_defect` | Reproduction or root-cause confirmation is incomplete. Fix mutation is denied. |

`waiting_for_evidence` is a resumable hold: new evidence reruns this gate.
Never infer `ready_for_fix` from a ticket label, historical failure, plausible
hypothesis, test written after a proposed fix, or inability to reproduce.
Evidence references must be normalized paths to existing regular files inside
the active session directory. Absolute paths, traversal, missing files, and
references that resolve outside the session directory are rejected. The files
must contain captured output or another session artifact, not a summary that
merely repeats the claim. "Current" means observed against the recorded
baseline before implementation mutation; a relevant baseline change invalidates
the proof and returns it to `waiting_for_evidence`.

## DiagnosticGrant

While the state is `waiting_for_evidence`, Apex may record a
`diagnosticGrant` containing an explicit objective, allowed actions, allowed
paths, expiry condition, and cleanup requirement. The grant is evidence-only:

```json
{
  "diagnosticGrant": {
    "grantedBy": "user",
    "grantedAt": "2026-07-24T17:45:00Z",
    "expiresAt": "2026-07-24T19:45:00Z",
    "revokedAt": null,
    "objective": "Observe the failing request boundary",
    "allowedActions": ["add temporary structured logging"],
    "allowedPaths": ["src/request.ts"],
    "baselineFingerprint": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "cleanupRequired": true,
    "instrumentation": [
      {
        "action": "add temporary structured logging",
        "path": "src/request.ts",
        "evidenceRefs": ["logs/instrumentation.txt"]
      }
    ],
    "cleanupStatus": "pending",
    "cleanedAt": null,
    "cleanupEvidenceRefs": [],
    "cleanupApprovedBy": null,
    "cleanupApprovedAt": null
  }
}
```

- read-only inspection and commands are allowed;
- narrowly scoped reversible instrumentation is allowed only on listed paths;
- instrumentation may observe the failure but must not correct, mask, or change
  product behavior;
- no refactor, dependency change, data migration, feature work, or proposed fix
  is allowed;
- instrumentation changes must be identified and removed or separately
  approved before `ready_for_fix`.

The grant is valid only while its timestamps are valid, `revokedAt` is null,
and every instrumentation action/path is within `allowedActions` and
`allowedPaths`. `cleanupStatus` is `not_required`, `pending`, `cleaned`, or
`approved_in_scope`. Hound may set `cleaned` only with cleanup evidence and may
set `approved_in_scope` only with `cleanupApprovedBy` and
`cleanupApprovedAt` from explicit user approval.

A DiagnosticGrant never changes the verdict and never authorizes Blade
implementation. If the grant does not produce sufficient evidence, preserve
`waiting_for_evidence` / `unconfirmed_defect`, record the missing evidence and
next observation needed, then stop.

## Mutation gate

Before activating the Blade marker or dispatching any implementation scope,
read `defect-proof.json`. For `workKind: "investigation"`, mutation is allowed
only when all of these are true:

1. `reproduction.status` is `observed` with expected, actual, timestamp, and at
   least one evidence reference.
2. `rootCause.status` is `confirmed` with an exact code path, a falsifiable
   claim, causal evidence, and `confirmedByUser: true`.
3. A focused regression check records `preFixStatus: "failed"` and at least one
   pre-fix evidence reference.
4. `state` is `ready_for_fix` and `verdict` is `confirmed_defect`.
5. Any DiagnosticGrant has `cleanupStatus: "not_required" | "cleaned"` with
   supporting evidence, or `cleanupStatus: "approved_in_scope"` with explicit
   user approval.

Missing, malformed, contradictory, or stale proof fails closed to
`waiting_for_evidence` / `unconfirmed_defect`.

## Independent verification records

Every implementation scope, including non-defect work and a one-file direct
fix, requires its own
`{SESSION_DIR}/scope-verifications/{task-id}.json`. The verifier must be
read-only and different from the implementing Blade. A minimum record is:

```json
{
  "taskId": "t1",
  "implementer": "blade-pagination",
  "verifier": "ward-pagination",
  "status": "passed",
  "checkedPaths": ["src/hooks/usePagination.ts"],
  "checks": [
    {
      "kind": "acceptance",
      "commandOrScenario": "npm test -- pagination",
      "evidenceRefs": ["logs/t1-ward.txt"]
    }
  ]
}
```

`status` is `passed`, `failed`, or `not_observed`. For confirmed defects, the
checks must also:

1. rerun the recorded reproduction and show that the observed failure no longer
   occurs;
2. run the focused regression check plus repository-required checks;
3. inspect the scope against the confirmed root cause and approved paths;
4. report `passed`, `failed`, or `not_observed` evidence without converting
   missing evidence into a pass.

Parallel scopes each receive their own independent result. A later aggregate
suite does not replace a missing per-scope result. A task cannot be marked
`done` until its record exists and has `status: "passed"`.
