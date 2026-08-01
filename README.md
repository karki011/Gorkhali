# Phantom — Deterministic Software Delivery Workflows

[![CI](https://github.com/Cloudzero/research-phantom-skills/actions/workflows/ci.yml/badge.svg)](https://github.com/Cloudzero/research-phantom-skills/actions/workflows/ci.yml)
<!-- generated:project-metadata:start -->
[![version](https://img.shields.io/badge/version-0.3.0-blue)](.claude-plugin/plugin.json)
[![tests](https://img.shields.io/badge/tests-705-brightgreen)](test/)
[![declared evals](https://img.shields.io/badge/declared_evals-51-brightgreen)](evals/)
<!-- generated:project-metadata:end -->
[![distribution](https://img.shields.io/badge/distribution-Agent%20Skills-8A2BE2)](project-docs/install.md)

**Author: Subash karki**

Phantom turns software-delivery intent into a validated workflow graph, advances
that graph through a deterministic kernel, and records every transition in a
replayable journal. Models can recommend, implement, and evaluate; code owns
legal transitions, freshness, budgets, terminal states, and authorization.

The canonical control plane lives in `skills/phantom/`. Public actions such as
`start`, `execute`, `verify`, `pause`, `resume`, and `wrap` are direct Agent
Skills in `skills/`; they apply the same portable contracts without a second
command or agent runtime.

## Core Guarantees

- **Compiled workflows.** Versioned schemas describe nodes, dependencies,
  scopes, budgets, checks, and terminal conditions. Invalid graphs, cycles,
  unsafe parallel ownership, and unbounded loops fail closed.
- **Deterministic execution and replay.** The same pure reducer handles live
  events and replay. The digest-chained journal is authoritative; materialized
  state can be rebuilt without model or external calls.
- **Explicit effect policy.** Workspace writes, process execution, commits,
  pushes, draft pull requests, and tracker comments use typed capability
  requests. Authorization, scope, freshness, budget, and idempotency are
  checked before execution. `process.exec` is unconditionally denied in this
  release; registration alone cannot enable it.
- **Risk-selected evidence.** The workflow declares the checks it needs. An
  independent evaluator is added only when risk, topology, or a measurable
  rubric requires one, and every supported finding remains in the record.
- **Portable state.** Sessions, approvals, evidence, learnings, and workflow
  journals use a neutral data root and stable repository identity.
- **Optional delegation.** Phantom chooses the smallest useful topology after
  dependency inspection. Native workers accelerate independent scopes; a
  sequential fallback preserves the same contracts and gates.

## Control Flow

```text
user intent
    │
    ▼
route recommendation ──► validated workflow plan
                              │
                              ▼
                      deterministic kernel
                              │
                ┌─────────────┴─────────────┐
                ▼                           ▼
       bounded local work          typed capability request
                │                           │
                └─────────────┬─────────────┘
                              ▼
                    digest-chained journal
                              │
                              ▼
                    replayable workflow state
```

Routing selects required gates and artifacts, not a worker count:

| Route | Typical signal | Required decision flow |
|---|---|---|
| `direct` | Clear, low-risk, high-confidence change | Context, implementation authorization, required checks |
| `plan` | Clear outcome with dependencies | Plan approval, implementation authorization, execute, required checks |
| `brainstorm` | Ambiguous outcome or low confidence | Direction approval, plan approval, implementation authorization |
| `full` | Broad, critical, irreversible, or security-sensitive work | Direction, plan, wiring, implementation authorization, staged execution |

Starting or executing work never grants authority to commit, push, open a pull
request, comment on a tracker, or perform another external action. Each effect
must be represented by the workflow and separately authorized. `wrap` can
request an idempotent draft pull request only when that exact authority and
current evidence exist.

For reported defects, Phantom first records reproduction evidence, the traced
code path, a falsifiable root cause, and user confirmation. Implementation
remains blocked until the defect-proof contract is complete.

## Quick Start

Install the repository's `skills/` tree in an Agent Skills discovery directory,
or install the plugin distribution. Then ask naturally:

```text
Use Phantom to implement this feature and verify the result.
Use Phantom to investigate this regression without changing code yet.
Use Phantom to pause this work and preserve a resumable checkpoint.
Use Phantom to wrap the verified work; do not perform external actions unless I approve them.
```

Direct actions are listed in [Actions](project-docs/actions.md). Installation
and update paths are in [Install](project-docs/install.md).

## Runtime Readiness

The Codex manifest points to `hooks/hooks.json`; the Claude plugin loads the
same root hook file by convention. Registration alone is not proof that
interception is live. A trusted host must provision the public-key trust record
and externally issue short-lived signed probes; Phantom contains no private
key, signer, or self-attestation path.

The bundled native adapter handles reservation-bound workspace writes only.
Native shell and process tools are not command executors. `process.exec` stays
denied until a separately versioned, signed sandbox-executor attestation and
enforcement contract exists; merely registering an adapter or capability does
not enable it. Only exact trusted Phantom control-plane commands are exempt.

This distribution does not register executors for `git.commit`, `git.push`,
`github.openDraftPr`, or `tracker.comment`. Those effects remain unavailable
until a host supplies an explicit adapter to the typed execution API. An
authorization record by itself never executes an external action.

Inspect the current boundary without changing state:

```bash
node hooks/capability-gate.mjs doctor /path/to/workspace
```

The doctor reports the session/workflow/probe state and the bundled versus
unregistered executors. An active session with missing or corrupt compiled
workflow evidence is blocked; a workspace with no Phantom session remains
outside the boundary.

## Documentation

| Document | What it covers |
|---|---|
| [Install](project-docs/install.md) | Agent Skills and plugin installation |
| [Architecture](project-docs/architecture.md) | Compiler, kernel, journal, replay, and capability boundary |
| [Code Structure](project-docs/code-structure.md) | Repository and portable-state layout |
| [Roles and Compute](project-docs/roles.md) | Conditional role passes, topology, profiles, and evaluation |
| [Actions](project-docs/actions.md) | Direct public Agent Skill entrypoints |
| [Configuration](project-docs/configuration.md) | Layered configuration and user-facing environment variables |
| [Portable Skill](project-docs/portable-skill.md) | The provider-neutral contract and capability fallbacks |
| [ROADMAP](ROADMAP.md) | Backlog, decisions, and measured baseline |

## Author

Subash karki
