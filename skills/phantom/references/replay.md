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

Historical model output is recorded data, never regenerated evidence. Signed
executor receipts and capability attestations are verified against the trust,
registration, policy, nonce, manifest, and recorded-time bindings persisted by
the original event; wall-clock expiry during a later replay does not rewrite
history. Raw signed evidence remains immutable and content-addressed while the
journal stores its digest and verified result. Capability decisions bind the
exact content-addressed request and, when authorized, reservation, trust,
registration, policy, and baseline snapshot artifacts. Signed outcomes also
bind the attestation, result, execution evidence, and workspace-after snapshot.
Digest-only capability claims and incomplete or additional evidence sets are
rejected during append and replay.

Every event artifact reference is an immutable, portable session-relative name
bound to exactly one digest. Ordinary workflow artifacts use the digest of the
file bytes. Capability artifacts are private canonical-JSON value addresses:
their path token is the SHA-256 digest of `canonicalJson(parsedValue)`, while
their exact file bytes must equal `canonicalJson(parsedValue) + "\n"`. This
preserves the capability contracts' semantic digests without allowing alternate
formatting, duplicate-key ambiguity, or byte substitution. Replay reads each
artifact as a session-contained single-link regular file; capability artifacts
must additionally have mode `0600`. Missing files, mutations, symlinks,
hardlinks, unsafe paths, digest mismatch, or rebinding an earlier reference to
new content fail closed. A retry must publish a new versioned reference rather
than overwrite historical evidence. Corrupt or reordered events and stale
manifest proofs also fail closed. A duplicated
successful capability outcome returns the recorded result and cannot repeat the
external effect. An indeterminate effect blocks retry until one signed
same-reservation reconciliation resolves it. Workflow plans, compiled
envelopes, and events require `schema_version: 2`, and parallel aggregation
requires `aggregation-result-v2`. Version-1 inputs are rejected; replay does
not synthesize missing versions or convert legacy data.

Journal and plan writes are flushed before their parent directory is flushed.
The journal lock is generation-bound: an aged live owner is never reclaimed, a
provably dead owner is reclaimable, and malformed or partial ownership becomes
eligible only after the recovery threshold. Replacement generations are not
unlinked by a stale contender. Capability reservations use the same
no-overwrite, one-shot principle; a consuming reservation without a journaled
outcome is a reconciliation condition, not permission to repeat the effect.
