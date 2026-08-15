---
name: visual
description: "Use when UI changes need human visual verification. Presents the user checklist by default; runs one optional read-only Phantom Lens inspection only when explicitly requested."
argument-hint: "[/route1 /route2 ...] [--lens]"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
---

> **Preamble Tier: T3** — loads `_shared.md` + `_shared-shadows.md` + `_shared-discipline.md` + `_shared-contracts.md`

# /phantom:visual $ARGUMENTS

Prepare a human visual-verification handoff. Phantom does not inspect the UI or
claim a visual pass on the user's behalf by default.

## Optional Lens mode

Activate Lens only when `$ARGUMENTS` contains `--lens` or the user affirmatively
asks to run, use, or invoke Phantom Lens in the current request. Merely naming,
asking about, or negating Lens (for example, "do not use Phantom Lens") does not
activate it. A UI diff, Figma link, screenshot, or required user verification
never triggers Lens automatically.

In optional Lens mode:

1. Resolve the routes, expectations, states, and viewports, plus the canonical
   current worktree path and exact Git branch.
2. Apply the URL-resolution contract in
   `reference/agent-protocols/visual-protocol.md`. If it requires user input, ask with
   the manager link, worktree, and branch, then keep this Lens request pending
   until the user supplies the exact Dev URL.
3. Record a bounded delegation-v2 task with `role: "lens"` when a Phantom
   session is active, then spawn exactly one read-only Lens named `lens-yara`.
4. Lens loads `agents/lens.md` and its references only inside that worker. It
   inspects and returns advisory screenshots, findings, and observation gaps.
5. Record the matching delegation result when state is active. Do not create a
   review specialist artifact or add Lens to `requiredSpecialists`.
6. Present the evidence to the user, then continue with the normal checklist.

A missing, failed, or blocked Lens result never blocks ordinary verification,
review, shipping, or completion. It also never replaces explicit user
confirmation. There is no autonomous mode, code modification, or visual fix
loop.

## Procedure

1. Determine the affected routes from arguments, the approved plan, or changed
   files. If they cannot be determined, ask the user for the routes.
2. For optional Lens, use the worktree-manager resolution above. For the
   ordinary human checklist, use an explicit user URL or observed startup
   output. Never assume a fixed application port.
3. Present a short checklist containing:
   - each URL or route to inspect;
   - the expected behavior from the approved intent;
   - every responsive viewport or parent/component state materially affected;
   - important interactions, loading, empty, error, and permission states; and
   - any known observation gap the user should be aware of.
4. Ask the user to inspect the checklist and reply with either an explicit pass
   or concrete issues. Do not interpret silence, a screenshot, or an agent's
   opinion as user confirmation.
5. If the user reports an issue, return it to normal scoped implementation and
   deterministic verification. Do not auto-fix or start a visual fix loop.
6. If the user explicitly confirms the UI, return that confirmation to
   `/phantom:verify`. Verification records it once in its canonical evidence;
   this command creates no specialist review artifact or competing state store.

When invoked outside an active verification flow, stop after the user's reply
and report the exact next command. Never claim shipping readiness from this
command alone.
