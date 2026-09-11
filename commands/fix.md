---
name: fix
description: "Use when verification failed - broken tests, failed build, lint, or a failing review - and the failing step is known. Cold-start fixes -> gorkhali:start; unknown causes -> gorkhali:detective."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
user-invocable: true
---

# /gorkhali:fix

Repair the exact failures verification named. This command never guesses at a different problem.

## Preconditions

Load the latest Inspector or Auditor record from the session. If neither exists, stop and say to run `/gorkhali:verify` first.

Read this session's `progress.json` for the fix loop count. Two loops is the ceiling. If the count is already 2, stop and report the escalation below instead of starting a third.

## Loop

1. Reproduce the named failure and trace it to its exact cause before touching any file. Never patch on a guess.
2. Spawn one Engineer, scoped only to the checks or findings verification named. It fixes the code, never the test, unless the check itself is the test.
3. Append this loop to `progress.json`, so a later `/gorkhali:resume` reads the same count.
4. Run `/gorkhali:verify` again.
5. If it passes, stop here. Fixing is done.
6. If it fails with the same class of problem as the loop before, stop; do not try a third time in this session. See Escalation.
7. If it fails with a genuinely new problem and the loop count is still under 2, return to step 1.

## Escalation

At the two-loop ceiling, or on a repeated same-class failure, stop and report in chat:

- what each loop attempted and what it found;
- the best current root-cause hypothesis;
- options: pivot the approach, reduce scope, accept the remaining issue, or abandon this path.

Wait for the user's choice. Do not start a third loop on your own judgment.

This command never edits code outside the named failures, never rewrites a test to make it pass, and never ships on its own.
