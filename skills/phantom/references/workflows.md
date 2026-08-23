# Workflow compatibility index

This file remains for installed clients that previously referenced the former
combined workflow guide. It is not a lifecycle authority and is not part of
normal start activation.

The portable router owns route selection. The deterministic state helper owns
approvals, authorizations, transitions, freshness, and blocking. Procedural
guidance is split into four phase files beside this one:

- `planning.md`
- `execution.md`
- `verification.md`
- `shipping.md`

Load only the current phase. Older callers may map their operation to the
matching phase without changing the session route, state location, approval
boundary, or evidence contract.

Routes remain `lite`, `direct`, `plan`, `brainstorm`, and `full`. They differ
only in the decision artifacts and approvals needed before the separately authorized
execution phase. Worker topology is chosen from proven task independence and
runtime capability; file count is not a lifecycle rule.

If an older instruction conflicts with the router, a phase reference, current
state, repository instructions, or user authorization, preserve the higher
authority and report the compatibility fallback.
