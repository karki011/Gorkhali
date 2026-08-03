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
shell resolver all produce one canonical id for one workspace. Normal runtime
resolution neither reads nor writes historical aliases.

Precedence, first match wins. Invalid caller-supplied identities fail closed:

1. A working directory inside `<data-root>/worktrees/<segment>/…` resolves to
   that `<segment>` after validating it as one safe 1-120 character path
   segment. These are Phantom-managed worktrees only; user
   worktrees elsewhere are not this root and resolve through the git steps.
2. `PHANTOM_REPO`, when set, is trimmed and must be one safe 1-120 character
   path segment. It is deterministic and per-spawn; never export it globally.
3. With an origin remote, the id is `<name>-<hash>`. The remote is normalized
   first so equivalent forms converge: the host is lowercased, credentials and
   the scheme's default port (`22` for ssh, `443` for https) are stripped, a
   trailing `.git` is removed, and owner/repository path case is preserved.
   SSH, HTTPS, SCP-short, renamed clones, and worktrees of the same repository
   therefore share one id, while same-named repositories under different owners
   or hosts stay distinct.
4. With no origin remote, the id is `<name>-<hash>`, derived from the canonical
   main root found through the Git common directory. A worktree and its main
   checkout resolve to the same id, while equal basenames at different roots do
   not collide.
5. Without git, the id is `<name>-<hash>` for the canonical nearest ancestor
   holding a `.git` entry.
6. Otherwise the id is `_default`.

Historical shard names are handled only by explicit offline migration and report
commands. Those tools may derive or read `repos/.aliases.json` while consolidating
old data, but normal identity, state, learning, and brain-card paths always use the
canonical id directly and never consult that map.

## Layout

```text
<data-root>/
  state/current-session/<repo-id>.json       # durable task pointer (this contract)
  state/session-telemetry/<repo-id>.json     # transient runtime telemetry (separate path)
  repos/<repo-id>/
    sessions/<task-path-segment>/
      session.json
      context.json
      intent.json
      defect-proof.json
      capabilities.json
      capability-probe.json
      brainstorm.json
      plan.json
      decisions.json
      checkpoints/
      contracts/
      runs/<run-id>/
    completed/<task-path-segment>/
    learnings/INDEX.md
  global/patterns/
  audit/
  locks/
```

Derive `repo-id` from stable repository identity with a short
collision-resistant hash. Preserve the original task id in every artifact.
Already-safe task ids remain unchanged as path segments; any other 1-150 byte
UTF-8 task id is encoded losslessly as a Base64URL path segment. Oversized or
NUL-containing ids are rejected rather than truncated or normalized into a
collision.

## Pointer contract

The durable task pointer at `state/current-session/<repo-id>.json` is the only
authority on which task is current. It is a version-2 record
(`{ schema_version, repo_id, task_id, session_dir, updated_at }`) written solely
by the lifecycle helper on `start`, `record`, and `complete`.

Runtime telemetry (the host session id captured per prompt) is written to a
physically separate path, `state/session-telemetry/<repo-id>.json`
(`{ session_id, cwd, ts }`). Telemetry must never be written to the durable
pointer path, so a per-prompt telemetry write cannot overwrite the active task
pointer. A reader keeps the two apart by path, not by inspecting fields.

## Artifact envelope

Every persisted JSON artifact governed by `state_envelope` must include:

```json
{
  "schema_version": 2,
  "artifact_type": "session",
  "repo_id": "project-0123456789",
  "task_id": "TASK-1",
  "status": "active",
  "created_at": "2026-01-01T00:00:00.000Z",
  "updated_at": "2026-01-01T00:00:00.000Z",
  "bundle_version": "3.0.1",
  "producer": {
    "role": "apex",
    "compute_profile": "frontier"
  }
}
```

The envelope and producer are closed contracts. `producer` contains exactly
`role` and `compute_profile`; unknown fields, relabeled artifact types, and
undeclared producer roles are rejected. Session, intent, context, capabilities,
brainstorm, plan, and decisions are Apex-produced; execution is Blade-produced;
wrap is Warden-produced. Delegation producers must match the delegated role and
resolved profile recorded in their evidence. `bundle_version` is strict core
SemVer provenance identifying the portable bundle that wrote an artifact; it
does not select the reader contract. `schema_version` controls compatibility.

`model_routing.actual_profile` remains `null` unless the host reports it; never
infer it from a requested profile or model name. Add non-negative
`wall_time_ms` and integer `tool_turns` only when observable. Recorded workflow
and run artifacts include `model_routing`; session and intent envelopes omit it
because they do not represent a routed worker execution. Raw `evidence` may
carry artifact-specific diagnostics, but it does not relax the outer envelope.

State envelope version `2` is a hard runtime cut. Readers accept only version
`2`; they never migrate, reinterpret, or fall back to version `1`. A valid
strict `bundle_version` records provenance and may differ from the current
bundle without making an otherwise supported version-2 envelope incompatible.

## Offline version-1 migration

Doctor is a read-only detector. Its schema-version-3 report includes a redacted
`migration` descriptor and blocks readiness with `migration_required` when the
canonical pointer needs migration. It never writes, archives, or activates
state. Run the separate migrator explicitly:

```text
node <skill-directory>/scripts/migrate-session-state.mjs inventory --workspace <path> --output <migration-manifest.json>
node <skill-directory>/scripts/migrate-session-state.mjs apply --workspace <path> --manifest <migration-manifest.json>
node <skill-directory>/scripts/migrate-session-state.mjs verify --workspace <path> --manifest <migration-manifest.json>
# Recovery only, when rollback is required:
node <skill-directory>/scripts/migrate-session-state.mjs rollback --workspace <path> --manifest <migration-manifest.json>
```

Inventory resolves the selected root through `PHANTOM_DATA` and the workspace
and scans its canonical current-session and repository session shards without
changing Phantom state. `--output` atomically creates the full content-bound
manifest as a private mode-`0600`, single-link file and emits only a redacted
receipt to stdout. Use `--output`, never shell redirection. Review every entry
before apply. Inventory rejects `--manifest`; only apply, verify, and rollback
accept the exact reviewed manifest. Paused v1 sessions are eligible without an
override. For each active entry, first stop all processes that may use it, then
regenerate inventory with a repeated
`--confirm-inactive <repo-id>/<task-path-segment>`. For each entry missing
`work_kind`, regenerate with a repeated
`--work-kind <repo-id>/<task-path-segment>=implementation|investigation`.
Confirmations and overrides are accepted only by inventory and become part of
the reviewed manifest required by apply, verify, and rollback.

The selected Phantom state stays untouched until apply. The manifest digest
binds the selected workspace's canonical path and physical identity, canonical
data root and repository identity, physical identities for the relevant
data/state/repository/source hierarchy, exact pointer and source content, and
runtime pointer/session path resolution. The digest-chained atomic
transaction journal additionally records and verifies the committed v2
pointer's physical identity. Crash-safe durable publication protects lock,
backup, successor, and pointer boundaries. Apply, verify, rollback, and
interrupted-operation recovery revalidate those bindings instead of following
caller-supplied or rebound paths.

Apply locks the migration and affected repository shards, verifies the exact
source manifest including inactivity confirmations and work-kind decisions,
and enforces bounded entry, file, byte, depth, journal-event, recovery-claim,
and lock-descriptor budgets. It creates content-addressed read-only backups
before mutation, archives or quarantines v1 source evidence as classified, and
commits pointers last. A paused or explicitly inactive session receives a
clean, paused, same-task v2 successor containing only fresh
session and intent envelopes plus the empty control-input channel. Approvals,
authorizations, authority trust, compiled workflow, journal, verification,
review, and defect evidence are not promoted and must be recreated. Completed
sessions and their pointers are archived as history only; they never become
synthetic v2 completions. Unsafe, ambiguous, telemetry-shaped, and unpointed
state is quarantined or left for explicit human judgment according to the
manifest.

Any filesystem node at the global `.session-state-migration.lock` path—live,
dead, malformed, directory, or symlink—is a hard barrier for runtime state
readers, writers, and Doctor. Runtime never deletes or reclaims it; interrupted
apply or rollback resumes only through the exact migrator and manifest. A
per-repository migration-shaped or ambiguous lifecycle lock also blocks.
Runtime lock recovery is limited to an exact ordinary lifecycle-lock record
whose owner process is definitely dead.

Interrupted apply or rollback resumes only when the same manifest, exact
physical lock generations, and digest-chained recovery claims remain trusted;
otherwise the migrator fails closed or requires human judgment. Apply performs
verification before returning, and `verify` can repeat it from
the same manifest. Rollback proceeds only while the archived sources, parked
pointers, and generated successors still match the transaction; otherwise it
returns `human_decision_required` with recovery steps. Rerunning an identical
manifest resumes or deduplicates the same digest-bound transaction. At the CLI,
`verify` status `failed` and rollback status `human_decision_required` are
written as JSON to stdout before the process exits nonzero; JSON output alone
is not a success signal.

After verified cutover releases all migration locks, the clean paused successor
validates through the ordinary v2 runtime and Doctor and may be explicitly
resumed. That readability comes from producing valid v2 state, not from a v1
runtime compatibility path or silent auto-migration.

Decision-first brainstorm and plan payloads continue to declare
`contract_version: 3` inside `evidence`; the outer state envelope and the inner
decision contract evolve independently. Accepted v3 payloads follow
[brainstorming](brainstorming.md) or [planning](planning.md) in full.

The envelope persists enriched fields unchanged;
generated plan and brainstorm HTML are distinct projections of the same
canonical JSON.

Session envelopes use `active`, `paused`, or `completed`. Recorded workflow and
run artifacts use `pending`, `passed`, `failed`, `blocked`, or `skipped`.
For plan and brainstorm artifacts, `passed` means the artifact validated and its
review pass completed; it never means the user approved the recommendation.
Approval remains in the decision record. Session completion is authorized only
by strict replay reaching an accepted current workflow state.

## Defect-proof gate

`start --work-kind investigation` explicitly classifies defect work.
Conservative `bug`, `defect`, `regression`, `incident`, or `flaky failure`
intent signals always classify the session as `investigation`, even if
`--work-kind implementation` is supplied; otherwise the explicit value or
`implementation` default applies. The selected `work_kind` is persisted in
both `session.json` and `intent.json` and cannot change during an active
session. Execute reconciles both artifacts, their summaries, and defect signals
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

The session envelope carries a required `lifecycle` object under
`schema_version: 2`:

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
      "ship-draft-pr": { "status": "pending", "decided_at": null },
      "tracker-comment": { "status": "pending", "decided_at": null }
    },
    "actions": {
      "execute": { "status": "pending", "decided_at": null },
      "ship": { "status": "pending", "decided_at": null }
    }
  }
}
```

Implementation authorization and draft-PR shipping authorization are distinct;
one never implies the other. Starting with `--mode to-plan`
sets a permanent plan-only mode for that session. It can produce planning
artifacts and record authorization decisions, but `execute` and `ship` remain
denied. Workflow execution and its evidence journal never start.
For an existing active task, route and material intent are immutable. A missing
route is invalid; a route or intent change must be captured as an explicit
revision or restarted under a new task id. It must never silently retain
approvals across changed intent.

Record decisions and cross lifecycle gates with the helper:

```text
node <skill-directory>/scripts/phantom-state.mjs approve --workspace <path> --gate direction --decision <signed.json>
node <skill-directory>/scripts/phantom-state.mjs approve --workspace <path> --gate plan --decision <signed.json>
node <skill-directory>/scripts/phantom-state.mjs approve --workspace <path> --gate wiring --decision <signed.json>
node <skill-directory>/scripts/phantom-state.mjs authorize --workspace <path> --scope implementation --decision <signed.json>
node <skill-directory>/scripts/phantom-state.mjs fingerprint --workspace <path>
node <skill-directory>/scripts/phantom-state.mjs execute --workspace <path>
node <skill-directory>/scripts/advance-workflow.mjs --workspace <path> --task <id> --input <event.json>
node <skill-directory>/scripts/replay-workflow.mjs --workspace <path> --task <id>
node <skill-directory>/scripts/phantom-state.mjs authorize --workspace <path> --scope ship-draft-pr --decision <signed.json>
node <skill-directory>/scripts/phantom-state.mjs ship --workspace <path>
```

The state helper does not accept verification or review run records and has no
parallel verification transition. Verification, evaluation, and acceptance
evidence must be declared by the compiled graph, persisted as workflow
artifacts, appended through `advance-workflow`, and checked by replay.

Missing prerequisites fail with the exact missing decision and the command that
records it. Route gates are cumulative: `direct` needs no approval, `plan`
needs plan approval, `brainstorm` needs direction approval before plan
approval, and `full` additionally needs wiring approval. Recording a new
brainstorm invalidates direction and downstream approvals; recording a new plan
invalidates plan and wiring approvals, and recording new decisions invalidates
wiring approval, so changed decisions must be approved again.

Every `approve` and `authorize` call requires a short-lived Ed25519 decision
issued by the host authority. The session pins the key id, source, and public
key digest from `${PHANTOM_DATA:-~/.phantom}/config/authority-trust.json` when
it starts. A decision binds the repository, exact task id, gate or scope,
current `worktree_fingerprint`, current approval-artifact bindings, actor,
source event, replay id, issue and expiry times, and signature. Missing trust,
expired or tampered signatures, caller-provided identity, reused replay/source
ids, and a decision replaced in lifecycle history all fail closed. The caller
cannot substitute `--by` for host authority.

Native-tool hard enforcement additionally requires a fresh signed
`capability-probe.json` in the active session directory. Only the trusted host
adapter issues or refreshes this probe; it binds the repository, task, current
worktree fingerprint, adapter contract, enforced pre/post hooks, host/source,
short lifetime, replay/source ids, pinned key, and signature. Static hook
registration and `capabilities.json` are not proof that interception is active.
The bundle contains no signer or private key and never creates its own
attestation. Missing, stale, expired, or forged probe evidence fails closed.

Every approval is bound to the corresponding current passed artifact by its
`record_sequence` and SHA-256 digest. Direction binds the current passed
`brainstorm`; plan binds the current passed `plan`; wiring binds both the
current passed `plan` and current passed `decisions` artifact because there is
no separate wiring artifact. Approval fails until those artifacts exist and
have passed. `execute` revalidates every binding. An approval without the
required binding is invalid.

The portable lifecycle enforces defect proof, route approvals, implementation
authorization, replay-bound workflow acceptance, and separate draft-PR
shipping authorization through the versioned state helper.

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
  `locks/`. Recover only an exact ordinary lock record whose owning process is
  definitely dead; never recover a migration-shaped or ambiguous record.
  Reject a second active task rather than silently replacing the current-session
  pointer. Any node at the global migration-lock path blocks reads and writes.
- Preserve `created_at` and update `updated_at` on mutation.
- Treat session artifacts as source of truth, not conversation memory.
- Pause with the exact next action, dirty-worktree state, decisions, incomplete
  checks, and blockers.
- Resume by reading instructions and corrections again, validating workspace
  identity, and checking whether recorded state is stale.
- Treat `brainstorm`, `plan`, and `decisions` artifacts as immutable once a
  workflow is compiled. A revised decision requires a new session and newly
  compiled workflow; it must never coexist with an older authoritative journal.
- Complete only when strict replay of the bound compiled plan and nonempty
  journal yields `state.status: accepted` at the current fingerprint, every
  route-required approval is still current, and the compiled approved-plan
  binding exactly matches current session state.
- Derive `ship` readiness only from replayed graph state: prerequisite
  non-external nodes are complete and a declared `git-push` or `draft-pr` node
  is legally ready. Separate signed `ship-draft-pr` authority is still required.
- Verification and review run artifacts are unsupported. Missing, empty,
  stale, or corrupt workflow evidence fails closed; only declared artifacts and
  the replayed journal can advance `ship` or `complete`.
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

The bundled state helper is the lifecycle authority. File tools may draft an
input artifact, but they must not reproduce state transitions, approvals,
authorizations, transaction recovery, workflow journal appends, or capability
claims. If command execution is unavailable, leave canonical state unchanged
and report the lifecycle operation as blocked.

Record typed delegation and observable routing diagnostics with the same
helper:

```text
node <skill-directory>/scripts/phantom-state.mjs record --workspace <path> --type delegation-task --status pending --run <run-id> --input <task-json>
node <skill-directory>/scripts/phantom-state.mjs record --workspace <path> --type delegation-result --status passed --run <run-id> --input <result-json> --actual-profile <profile> --wall-time-ms <ms> --tool-turns <count>
```

Use `--fallback-reason <text>` only when routing fell back. Omit diagnostics the
host cannot observe; the helper records them as `null` rather than guessing.
