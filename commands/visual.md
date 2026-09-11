---
name: visual
description: "Use when UI changes need human visual verification. Presents the user checklist by default; runs one optional read-only Surveyor inspection only when explicitly requested."
argument-hint: "[/route1 /route2 ...] [--surveyor]"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
user-invocable: true
---

# /gorkhali:visual $ARGUMENTS

A human visual-verification handoff. Gorkhali does not inspect the UI or claim a visual pass on the user's behalf by default.

## Procedure

1. Determine the affected routes from `$ARGUMENTS`, the approved plan, or the changed files. If they cannot be determined, ask the user.
2. Present a short checklist:
   - each route or URL to inspect;
   - the expected behavior;
   - every viewport, state, or interaction materially affected;
   - any known gap the user should know about.
3. Ask the user to inspect it and reply with an explicit pass, or concrete issues. Silence, a screenshot, or an agent's opinion is never read as confirmation.
4. If the user reports an issue, hand it to normal implementation and verification; do not auto-fix or start a visual loop here.
5. If the user confirms, hand that confirmation back to `/gorkhali:verify`, which records it once.

## Optional Surveyor pass

Run this only when `$ARGUMENTS` contains `--surveyor` or the user explicitly asks to run Surveyor. Naming or negating Surveyor does not activate it, and a UI diff or design link never triggers it automatically.

Spawn exactly one read-only Surveyor. It resolves the exact dev URL itself, never guessing a port, and asks the user for one if it cannot find it. It inspects each route and returns advisory findings, screenshots, and observation gaps.

Present Surveyor's evidence to the user, then continue with the normal checklist above. A missing, failed, or blocked Surveyor result never blocks verification, review, or shipping, and never replaces the user's own confirmation.

When invoked outside an active verification flow, stop after the user's reply and name the next command. This command alone never confirms shipping readiness.
