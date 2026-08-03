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

Validation is derived from independently recorded outcomes, never from a model's
judgment that a learning helped. A learning earns one count per distinct session
that did both of these things:

1. Cited it. The session-level citation field is `learningsCited: string[]`, an
   array of entry keywords on the `context` artifact's evidence.
2. Recorded an observed pass. The session's `verification` artifact must carry
   verdict `pass` **and** `correctness.observations.tests` exactly
   `checked:pass`. A verdict alone is a claim; only the observation is a
   measurement. `not_observed` and `checked:fail` never count.

The count is a set size recomputed from artifacts on every run, so re-running
cannot inflate it and no ledger is needed for idempotence. A tag written on disk
acts as a manual floor: the effective count is the higher of the tag and the
computed value.

### How a citation reaches the artifact

The component that knows which entries were injected is the recall hook, and it
runs before a session directory exists. It therefore records its selection under
the host session id, and the state helper performs the join when it writes the
context artifact:

| Step | Producer | Output |
|---|---|---|
| Injection | recall hook on prompt submit | `state/recall/<repo>/<session-id>.json` |
| Session identity | session marker on prompt submit | `state/session-telemetry/<repo>.json` |
| Join | state helper `record --type context` | `context.json` evidence `learningsCited` |
| Credit | lifecycle runner | count per keyword across qualifying sessions |

Citations accumulate across every prompt in one host session and stay separate
between sessions, because the unit of credit is the session, not the prompt.

The caller never supplies `learningsCited`. Attribution that depends on a model
remembering to report it is attribution that silently goes missing, so the join
is mechanical.

### Scheduling

The lifecycle runs automatically after a turn settles, throttled to at most once
per day per repository. Verification is only final once a turn ends, so an
earlier run would credit unverified work; a per-turn run would rescan every
session and every learnings file for nothing. The automatic path passes no
mutation flag, so it can promote and report but never delete. Pruning stays an
explicit operator action.
