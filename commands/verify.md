---
name: verify
description: Independently check and review the integrated result, with bounded repair and applicable human confirmation.
allowed-tools: ["Agent", "Read", "Write", "Bash", "Grep", "Glob"]
user-invocable: true
---

# Verify

Read `_shared.md`. All Engineer work, version updates, and commits must be
integrated before final verification. A commit after verification makes evidence
stale, even if content is otherwise identical. The lead never implements a repair.

1. Spawn one economy Inspector on the integrated worktree. It discovers checks,
   captures fingerprints before/after, and calls `recordInspector` in
   `lib/verification.js`. Record its result through CLI `progress`.
2. Only after `requireInspector` accepts the current evidence, spawn one Auditor
   in an independent context. Use CLI `route`'s Auditor model, which combines integrated risk signals
   and current failure counters. Auditor calls `recordAuditor` with the exact
   Inspector ID and fingerprint. Record that result through `progress`.
3. For `userVisible:true`, present a concrete checklist with expected results.
   Wait for an explicit human pass; silence, screenshots alone, and agent opinion
   are not confirmation. Only then call `human-confirmation`.
4. Call CLI `verify`. Only its success means the session is verified.

## Internal recovery

On failure classify the evidence: clear/local, unclear, repeated same class,
flaky/concurrent/cross-cutting, or infrastructure. Call CLI `recover` with the failing evidence ID, failure class, diagnostic flags,
and the approved task ID that owns the repair. It invokes `recoveryDecision` from
`lib/recovery.js`, persists counters, and returns the assignment/model before spawn.
Keep its session-wide `repairAttempts` budget across all failure classes.
Do not reset it after diagnosis, resume, or switching failure classes.
Unavailable tools/environments go to a human decision without code repair.

For a clear failure dispatch one scoped Engineer. For unclear causes or a repeated
same-class repair failure, Detective diagnoses before another repair. Persist the
failure class and diagnostic evidence in progress. A completed diagnosis does not
consume another Engineer attempt. Budget exhaustion stops with the remaining
findings and a human decision. No unbounded retry or automatic budget reset.

After any repair, integrate committed changes and rerun the integrated Inspector
and Auditor. Previous passing evidence is stale. Update the plan and obtain
approval only if the repair materially changes the approved scope/dependencies.
