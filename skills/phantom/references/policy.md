# Deterministic workflow policy

Author: Subash Karki

Phantom separates five decisions that must not be collapsed into prompt prose:

| Concern | Authority |
|---|---|
| Route and required gates | Router recommendation constrained by deterministic risk policy |
| Execution pattern and dependencies | Validated workflow graph |
| Role responsibility | Bounded node assignment |
| Compute profile | Capability-aware model policy |
| Authorization and side effects | Capability broker plus explicit user authority |

Models may recommend graphs, generate artifacts, implement bounded scopes, and evaluate evidence. Code owns legal transitions, schema validation, freshness and invalidation, approval bindings, budgets, retries, timeouts, idempotency, completion, journal integrity, and external-action authorization.

The compiler rejects unknown node kinds, missing dependencies, cycles, unbounded loops, invalid role assignments, unsafe parallel scopes, and policy-exceeding budgets. The reducer accepts only contract-valid events for the current state. Missing evidence never means success, and an older pass never overrides a newer failure.

Host identity affects adapters and observable capabilities only. It cannot change graph meaning, gates, schemas, acceptance, or terminal states. When an isolated branch executor is unavailable, implementation compiles to current-agent/chain semantics; it never reuses parallel branch events against a shared workspace. Other unavailable optional capabilities record their declared fallback without weakening the contract.

Machine-learning recommendations remain advisory. A learned policy may select only among deterministic policy-approved options; low confidence, missing features, distribution shift, or disagreement falls back to recorded rules or human judgment.
