# Workflow journal and replay

Author: Subash Karki

Each workflow owns an append-only event journal. Events carry a sequence, the previous event digest, their payload digest, workflow and node identity, producer, artifact references, and the current worktree fingerprint. The journal is the audit source; `state.json` is a replaceable materialized view.

Replay performs no model or external tool calls. It must:

1. validate the workflow plan and its digest;
2. parse every event without recovery or shape conversion;
3. verify sequence order, previous-digest continuity, event and payload digests, workflow identity, and node identity;
4. apply every event through the same pure reducer used during live execution;
5. reject illegal, contradictory, duplicate, or stale transitions; and
6. return the reconstructed state plus the same next legal transitions as live execution.

Historical model output is recorded data, never regenerated evidence. Corrupt or reordered journals fail closed. A duplicated successful capability outcome returns the recorded result and cannot repeat the external effect. Fresh contract versions are mandatory; replay does not synthesize missing versions or convert legacy events.

Journal and plan writes are flushed before their parent directory is flushed.
The journal lock is generation-bound: an aged live owner is never reclaimed, a
provably dead owner is reclaimable, and malformed or partial ownership becomes
eligible only after the recovery threshold. Replacement generations are not
unlinked by a stale contender. Capability reservations use the same
no-overwrite, one-shot principle; a consuming reservation without a journaled
outcome is a reconciliation condition, not permission to repeat the effect.
