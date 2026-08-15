# Shipping

Load this phase only when the user requests an external lifecycle action after
current verification and independent review pass. Local implementation
authorization never authorizes shipping.

## Recheck before authorization

Run compact status and inspect the current worktree. Shipping requires:

- execution started through the lifecycle engine;
- the latest required verification passed for the current fingerprint;
- a later independent review passed for the same current fingerprint;
- every triggered specialist passed with current evidence;
- no newer failed, blocked, missing, or stale required record.

Let the state helper evaluate these gates. Do not copy the gate algorithm into
an agent checklist or select an older favorable artifact.

## Obtain separate authority

Ask for explicit authority to create the pull request and any required
push. Record that scope separately:

```text
node <skill-directory>/scripts/phantom-state.mjs authorize --workspace <path> --scope ship-pr
node <skill-directory>/scripts/phantom-state.mjs ship --workspace <path>
```

The `ship` transition means the deterministic preconditions are ready; it does
not itself create a branch, commit, push, pull request, ticket transition, or
merge. Perform only the external actions the user authorized, using current
repository instructions and provider-native tools.

Default to a ready-for-review pull request. Report verification, review,
specialist results, measured context and state changes when relevant, compatibility risks,
and any migration behavior. Do not merge, delete branches, clean worktrees,
transition tickets, or publish a release without separate authority for that
action.

## Optional RPSL

RPSL is optional. Run it only when the user requests it or a documented risk
policy explicitly triggers it. Its result supplements the normal evidence and
can block only when it was required before the attempt. It never creates
authorization, repairs stale fingerprints, or waives verification, independent
review, or specialist failures.

## Failure and completion

If an external action fails or repository state changes, stop and re-evaluate
freshness. Pause with the failed action, observable result, and exact next safe
step instead of retrying destructively.

Local completion does not imply shipping, and shipping does not imply merge.
After authorized actions finish, record completion through the state helper
without deleting the session:

```text
node <skill-directory>/scripts/phantom-state.mjs complete --workspace <path>
```

Return the pull request location and current evidence summary, or a clear blocked
status naming the missing authority or gate.
