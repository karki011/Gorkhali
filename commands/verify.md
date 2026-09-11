---
name: verify
description: "Run the repository's correctness checks and obtain an independent review of the diff. Reports failures; it never edits code to make a check pass."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
user-invocable: true
---

# /gorkhali:verify

Verify the current diff. This command never edits code, never writes tests, and never makes a failing check pass by itself.

## Step 1: Inspector runs the checks

Spawn one read-only Inspector. It discovers the test, lint, build, and typecheck commands with `lib/checks.js`, runs each one, and records the exact command, its provenance, and its result. It writes this record to `{SESSION_DIR}/inspector.json` and appends a line to `progress.json`.

Read Inspector's record at `{SESSION_DIR}/inspector.json` for its verdict:

- `pass` - every discovered check passed.
- `fail` - a discovered check failed.
- `not_observed` - nothing failed, but a discovered check did not run.

A check type `discoverChecks` resolved to no command is `absent`, not `not_observed` - it is excluded from the verdict and never blocks; a Python repo that only exposes `test` still verifies cleanly. Only a failing or missing (`not_observed`) discovered check blocks. A missing Inspector record blocks verification, and so does a `fail` verdict. Report the exact failing or missing checks and name `/gorkhali:fix` as the next step.

## Step 2: Auditor reviews the diff

When Inspector's verdict is `pass`, spawn one read-only Auditor over the current diff. Auditor checks correctness, security, regressions, broken references and contracts, and simplification opportunities, then writes its own fixed record with a verdict of `pass`, `fail`, or `blocked`.

A `fail` or `blocked` verdict stops here too. Report Auditor's findings and name `/gorkhali:fix` as the next step.

## User visual confirmation

When the diff changes anything a user would see, prepare the `/gorkhali:visual` checklist and wait for the user's explicit pass or list of issues before calling verification done. Silence, a screenshot, or an agent's opinion is never confirmation.

## Result

Report Inspector's checks, Auditor's verdict and findings, and user visual confirmation when it applied. End with:

- `done` - Inspector passed, Auditor passed, and visual confirmation is either not needed or given.
- `blocked` - a failing or missing check, or a failing or blocked review, with the exact evidence.

This command reports only. It never fixes findings itself and never proceeds to shipping on its own.
