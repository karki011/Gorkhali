# Architecture

Phantom is a provider-neutral workflow control plane. A model proposes work and
produces bounded artifacts; deterministic code decides whether those artifacts
may advance the workflow.

## Authority Boundaries

| Concern | Authority |
|---|---|
| Route recommendation | Model reasoning constrained by deterministic risk policy |
| Gates, dependencies, scopes, and budgets | Validated workflow graph |
| Legal state transitions | Pure workflow reducer |
| Historical truth | Append-only digest-chained journal |
| Materialized progress | Replayable workflow state |
| Lifecycle approvals and authorization | Pinned, short-lived Ed25519 host decisions |
| Consequential-operation authorization | Typed capability broker |
| Native workspace execution | Registered pre/post hooks plus a current signed host probe |
| Native command execution | None; exact trusted Phantom control-plane invocations only |
| Build and test execution | Explicit host-supplied sandboxed executor; none is bundled |
| Git, pull-request, and tracker execution | Explicit host-supplied adapter; none is bundled |
| Scheduling and compute | Capability-aware topology and semantic profile policy |

Host identity affects discovery and available capabilities only. It does not
change graph meaning, artifact schemas, approvals, acceptance, or terminal
states.

## Compile, Advance, Replay

The workflow compiler accepts a versioned plan and validates node kinds,
dependencies, acyclicity, role assignments, ownership, budgets, checks, and
terminal conditions. A route recommendation cannot advance work until this
contract passes.

The kernel receives typed events such as node start, evidence, completion,
failure, invalidation, and capability outcome. It accepts only transitions legal
for the current state and rejects missing, stale, contradictory, duplicate, or
out-of-scope evidence.

Every accepted event is appended to `workflow/events.jsonl` with a sequence,
previous digest, payload digest, workflow identity, node identity, producer,
artifact references, and worktree fingerprint. `workflow/state.json` is a
replaceable view derived from that journal.

Replay validates the plan and the entire digest chain, then applies every event
through the same reducer used live and verifies the immutable bytes of every
referenced session artifact. It performs no model or external calls. Missing,
rebound, linked, corrupt, reordered, or illegal history fails closed.

## Workflow Patterns

Patterns are internal graph primitives, not public actions or permanent worker
teams.

- **Chain:** a downstream node starts only when its declared upstream artifacts
  exist and remain current. Replacing upstream evidence transitively invalidates
  dependents.
- **Parallel:** fan-out is legal only for dependency-independent, non-overlapping
  scopes. Aggregation separately proves the exact content and physical path
  unions plus portable hardlink alias equivalence. The compiler pins the host
  snapshot digest, content-manifest digest, and physical topology; every signed
  receipt binds its baseline and current manifests to the claimed fingerprints.
  Any main-worktree divergence requires a fresh compilation or chain fallback.
- **Routing:** `direct`, `plan`, `brainstorm`, and `full` select gates and
  artifacts. They do not select a worker count.
- **Orchestrator-workers:** approved work may be decomposed into bounded typed
  assignments. Delegates cannot expand scope, approve their own artifacts, or
  authorize effects.
- **Evaluator-optimizer:** measurable refinement is bounded by acceptance,
  evidence, iterations, repeated failure class, duration, spend, and human
  judgment. Improvement suggestions alone never continue the loop.

Evaluation route truth is review-attributed and digest-bound. Its mutable
review metadata is not a signature or cryptographic proof of reviewer
independence.

## Capability Broker

The broker is the only policy boundary for consequential operations. Each
request binds the active session, workflow, node, worktree fingerprint, allowed
paths or commands, runtime capability, budget, user authorization, and
idempotency key.

Authorization reserves the request's full declared cost and duration; the first
outcome moves that exact charge from reserved to consumed once. Any unresolved
or indeterminate effect freezes every other workflow transition. Invalidating a
completed external action preserves its exact successful effect evidence, so
recovery never repeats the provider operation.

The user authorization is a verified host decision, not a model claim or
caller-provided identity. The broker binds its decision digest and a fresh
signed host-interception probe digest into a durable reservation.
When loaded by the host, provider-neutral pre/post hooks prove that exact
reservation for native workspace writes, consume it once, and record the
outcome.
Unknown consequential tools, unavailable hard enforcement, and unprovable
shell-string argv fail closed. A consumed reservation with no outcome requires
reconciliation and cannot be replayed.

The trusted host adapter—not the plugin—issues and refreshes the probe for the
current task and worktree fingerprint. Static hook registration is not runtime
evidence, and the bundle contains no signer, private key, or self-attestation
mechanism. The current distribution includes strict adapter registration,
reservation, attestation, and reconciliation verification, but no sandbox,
Git/GitHub/tracker backend, provider credential, signer, or private key. Those
requests cannot execute without a matching externally provisioned adapter.

Supported request types include workspace writes, process execution, commits,
pushes, draft pull requests, and tracker comments. Native process and Git paths
remain denied. A signed host adapter may execute only its registered typed
contract; process sandboxes deny network and provider credentials and protect
repository control state, so stronger effects cannot tunnel through
`process.exec`. External requests must also come from the matching
external-action node. A successful outcome is immutable; an identical retry
returns the recorded effect, while key reuse with different content is denied.

See the canonical contracts in
[`skills/phantom/references/policy.md`](../skills/phantom/references/policy.md),
[`workflow-patterns.md`](../skills/phantom/references/workflow-patterns.md),
[`replay.md`](../skills/phantom/references/replay.md), and
[`capability-broker.md`](../skills/phantom/references/capability-broker.md).

## Host Adapter Status

`node skills/phantom/scripts/phantom-doctor.mjs --workspace <workspace>`
inspects canonical current-session state and reports the boundary without
changing state. Its schema-version-3, redacted report includes a migration
descriptor; legacy v1 state blocks readiness and points to the separate
`migrate-session-state.mjs inventory --output <manifest>` command rather than
changing state. The native hook doctor projects the same readiness contract:

| Surface | Bundled status |
|---|---|
| Native workspace executor | Hook contract registered; requires host-loaded hooks and a valid signed probe |
| Native command executor | None; trusted control-plane invocations only |
| Sandboxed build/test executor | Signed contract verifier bundled; external sandbox, registration, and signer required |
| Isolated branch executor | Trust/probe/receipt verifier bundled; external OS isolation backend and signer required |
| Git commit executor | Signed typed contract verifier bundled; external adapter required |
| Signed probe issuer | External and required; no signer or private key is bundled |
| Git push executor | Signed typed contract verifier bundled; external adapter required |
| Draft pull-request executor | Signed typed contract verifier bundled; external adapter required |
| Tracker-comment executor | Signed typed contract verifier bundled; external adapter required |

No-session workspaces are outside the interception boundary. Once a canonical
active session exists, missing or corrupt compiled plans and journal evidence
fail closed in both pre- and post-tool phases.

## Durable State and Freshness

Portable session state lives under `${PHANTOM_DATA:-~/.phantom}`. Approvals bind
exact artifact sequences and digests. Verification, review, and capability
decisions bind the current worktree fingerprint. Later changes make earlier
evidence stale instead of silently carrying it forward.

Runtime readers accept schema version 2 only; `bundle_version` is SemVer
provenance, not a compatibility switch. The explicit offline migrator
inventories the selected data root without changing Phantom state, writes the
full manifest privately through `--output`, and prints only a redacted receipt.
Apply accepts only the reviewed exact manifest with its recorded inactivity and
work-kind decisions. It binds canonical and physical workspace,
data/state/repository/source, runtime-path, and committed-pointer identity;
bounded locks and inventory/file/journal budgets fail closed. Completed v1
sessions are archived as history, other source evidence is archived or
quarantined as classified, and clean paused successors are activated for
eligible continuations with all authority and evidence reset. Backups precede
mutation, pointer cutover is last, and rollback refuses if migration outputs
changed after cutover.

The migrator combines a digest-chained atomic journal with crash-safe durable
publication. Interrupted work resumes only when the same manifest, physical
lock generations, and recovery claim chain remain trusted; it never guesses
from a partially published pointer.

Any node at the global migration-lock path blocks runtime readers, writers, and
Doctor until the exact migrator resumes or completes recovery. Runtime recovers
only a well-formed ordinary per-repository lifecycle lock with a definitely dead
owner. After verified lock release, the successor is readable by the ordinary
v2 runtime and Doctor; no v1 fallback or silent auto-migration exists.

The session helper owns task discovery, approvals, and user authorization. The
workflow kernel alone advances graph nodes. This separation prevents a session
record, worker, or host adapter from becoming a second transition authority.
