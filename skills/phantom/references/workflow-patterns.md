# Workflow execution patterns

Author: Subash Karki

Phantom represents execution topology as typed workflow nodes. Patterns are internal primitives, not user-facing skills, routes, roles, or model profiles. The compiler may compose them, but the deterministic kernel alone advances their state.

## Chain

Use a chain when a later node consumes validated artifacts from an earlier node. Every input is an explicit artifact reference. A failed, missing, or stale upstream result blocks dependents; replacing an upstream artifact transitively invalidates dependent evidence and approvals. Resume selects the first incomplete node whose inputs remain current.

## Parallel

Use parallel fan-out only after dependency evidence proves scopes independent
and a trusted host executor supplies a current signed isolation probe. The
compiler snapshots the host workspace, proves the session fingerprint describes
that same content, and injects a pinned executor/trust/profile/baseline binding;
model-authored bindings are rejected. Each branch declares its isolated
workspace identity, lease, run, allowed paths, dependency inputs, expected
artifacts, verification, retry limit, and budget.

Only `execute-parallel.mjs` may ingest branch-start, branch-completion, retry,
and integration receipts. It verifies the pinned Ed25519 signer, exact run and
lease lineage, compact v2 manifests and deltas, full content-addressed
changed-shard proofs, artifact bytes and schemas, process teardown, and the
integrated content-plus-physical change evidence. Scope checks use the combined
path set, while fan-in independently requires the exact authorized content-path
union and physical-path union. It then compares portable hardlink alias
equivalence classes, including each alias set and link count, so equal bytes or
equal per-file link counts cannot substitute a different physical topology.
Ordinary workflow advancement rejects these events. A retry receives a fresh
run, lease, and workspace after signed teardown; successful sibling branches
are retained only while their inputs remain current.

The authoritative main worktree must still equal the compiled parallel
baseline when the node starts, when any branch starts or retries, and immediately
before fan-in. An upstream or late authorized mutation, or a later parallel
stage after an earlier stage advances the tree, fails closed. The host must
compile a fresh workflow for the new baseline or use current-agent chain work;
an old branch envelope is never silently rebased. Receipt ingestion independently
recomputes both live content and portable physical-topology evidence, so
unjournaled byte or hardlink drift cannot cross the executor boundary.

Filesystem evidence uses 256 deterministic content and physical shards. It
includes tracked, untracked, and ignored files, excludes only repository control
state, rejects special and non-portable paths, and has no file-count ceiling.
An opaque generation cache can skip hashing unchanged bytes but cannot change
the manifest result; all observed generations are revalidated before evidence
is published. Raw physical roots expose local inode evidence, while portable
topology roots commit the same alias memberships without embedding host device
or inode numbers. Every physical shard and compact shard reference requires a
portable `topology_digest`; the compact root is recomputed from those digests,
and full-manifest verification derives them again from raw identity groups.
There is no optional three-field physical reference or compatibility reader.

The bundle verifies executor trust, probes, receipts, and aggregation but does
not provide or claim an OS isolation backend or signing key. A host must
provision that external boundary. Without it, a parallel graph fails before the
plan or journal is written and the workflow must be compiled as current-agent
chain work; parallel envelopes are never simulated against a shared tree.

## Routing

Routing selects required gates and artifacts: `direct`, `plan`, `brainstorm`, or `full`. It does not select worker count. A route recommendation records confidence and signals; deterministic policy rejects critical work routed to `direct`, implementation without confirmed defect proof, parallelism with unknown dependency impact, unattended work without testable acceptance criteria, and low-confidence decisions without the declared fallback.

## Orchestrator-workers

Apex may decompose approved work, assign bounded scopes, synthesize valid results, retry a failed scope within limits, and escalate uncertainty. It may not approve or verify its own artifact, expand a worker's paths, override budgets, infer a pass from missing evidence, or authorize an external effect. Delegation uses the versioned task and result envelopes. One malformed result receives one correction attempt, then escalates.

## Evaluator-optimizer

Use an evaluator loop only when a measurable rubric exists and refinement can materially change acceptance. It declares `evaluation-result-v1` plus exact iteration, duration, cost, and repeated-failure limits. Deterministic checks precede independent evaluation. The evaluator records evidence and a failure classification; policy decides acceptance and whether one scoped retry is legal.

Terminal states are:

```text
accepted
rejected
budget_exhausted
iteration_limit
stuck_same_failure
missing_evidence
human_decision_required
```

Improvement suggestions alone never continue the loop.

## Composition

A planned feature can compile to a chain for inspection and planning, a
parallel implementation node, deterministic aggregation, and a bounded
evaluator node. Pattern composition never weakens each node's artifact,
freshness, budget, authorization, or terminal-state contract. A sequential
host fallback must compile current-agent/chain nodes; it cannot reuse the
isolated parallel-branch envelope against a shared workspace.
