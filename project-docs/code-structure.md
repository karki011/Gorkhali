# Code Structure

The repository has one canonical workflow contract and a set of thin public
Agent Skill entrypoints.

```text
skills/
├── phantom/
│   ├── SKILL.md                  # portable policy and lifecycle contract
│   ├── manifest.json             # versioned contract/resource registry + digest
│   ├── references/               # policy, workflows, roles, replay, QA
│   ├── schemas/                  # workflow, event, aggregation, evaluation, capability, authority
│   └── scripts/
│       ├── compile-workflow.mjs   # validate and persist a workflow graph
│       ├── advance-workflow.mjs   # append a typed event through the kernel
│       ├── replay-workflow.mjs    # reconstruct state from the journal
│       ├── authorize-capability.mjs
│       ├── phantom-state.mjs      # sessions, approvals, evidence, lifecycle
│       ├── migrate-session-state.mjs # offline manifest-bound v1-to-v2 cutover
│       ├── phantom-doctor.mjs     # read-only readiness and migration detection
│       └── lib/                   # contracts, reducer, journal, shared state
│           └── session-migration/ # atomic journal and durable publication
├── start/SKILL.md                # direct public actions
├── execute/SKILL.md
├── verify/SKILL.md
└── ...

.claude-plugin/                   # distribution metadata
.codex-plugin/                    # distribution metadata and skills path
hooks/                            # branch/capability enforcement plus narrow telemetry adapters
scripts/                          # repository maintenance, evaluation, release tools
evals/                            # isolated skill-routing evaluation cases
test/                             # deterministic contract and integration tests
project-docs/                     # product documentation
```

Each public action reads `skills/phantom/SKILL.md`, names one portable action,
and adds only action-specific constraints. There is no separate command tree,
persona tree, or compatibility resolver.

## Portable Workflow Files

The control-plane implementation is split by responsibility:

- `schemas/workflow-plan.schema.json` defines graphs, dependencies, scopes,
  budgets, evaluation policy, and external-action nodes.
- `scripts/lib/workflow-contracts.mjs` validates plans and events.
- `scripts/lib/workflow-kernel.mjs` is the pure reducer and legal-transition
  authority.
- `scripts/lib/workflow-journal.mjs` writes and validates the digest chain and
  materialized state.
- `scripts/lib/capability-contracts.mjs` validates effect requests,
  authorization, scope, budget, freshness, and idempotency.
- `scripts/lib/authority-decision.mjs` verifies pinned Ed25519 host decisions
  and interception probes.
- `scripts/phantom-doctor.mjs` stable-reads the canonical active runtime and
  emits the sanitized schema-version-3 native, signed-host, isolated, and
  migration readiness report. It bundles verifiers, not execution backends,
  and never changes state.
- `scripts/migrate-session-state.mjs` inventories the selected Phantom root
  without changing Phantom state, then applies, verifies, or rolls back a reviewed,
  digest-bound v1-to-v2 manifest. Canonical paths, physical hierarchy, runtime
  path resolution, source content, and the committed pointer are revalidated.
- `scripts/lib/legacy-session-classifier.mjs` keeps Doctor and migration
  classifications identical without adding a runtime v1 fallback.
- `scripts/lib/session-migration/atomic-journal.mjs` validates bounded,
  digest-chained recovery evidence and exact lock generations.
- `scripts/lib/session-migration/durable-publication.mjs` provides crash-safe,
  no-replace publication and replacement under a validated migration lease.
- `scripts/phantom-state.mjs` owns session identity, approvals, evidence, and
  lifecycle gates without advancing workflow nodes.
- `hooks/capability-gate.mjs` normalizes provider-native workspace writes,
  consumes one exact reservation before an effect, protects the append-only
  control-input channel, and exposes the read-only host-adapter doctor status.
  Native process execution remains denied. Externally provisioned process and
  Git/GitHub/tracker adapters use strict registry trust, short-lived session
  registration, one-time reservations, and signed result attestations.

## Mutable State

Mutable state is outside the installed skills:

```text
${PHANTOM_DATA:-~/.phantom}/
├── config/authority-trust.json
├── config/host-adapter-registry-trust.json
├── state/current-session/{repo-id}.json
├── state/session-telemetry/{repo-id}.json
├── repos/{repo-id}/
│   ├── sessions/{task-path-segment}/
│   │   ├── session.json
│   │   ├── intent.json
│   │   ├── capabilities.json
│   │   ├── capability-probe.json
│   │   ├── host-adapter-registration.json
│   │   ├── plan.json
│   │   ├── workflow/
│   │   │   ├── plan.json
│   │   │   ├── events.jsonl
│   │   │   └── state.json
│   │   ├── capability/artifacts/{registry-trust,registrations,attestations,workspace-manifests}/
│   │   ├── capability/reservations/{pending,consuming,indeterminate,completed}/
│   │   └── runs/
│   ├── completed/{task-path-segment}/
│   └── learnings/
├── global/patterns/
├── migrations/session-state/{migration-digest}/ # manifest, backups, history, journal, rollback
├── audit/
└── locks/
```

The journal is authoritative for workflow transitions. Session JSON is
authoritative for lifecycle approval and authorization. Generated review HTML
and materialized workflow state are disposable projections, never sources of
truth.

The global session-state migration lock is an absolute runtime read/write
barrier regardless of node type or owner liveness. Runtime recovery applies
only to an exact ordinary per-repository lifecycle lock with a dead owner;
migration recovery belongs exclusively to the manifest-bound migrator.
