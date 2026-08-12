# Capability contract

Treat capabilities as runtime facts, not provider identities. Build the ledger
from exposed tools and instructions. Do not probe with writes, network calls, or
other side effects.

## Ledger

Record each value as `available`, `unavailable`, or `unknown`:

```json
{
  "schema_version": 1,
  "capabilities": {
    "workspace.read": "available",
    "workspace.write": "unknown",
    "search.text": "available",
    "process.exec": "unknown",
    "version_control": "unknown",
    "delegation.spawn": "unavailable",
    "delegation.parallel": "unavailable",
    "delegation.model_select": "unavailable",
    "web.fetch": "unknown",
    "browser.visual": "unknown",
    "dependency.graph": "unknown",
    "issue.tracker": "unknown",
    "review.publish": "unknown",
    "lifecycle.hooks": "unavailable",
    "state.persist": "unknown"
  }
}
```

An unknown optional capability behaves as unavailable until safely discovered.
Re-evaluate the ledger when the runtime exposes a new ability.

## Native delegation boundary

Mark `delegation.spawn` available only when the runtime exposes a dedicated
native mechanism for bounded worker contexts or sessions. Command execution by
itself does not provide delegation. Never recursively launch another copy of
the current runtime, strip nesting protections, or treat an arbitrary subprocess
as a portable worker.

Mark `delegation.parallel` available only when multiple native workers can run
concurrently and their completion can be observed. Mark
`delegation.model_select` available only when the spawn mechanism accepts a
per-worker compute selection. A runtime-required approval is a boundary to
honor, not a guard to bypass: request it after Apex selects delegation; if it is
denied or cannot be surfaced, apply the sequential fallback. Apex performs this
negotiation automatically and records the chosen topology and fallback.

## Required baseline

Core planning requires instruction following and enough workspace visibility to
understand the requested scope. Implementation additionally requires a write
mechanism. Automated verification requires command execution or an equivalent
test facility. State continuity requires file persistence.

If a required capability is missing, stop only the affected stage. A runtime
without writes can still investigate and plan. A runtime without command
execution can still make a user-authorized file edit, but it cannot claim that
automated checks passed.

## Equivalent behavior

Optional capabilities may change speed or evidence quality; they must not
change artifact schemas, approval gates, route semantics, or completion rules.

| Capability | Enhanced behavior | Portable fallback |
|---|---|---|
| Delegation | Give bounded passes to independent workers through the native runtime. | Run labeled passes sequentially with fresh review context. |
| Parallelism | Run dependency-independent passes together. | Preserve dependency order and run them one at a time. |
| Compute selection | Request the role's semantic profile. | Inherit the active model with no selector. |
| Dependency graph | Query related files and blast radius. | Run the bundled one-shot analyzer through command execution, then manually supplement partial coverage. Without command execution, search definitions, references, imports, tests, and history. |
| Hooks | Enforce checkpoints automatically. | Execute and record checkpoints explicitly. |
| Visual presentation | Prepare routes, states, and optional captures for the user to inspect. | Present the same checklist in chat and wait for explicit user confirmation. |
| Web research | Verify current external facts. | Ask for supplied sources or mark the claim unverified. |
| Issue integration | Read and update lifecycle state directly. | Use user-provided context and prepare an update for publishing. |
| Review publishing | Create or update a review request. | Prepare title, body, evidence, and exact next action. |

Record every fallback used in the session capability artifact. Never silently
convert an unavailable check into a pass.

The bundled dependency analyzer is portable baseline behavior supplied by the
skill, not a separately registered capability. It reads supported source files,
builds a bounded import graph for the current invocation, emits JSON, and exits.
It does not require a server, daemon, persistent index, lifecycle hook, or
provider-specific integration. Native graph capabilities may replace this scan
when available, but must preserve the same planning and verification gates.
