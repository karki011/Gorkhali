# Portable state contract

State must be readable by a later compatible agent regardless of which runtime
created it.

## Data root

Resolve the data root in this order:

1. `PHANTOM_DATA` when set (absolute wins; a relative value resolves against the
   workspace).
2. `$HOME/.phantom` when a home directory is available.
3. `<workspace>/.phantom` as the final fallback.

Do not use a provider-owned directory as the portable default. A runtime name
may appear as optional diagnostic metadata but must never select behavior.

Every layer resolves this through one shared codec so the value is identical
across runtimes. `PHANTOM_DATA` is deterministic: the same value always yields
the same root, and the codec never falls back to another root when it is set.

## Repository identity

The shard key for all per-repository state (`repos/<repo-id>/…`) is resolved by
the same shared codec, so the CommonJS scripts, the portable ESM skill, and the
shell resolver all produce one id for one workspace. The codec is versioned; a
change that alters an id keeps the previous ids discoverable as aliases.

Precedence, first match wins, never throws:

1. A working directory inside `<data-root>/worktrees/<segment>/…` resolves to
   that `<segment>` verbatim. These are Phantom-managed worktrees only; user
   worktrees elsewhere are not this root and resolve through the git steps.
2. `PHANTOM_REPO`, when set, is used verbatim (trimmed). It is deterministic and
   per-spawn; never export it globally.
3. With an origin remote, the id is `<name>-<hash>`. The remote is normalized
   first so equivalent forms converge: the host is lowercased, credentials and
   the scheme's default port (`22` for ssh, `443` for https) are stripped, a
   trailing `.git` is removed, and owner/repository path case is preserved.
   SSH, HTTPS, SCP-short, renamed clones, and worktrees of the same repository
   therefore share one id, while same-named repositories under different owners
   or hosts stay distinct.
4. With no origin remote, the id is the basename of the repository's main root,
   found through the Git common directory. A worktree and its main checkout
   resolve to the same id.
5. Without git, the id is the basename of the nearest ancestor holding a `.git`
   entry.
6. Otherwise the id is `_default`.

Because a repository's id can already exist under earlier conventions (the plain
remote basename, or a hash of the un-normalized remote), the codec records those
earlier ids as aliases in a reverse map at `repos/.aliases.json` under the data
root, keyed alias-to-canonical. Recording is merge-only and never drops an
existing entry, so an origin change or codec upgrade leaves prior ids
discoverable. Alias recording is an explicit write; plain identity resolution
has no side effects.

## Layout

```text
<data-root>/
  state/current-session/<repo-id>.json       # durable task pointer (this contract)
  state/session-telemetry/<repo-id>.json     # transient runtime telemetry (separate path)
  repos/<repo-id>/
    sessions/<task-id>/
      session.json
      context.json
      intent.json
      defect-proof.json
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

## Pointer contract

The durable task pointer at `state/current-session/<repo-id>.json` is the only
authority on which task is current. It is a version-1 record
(`{ schema_version, repo_id, task_id, session_dir, updated_at }`) written solely
by the lifecycle helper on `start`, `record`, and `complete`.

Runtime telemetry (the host session id captured per prompt) is written to a
physically separate path, `state/session-telemetry/<repo-id>.json`
(`{ session_id, cwd, ts }`). Telemetry must never be written to the durable
pointer path, so a per-prompt telemetry write cannot overwrite the active task
pointer. A reader keeps the two apart by path, not by inspecting fields.

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
  "bundle_version": "2.2.8",
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

## Defect-proof gate

`start --work-kind investigation` explicitly classifies defect work.
Conservative `bug`, `defect`, `regression`, `incident`, or `flaky failure`
intent signals always classify the session as `investigation`, even if
`--work-kind implementation` is supplied; otherwise the explicit value or
`implementation` default applies. The selected `work_kind` is persisted in
both `session.json` and `intent.json`. It changes during an active session only
through `correct-work-kind --work-kind <kind> --granted-by <who> --reason
<why>`, which is refused once `execute` has started and records an auditable
`work_kind_correction` in `session.json`. Defect signals keep classifying the
session as `investigation` until that recorded correction exists; a malformed
or unrecorded correction fails closed.
Execute reconciles both artifacts, their summaries, and defect signals
before selecting a gate. Missing, mismatched, or internally contradictory
classification artifacts fail closed.

Before portable `execute` can start an investigation, the session-scoped
`defect-proof.json` must pass contract version 1. It must bind the active
repository, task, and current worktree fingerprint; record an observed
reproduction with evidence; record a confirmed causal code path and evidence;
and contain explicit user confirmation. Its state/verdict must be
`ready_for_fix` / `confirmed_defect`.
Every required evidence reference must be a normalized session-relative path
to an existing regular file that resolves inside the active session directory.
Missing files, absolute paths, traversal, and path escapes fail closed.

A DiagnosticGrant is optional. When present it records `grantedBy`,
`objective`, `grantedAt`, `expiresAt`, `allowedActions`, `allowedPaths`,
`baselineFingerprint`, boolean `cleanupRequired`, and `revokedAt`. The portable
gate rejects expired, revoked, malformed, out-of-scope, status-inconsistent, or
cleanup-pending grants. Instrumentation records must match an allowed action
and path. Cleaned instrumentation requires cleanup evidence; instrumentation
retained in implementation scope requires explicit approval fields.

`waiting_for_evidence` / `unconfirmed_defect` is a resumable hold, not a
completed session. Pause and resume preserve the proof artifact, but execute
continues to fail closed until Hound updates it with complete current evidence.

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
      "ship-pr": { "status": "pending", "decided_at": null }
    },
    "actions": {
      "execute": { "status": "pending", "decided_at": null },
      "verify": { "status": "pending", "decided_at": null },
      "ship": { "status": "pending", "decided_at": null }
    }
  }
}
```

Implementation authorization and PR shipping authorization are distinct; one
never implies the other. `ship-pr` is the canonical PR-shipping scope name.
`ship-draft-pr` is its legacy name: it stays accepted on `authorize` and on
read for the whole 0.4.x line, and folds onto the same `ship-pr` gate, so a
session recorded under either name authorizes exactly once.
Starting with `--mode to-plan` (or `--to-plan`) sets a permanent plan-only mode
for that session. It can produce planning
artifacts and record authorization decisions, but `execute` and `ship` remain
denied. Verification still cannot start because execution never started.
Compact status returns `record:plan` until the canonical plan is valid, then
returns no next action; it never recommends an action the mode will reject.
`complete` closes a plan-only session on that same valid canonical plan instead
of execution and quality gates, so the workspace is released for the next task.
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
node <skill-directory>/scripts/phantom-state.mjs fingerprint --workspace <path>
node <skill-directory>/scripts/phantom-state.mjs execute --workspace <path>
node <skill-directory>/scripts/phantom-state.mjs verify --workspace <path>
node <skill-directory>/scripts/phantom-state.mjs authorize --workspace <path> --scope ship-pr
node <skill-directory>/scripts/phantom-state.mjs ship --workspace <path>
```

The legacy form `--scope ship-draft-pr` still records the same `ship-pr` gate.

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

The portable hard gate in bundle 2.2 covers defect proof. Per-implementation-
scope independent verification records remain required by the compatibility
command contract but are not yet a versioned portable lifecycle artifact. A
follow-up contract version must make that validation authoritative before the
portable runtime claims per-scope enforcement.

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
- Every new passed verification records exactly one user-verification decision:
  `{ "required": false }` for non-UI work, or confirmed user evidence for UI
  work. The first form does not prompt the user. The helper stores that decision
  atomically with the complete current worktree fingerprint; any later file,
  index, mode, deletion, symlink, gitlink, or untracked-content change makes it
  stale. Active legacy sessions missing this decision remain inspectable and project
  `record:verification-with-user-verification-decision`; they require fresh
  verification and review rather than migration. Completed sessions remain
  read-only and inspectable.
- Ward classifies rendered behavior from the complete final diff; the state
  engine does not infer UI semantics from filenames. Gaze independently checks
  that classification against the same diff and blocks a false non-UI decision.
- Never delete a session to complete it; move or copy it to `completed`.

## Learning index

The learning files under `repos/<repo-id>/learnings/` (`INDEX.md`,
`auto-captures.md`, and `<domain>.md`) are mutated through one concurrent-safe
API, the bundled `scripts/phantom-learning.mjs`. Every mutation runs under a
per-learnings-dir advisory lock; a contended writer waits and then fails rather
than writing unlocked, so concurrent writers preserve every entry and leave a
valid index. Both runtimes use it the same way:

```text
node <skill-directory>/scripts/phantom-learning.mjs capture --learnings <dir>      # candidates JSON on stdin
node <skill-directory>/scripts/phantom-learning.mjs consolidate --learnings <dir>  # candidates JSON on stdin
node <skill-directory>/scripts/phantom-learning.mjs check --learnings <dir>        # validate; exit 1 on problems
```

There is intentionally no unlocked write path. A caller that cannot take the
lock drops its best-effort capture instead of clobbering a concurrent writer.

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
