# Portable Agent Skill

`skills/phantom/` is the canonical provider-neutral control plane. The sibling
directories under `skills/` are direct public actions that apply that contract
without introducing a second policy layer.

## Contract Bundle

The canonical directory contains:

- `SKILL.md` for invariants, routing, lifecycle, delegation, and verification;
- `manifest.json` for the authoritative contract registry, with each contract's
  version, owned resources, and the registry-derived resource digest;
- `references/` for workflow, policy, replay, capability, role, model, state,
  planning, and verification contracts;
- `schemas/` for workflow plans, events, aggregation, evaluation, capability
  requests, signed authority decisions, and signed interception probes; and
- `scripts/` for compilation, transition, replay, capability authorization,
  session state, profile resolution, and bounded impact inspection.

The bundle has zero external plugin dependencies. Its enforcement helpers use
Node.js and the standard library.

The validator derives the resource digest from that registry. A missing
registered file, unregistered public schema, duplicate schema owner, malformed
registry entry, or stale digest fails validation.

## Deterministic Control Plane

Models may recommend a route, propose a graph, implement a bounded scope, or
evaluate recorded evidence. They do not own transitions. The compiler validates
the graph, the kernel reduces typed events, the journal records the digest
chain, and replay reconstructs the same state without asking a model to recreate
history.

Consequential operations use one typed capability boundary. Missing runtime
capability, authorization, scope, freshness, budget, or idempotency evidence
denies the request. A public action, role, or host adapter cannot create an
alternate side-effect path.

Approvals and lifecycle authorizations accept only short-lived, Ed25519-signed
host decisions bound to the canonical repository, exact task, current
fingerprint, gate/scope, and approval artifacts. Caller-supplied identity and
bare approve/authorize commands are rejected.

When the host loads them, provider-neutral PreToolUse/PostToolUse adapters turn
authorized native workspace writes into one-shot durable reservations. They
normalize common file mutation shapes, enforce the protected-branch union and exact request
binding, and journal an outcome.
Unknown consequential tools and
shell-string commands fail closed during an active compiled workflow. A crash
after claim leaves an explicit reconciliation record rather than reusable
authority.

No command adapter is active. `process.exec` is unconditionally denied until a
separately versioned, signed sandbox attestation and enforcement contract
exists; registration alone cannot enable it. Exact trusted Phantom
control-plane invocations are the only exception.

The trusted host adapter must issue and refresh a short-lived, signed
`capability-probe.json` bound to the current fingerprint and enforced pre/post
hooks. Static hook registration is not runtime evidence. The bundle contains
no private key, signer, or self-attestation path.

No sandboxed command, external Git, pull-request, or tracker executor is
bundled. Those capabilities require an explicitly supplied adapter and
otherwise remain unavailable even when policy authorization succeeds. The
read-only `hooks/capability-gate.mjs doctor <workspace>` status distinguishes
registered native hook support, external probe issuance, and unregistered
executors.

No isolated branch executor or signed isolation attestation verifier is
bundled. Production compilation rejects parallel workflow nodes before writing
the compiled plan or journal; hosts must lower write-bearing fan-out to
current-agent or sequential chain execution.

## Capability Adaptation

At task start, Phantom records capabilities as `available`, `unavailable`, or
`unknown`. Optional capabilities change scheduling or evidence quality, never
artifact meaning or safety:

| Capability | Portable fallback |
|---|---|
| Native delegation | Current-context or labeled sequential execution of required nodes |
| Native parallelism | Compile implementation as current-agent/chain work; do not materialize shared-tree parallel branches |
| Per-worker model selection | Inherit the active model |
| Native dependency graph | Run the bundled one-shot impact analyzer and supplement partial coverage with references and history |
| Visual inspection | Run static checks and record missing visual evidence |
| Issue or review integration | Prepare the bounded request and leave the external effect unperformed |

Unknown optional capabilities behave as unavailable until safely discovered.
Missing evidence never becomes a pass.

## Direct Actions

Every `skills/<action>/SKILL.md` contains a portable action declaration and
action-specific constraints. For example, `start` can plan and implement but
cannot grant shipping authority; `verify` records checks but cannot repair;
`review` reports findings but cannot edit; and `wrap` can request a draft pull
request only through separately authorized capability policy.

The complete registry is documented in [Actions](actions.md) and checked by
`scripts/validate-portable-skill.mjs` so a published entrypoint cannot drift
back to another runtime authority.

## Compute Policy

Phantom requests semantic profiles (`inherit`, `economy`, `balanced`, `deep`,
or `frontier`) after topology is known. Concrete host mappings are confined to
the data-only preset registry. Effort is profile-specific and should be changed
from isolated evaluation evidence, not imposed universally. If selection is
unavailable, Phantom inherits the active model without weakening the workflow.
