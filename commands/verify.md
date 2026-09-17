---
name: verify
description: Independently check and review the integrated result, with bounded repair and applicable human confirmation.
allowed-tools: ["Agent", "Read", "Write", "Bash", "Grep", "Glob"]
user-invocable: true
---

# Verify

Read `../references/lifecycle.md`. All Engineer work, version updates, and commits must be
integrated before final verification. A commit after verification makes machine
evidence stale, even if content is otherwise identical. Human visual approval can
carry forward under `../references/visual-review.md`. The lead never implements a repair.

Verification runs once, on the final integrated commit, normally entered from
`wrap`. Running it after every task repeats the Inspector and Auditor for each
later amendment without adding assurance. Only a risky task that later tasks
depend on justifies an earlier Inspector, and never an earlier Auditor.

Every reviewer receives the exact absolute session directory containing plan.json,
integration checkout, and plugin library paths. GORKHALI_DATA is not the session directory.

1. For `userVisible:true`, call `visual-status` first. If `reusable:true`, continue
   without another user confirmation. Otherwise follow `../references/visual-review.md`:
   reconcile Git problems first, or show the specific missing/changed acceptance
   criteria and obtain a human pass. Silence, screenshots alone, and agent opinion
   are not an initial pass. A design change is a plan amendment, not a verification
   failure. Only an actual new pass calls `human-confirmation`; a new commit alone
   never justifies asking the user to repeat it.
2. Spawn one economy Inspector on the integrated checkout. It discovers checks,
   captures fingerprints before/after, and calls `recordInspector` in
   `lib/verification.js`. Record its result through CLI `progress`.
   For autonomous work it must independently supply `scopeFiles` for the complete
   original-base diff. Missing classifications or reaching the implementation-line
   limit blocks verification; preserve work and obtain explicit scope approval.
3. Only after `requireInspector` accepts the current evidence, spawn one Auditor
   in an independent context. Use CLI `route`'s Auditor model, which combines integrated risk signals
   and current failure counters. Auditor calls `recordAuditor` with the exact
   Inspector ID and fingerprint. Record that result through `progress`. Once a PR
   exists and the last Auditor passed, spawn the Auditor for a repair only when
   routing puts it at deep tier or the plan changed since ship; otherwise the
   Inspector alone satisfies `verify` under `config/routing.json`'s
   `review.postShipAuditor` policy.
   Autonomous changes always need the current Auditor, including after ship, to
   review scope exclusions. Every passing Auditor record also includes the
   no-added-explanatory-comments evidence described in `../references/code-comments.md`,
   regardless of whether the work was autonomous or manually approved.
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

After a repair, integrate committed changes and refresh Inspector and the applicable
Auditor evidence under the policy above. Reuse human visual approval when the
acceptance scope is unchanged, including fixes that restore already approved
behavior. Update the plan and obtain approval only if the repair materially changes
approved scope/dependencies. Ask for renewed visual review only for changed
acceptance criteria, not merely for changed files or commits.
