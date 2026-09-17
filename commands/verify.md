---
name: verify
description: Independently check and review the integrated result, with bounded repair and applicable human confirmation.
allowed-tools: ["Agent", "Read", "Write", "Bash", "Grep", "Glob"]
user-invocable: true
---

# Verify

Read `../references/lifecycle.md`. All Engineer work, version updates, and commits must be
integrated before final verification. A commit after verification makes evidence
stale, even if content is otherwise identical. The lead never implements a repair.

Verification runs once, on the final integrated commit, normally entered from
`wrap`. Running it after every task repeats the Inspector and Auditor for each
later amendment without adding assurance. Only a risky task that later tasks
depend on justifies an earlier Inspector, and never an earlier Auditor.

Every reviewer receives the exact absolute session directory containing plan.json,
integration checkout, and plugin library paths. GORKHALI_DATA is not the session directory.

1. For `userVisible:true`, present a concrete checklist with expected results
   before any agent runs. Wait for an explicit human pass; silence, screenshots
   alone, and agent opinion are not confirmation. A change request here is a plan
   amendment, not a verification failure, and costs no Inspector or Auditor run.
   Only after the pass call `human-confirmation`.
2. Spawn one economy Inspector on the integrated checkout. It discovers checks,
   captures fingerprints before/after, and calls `recordInspector` in
   `lib/verification.js`. Record its result through CLI `progress`.
3. Only after `requireInspector` accepts the current evidence, spawn one Auditor
   in an independent context. Use CLI `route`'s Auditor model, which combines integrated risk signals
   and current failure counters. Auditor calls `recordAuditor` with the exact
   Inspector ID and fingerprint. Record that result through `progress`. Once a PR
   exists and the last Auditor passed, spawn the Auditor for a repair only when
   routing puts it at deep tier or the plan changed since ship; otherwise the
   Inspector alone satisfies `verify` under `config/routing.json`'s
   `review.postShipAuditor` policy.
4. Call CLI `verify`. Only its success means the session is verified.

## Internal recovery

On failure classify the evidence: clear/local, unclear, repeated same class,
flaky/concurrent/cross-cutting, or infrastructure. Call CLI `recover` with the failing evidence ID, failure class, diagnostic flags,
and the approved task ID that owns the repair. It invokes `recoveryDecision` from
`lib/recovery.js`, persists counters, and returns the assignment/model before spawn.
Keep its session-wide `repairAttempts` budget across all failure classes.
Do not reset it after diagnosis, resume, or switching failure classes.
Unavailable tools/environments go to a human decision without code repair.
After the user resolves the blocker, changes the requirement, or explicitly authorizes
a retry, call `resolve-failures` with the named pending failure IDs and their decision.
This retires only those blockers and never resets failure or repair counters.
Do not call it merely because another retry seems useful.

For a clear failure dispatch one scoped Engineer without Agent isolation, in the
integration checkout. Pass the full approved task, returned attempt assignment, exact
base, integration root, absolute plugin root/library paths, and session directory.
Follow start's prepareBranch, completion, `result`, and `integrate` contract for
repairs too. For unclear causes or a repeated
same-class repair failure, Detective diagnoses before another repair. Persist the
failure class and diagnostic evidence in progress. A completed diagnosis does not
consume another Engineer attempt. Budget exhaustion stops with the remaining
findings and a human decision. No unbounded retry or automatic budget reset.

After any repair, integrate committed changes and rerun the integrated Inspector
and Auditor. Previous passing evidence is stale, including the human confirmation;
re-present only the checklist items the repair could have changed. Update the plan
and obtain approval only if the repair materially changes the approved scope/dependencies.
