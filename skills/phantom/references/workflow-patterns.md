# Workflow execution patterns

Author: Subash Karki

Phantom represents execution topology as typed workflow nodes. Patterns are internal primitives, not user-facing skills, routes, roles, or model profiles. The compiler may compose them, but the deterministic kernel alone advances their state.

## Chain

Use a chain when a later node consumes validated artifacts from an earlier node. Every input is an explicit artifact reference. A failed, missing, or stale upstream result blocks dependents; replacing an upstream artifact transitively invalidates dependent evidence and approvals. Resume selects the first incomplete node whose inputs remain current.

## Parallel

Use parallel fan-out only after dependency evidence proves scopes independent
and a trusted host executor supplies signed isolation attestation. Each branch declares its
baseline fingerprint, isolated workspace identity, allowed paths, digest-bound
dependency inputs, expected artifacts, verification, retry limit, and budget.
Aggregation derives the primary integrated snapshot, requires its changed paths
and contents to equal the branch union, and binds aggregate verification to
that snapshot. Branch boundaries reject hard-linked regular files, shared
device/inode identities, every symbolic link, primary-baseline drift, and
sibling-workspace drift as defense in depth. Snapshots cannot detect a transient
link that mutates an external inode and is restored before completion, so they
are never isolation proof. This bundle has no trusted isolated executor or
attestation verifier: production compilation and advancement of parallel branch
events therefore fail closed. Compile implementation as current-agent/chain
work; never simulate parallel branches by writing a shared tree. The parallel
schema and reducer remain available only to explicit offline contract tests.

Filesystem snapshots support at most 20,000 non-control files in this contract
slice. They do not silently exclude dependency or cache directories such as
`node_modules`; only repository control metadata is excluded by the snapshot
contract. A larger checkout fails deterministically with remediation to reduce
the checkout to 20,000 files or fewer before compiling, authorizing, advancing,
or replaying a workflow.

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
