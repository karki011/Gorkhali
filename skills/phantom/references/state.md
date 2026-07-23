# Portable state contract

State must be readable by a later compatible agent regardless of which runtime
created it.

## Data root

Resolve the data root in this order:

1. `PHANTOM_DATA` when set.
2. `$HOME/.phantom` when a home directory is available.
3. `<workspace>/.phantom` as the final fallback.

Do not use a provider-owned directory as the portable default. A runtime name
may appear as optional diagnostic metadata but must never select behavior.

## Layout

```text
<data-root>/
  state/current-session/<repo-id>.json
  repos/<repo-id>/
    sessions/<task-id>/
      session.json
      context.json
      intent.json
      capabilities.json
      brainstorm.json
      plan.json
      decisions.json
      checkpoints/
      contracts/
      runs/<run-id>/
    completed/<task-id>/
    learnings/INDEX.md
  global/patterns/
  audit/
  locks/
```

Derive `repo-id` from stable repository identity when possible, with a short
collision-resistant hash. Sanitize task identifiers before using them as path
segments.

## Artifact envelope

Every JSON artifact must include:

```json
{
  "schema_version": 1,
  "artifact_type": "session",
  "repo_id": "project-0123456789",
  "task_id": "TASK-1",
  "status": "active",
  "created_at": "2026-01-01T00:00:00.000Z",
  "updated_at": "2026-01-01T00:00:00.000Z",
  "bundle_version": "2.1.0",
  "producer": {
    "role": "apex",
    "compute_profile": "frontier"
  }
}
```

Optional runtime diagnostics belong under `producer.runtime`; consumers must
ignore unknown fields. `bundle_version` identifies the portable bundle that
wrote an artifact. `model_routing.actual_profile` remains `null` unless the
host reports it; never infer it from a requested profile or model name. Add
non-negative `wall_time_ms` and integer `tool_turns` only when observable.
Recorded workflow and run artifacts include `model_routing`; session and intent
envelopes omit it because they do not represent a routed worker execution.

The envelope `schema_version` remains `1`. Decision-first brainstorm and plan
payloads declare `contract_version: 3` inside `evidence`; this separates the
stable portable envelope from an evolvable workflow contract. The enriched v3
fields are additive, so earlier v3 decision records remain readable. New v3
payloads follow [brainstorming](brainstorming.md) or [planning](planning.md).
The envelope persists enriched fields unchanged;
generated plan and brainstorm HTML are distinct projections of the same
canonical JSON.

Session envelopes use `active`, `paused`, or `completed`. Recorded workflow and
run artifacts use `pending`, `passed`, `failed`, `blocked`, or `skipped`.
For plan and brainstorm artifacts, `passed` means the artifact validated and its
review pass completed; it never means the user approved the recommendation.
Approval remains in the decision record. Session completion specifically
requires `passed` verification and review artifacts.

## Route-aware lifecycle state

The session envelope additively carries a `lifecycle` object while retaining
`schema_version: 1`. Consumers of older sessions must synthesize missing
pending values rather than rejecting the session:

```json
{
  "lifecycle": {
    "mode": "standard",
    "approvals": {
      "direction": { "status": "pending", "decided_at": null },
      "plan": { "status": "pending", "decided_at": null },
      "wiring": { "status": "pending", "decided_at": null }
    },
    "authorizations": {
      "implementation": { "status": "pending", "decided_at": null },
      "ship-draft-pr": { "status": "pending", "decided_at": null }
    },
    "actions": {
      "execute": { "status": "pending", "decided_at": null },
      "verify": { "status": "pending", "decided_at": null },
      "ship": { "status": "pending", "decided_at": null }
    }
  }
}
```

Implementation authorization and draft-PR shipping authorization are distinct;
one never implies the other. Starting with `--mode to-plan` (or `--to-plan`)
sets a permanent plan-only mode for that session. It can produce planning
artifacts and record authorization decisions, but `execute` and `ship` remain
denied. Verification still cannot start because execution never started.
For an existing active task, route and material intent are immutable. `start`
may backfill a missing route on a legacy session, but a route or intent change
must be captured as an explicit revision or restarted under a new task id. It
must never silently retain approvals across changed intent.

Record decisions and cross lifecycle gates with the helper:

```text
node <skill-directory>/scripts/phantom-state.mjs approve --workspace <path> --gate direction
node <skill-directory>/scripts/phantom-state.mjs approve --workspace <path> --gate plan
node <skill-directory>/scripts/phantom-state.mjs approve --workspace <path> --gate wiring
node <skill-directory>/scripts/phantom-state.mjs authorize --workspace <path> --scope implementation
node <skill-directory>/scripts/phantom-state.mjs execute --workspace <path>
node <skill-directory>/scripts/phantom-state.mjs verify --workspace <path>
node <skill-directory>/scripts/phantom-state.mjs authorize --workspace <path> --scope ship-draft-pr
node <skill-directory>/scripts/phantom-state.mjs ship --workspace <path>
```

Missing prerequisites fail with the exact missing decision and the command that
records it. Route gates are cumulative: `direct` needs no approval, `plan`
needs plan approval, `brainstorm` needs direction approval before plan
approval, and `full` additionally needs wiring approval. Recording a new
brainstorm invalidates direction and downstream approvals; recording a new plan
invalidates plan and wiring approvals, and recording new decisions invalidates
wiring approval, so changed decisions must be approved again.

Every approval is bound to the corresponding current passed artifact by its
`record_sequence` and SHA-256 digest. Direction binds the current passed
`brainstorm`; plan binds the current passed `plan`; wiring binds both the
current passed `plan` and current passed `decisions` artifact because there is
no separate wiring artifact. Approval fails until those artifacts exist and
have passed. `execute` revalidates every binding. A recovered legacy approval
without a binding is not trusted: record a fresh passed artifact and approve it
again.

Delegated passes use versioned `delegation-task` and `delegation-result`
payloads stored under `runs/<run-id>/`. Both must validate against the portable
contract in [roles](roles.md) before the result can be synthesized.

## Persistence rules

- Write JSON to a unique temporary file in the destination directory, flush it,
  then rename it atomically.
- Validate inputs, decision contracts, model diagnostics, gate evidence, and
  the worktree fingerprint before persistence. Persist a recorded artifact
  successfully before advancing execute or verify lifecycle state. A failed
  artifact write must leave those lifecycle actions unchanged; if the later
  state write fails, restore the prior artifact, session, and pointer values.
- Serialize lifecycle mutations with the per-repository advisory lock under
  `locks/`. Recover a lock whose owning process no longer exists, and reject a
  second active task rather than silently replacing the current-session pointer.
- Preserve `created_at` and update `updated_at` on mutation.
- Treat session artifacts as source of truth, not conversation memory.
- Pause with the exact next action, dirty-worktree state, decisions, incomplete
  checks, and blockers.
- Resume by reading instructions and corrections again, validating workspace
  identity, and checking whether recorded state is stale.
- Complete only after required verification and authorized lifecycle actions.
- Treat the newest verification and review artifacts as authoritative. A newer
  failed or blocked gate cannot be overridden by an older pass. A passed
  verification includes at least one named passed check; a passed review has a
  `pass` verdict and a findings array.
- Bind every verification and review artifact to the current
  `worktree_fingerprint`. `ship` and `complete` require the latest artifact for
  each gate to be passed and bound to the current fingerprint. Any subsequent
  tracked or untracked content change makes that evidence stale. The fingerprint
  includes index stage, mode, blob, and gitlink entries plus tracked working
  state, executable bits, deletions, untracked content, and symbolic-link
  targets, including dangling links.
- Record review only after the authoritative current passed verification for
  the same fingerprint. The authoritative review must have a later
  `record_sequence`; any later verification makes an earlier review stale and
  blocks `ship` and `complete` until review runs again.
- Never delete a session to complete it; move or copy it to `completed`.

The bundled state helper implements the portable baseline. If command execution
is unavailable, reproduce this contract with file tools.

Record typed delegation and observable routing diagnostics with the same
helper:

```text
node <skill-directory>/scripts/phantom-state.mjs record --workspace <path> --type delegation-task --status pending --run <run-id> --input <task-json>
node <skill-directory>/scripts/phantom-state.mjs record --workspace <path> --type delegation-result --status passed --run <run-id> --input <result-json> --actual-profile <profile> --wall-time-ms <ms> --tool-turns <count>
```

Use `--fallback-reason <text>` only when routing fell back. Omit diagnostics the
host cannot observe; the helper records them as `null` rather than guessing.
