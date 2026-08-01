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
│       └── lib/                   # contracts, reducer, journal, shared state
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
- `scripts/phantom-state.mjs` owns session identity, approvals, evidence, and
  lifecycle gates without advancing workflow nodes.
- `hooks/capability-gate.mjs` normalizes provider-native workspace writes,
  consumes one exact reservation before an effect, protects the append-only
  control-input channel, and exposes the read-only host-adapter doctor status.
  Process execution is denied until a versioned signed sandbox enforcement
  contract exists; adapter registration alone is insufficient.

## Mutable State

Mutable state is outside the installed skills:

```text
${PHANTOM_DATA:-~/.phantom}/
├── config/authority-trust.json
├── state/current-session/{repo-id}.json
├── state/session-telemetry/{repo-id}.json
├── repos/{repo-id}/
│   ├── sessions/{task-path-segment}/
│   │   ├── session.json
│   │   ├── intent.json
│   │   ├── capabilities.json
│   │   ├── capability-probe.json
│   │   ├── plan.json
│   │   ├── workflow/
│   │   │   ├── plan.json
│   │   │   ├── events.jsonl
│   │   │   └── state.json
│   │   ├── capability/reservations/{pending,consuming,completed}/
│   │   └── runs/
│   ├── completed/{task-path-segment}/
│   └── learnings/
├── global/patterns/
├── audit/
└── locks/
```

The journal is authoritative for workflow transitions. Session JSON is
authoritative for lifecycle approval and authorization. Generated review HTML
and materialized workflow state are disposable projections, never sources of
truth.
