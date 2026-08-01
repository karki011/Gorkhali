# Learning lifecycle

Author: Subash Karki

This portable reference defines the learning-retention contract implemented by
`scripts/evolution-runner.js` in the repository maintenance tooling. It does not
define workflow, delegation, shipping, or prompt policy.

## Retention classes

| Class | Retention |
|---|---|
| `[failed]` | Protected from date-based deletion. |
| `[validated:N]` at or above the promotion threshold | Retained. |
| `[validated:N]` below the threshold | Eligible for stale and removal windows. |
| `[proposed]` or untagged | Unproven and eligible for stale and removal windows. |

Never delete `[failed]` entries unless the operator supplies both `--prune` and `--prune-failed`.

## Mutation controls

**Removal is report-only by default.** A run without mutation flags reports the
candidate set and writes nothing.

- `--prune` authorizes removal of ordinary expired entries.
- `--prune-failed` additionally releases protected corrections and has no
  effect without `--prune`.

Before a write, the runner re-reads each source and compares it byte-for-byte
with the scanned input. A changed source is skipped so stale offsets cannot
overwrite concurrent work.

## Computed validation

Validation is derived from independently recorded outcomes. The intended
session-level citation field is `learningsCited: string[]`; until that field
exists, the runner must report the evidence gap instead of inventing
attribution. Re-running the computation cannot increase a count without a new
distinct qualifying session.
