# Fix-Loop Protocol

The canonical home of `FIX_LOOP_CEILING` and the verify/fix/re-review loop it
bounds. Split out of `reference/temperature-review.md` by B10: that file carried
two unrelated jobs — this live protocol, and a severity table that four other
files disagreed with. The ceiling is live and referenced from `agents/chief.md`,
`commands/fix.md`, `reference/contracts.md` and `reference/schemas/verification.md`,
so it gets its own file rather than living inside a document about scoring.

## Fix-Loop Ceiling

**The fix-loop ceiling is owned by `scripts/lib/constants.js`** (`FIX_LOOP_CEILING`,
default 2, env override `PHANTOM_FIX_LOOP_CEILING`), enforced by
`hooks/loop-controller.js`. This document is the PROTOCOL reference for every
verify/fix/re-review loop across Phantom — verify.md, fix.md, chief.md, start.md,
contracts.md, and reference/agent-protocols defer to constants.js for the number (so it can't
drift). Rationale for the default: the user's CLAUDE.md rule — *"if a fix attempt
fails twice with the same error class, STOP patching; the approach is wrong."*

The count is tracked by `hooks/loop-controller.js` (a deterministic counter), not by prose.
Prose describes the loop; the controller enforces the ceiling, the same-finding-class
escalation, and the explicit operator override.

## Where the count comes from

The **review round ledger** — `{SESSION_DIR}/reviews/rounds.json`, owned by
`scripts/review-round.js`. It is append-only and gains exactly one entry per
validly completed review round. Both `review-round.js status` (before a pass) and
`review-round.js close` (after one) report the standing as
`loop: { fixLoops, ceiling, source, overrideEvaluated, decision }`.

**A round is not an attempt.** Round 1 is the first review — nothing has been
fixed yet. And a later round only means a fix happened if the code CHANGED
between the two: `/phantom:review` is read-only and re-runnable, so counting
rounds alone would let three reviews of one untouched diff spend the whole
ceiling and escalate the first genuine fix. The evidence is the `fingerprint`
each entry carries (passed by `commands/review.md` from
`phantom-state.mjs fingerprint`): when every entry is stamped, the count is how
many times that fingerprint CHANGED between consecutive rounds.

Transitions, not distinct values — the difference matters for the one sequence
this repo runs on purpose. Scrap-and-redo (`commands/fix.md` step 8.5) does
`git checkout -- <touched files>`, restoring an earlier worktree, so a real
A → B → A is two attempts that collapse to two distinct fingerprints. A revert is
a fix attempt that failed, not a fix that never happened. An unstamped ledger
falls back to rounds minus one — conservative, so it can escalate a round early
but never a round late.

Three states, never conflated: a count, `null` + `source: "unknown"` when no
ledger could be read (a corrupt ledger must not hand back a ceiling's worth of
attempts), and `loop: null` when the controller itself would not load. Only the
first is a decision.

The operator override lives at `verification.json` `review.override` and is read
by `review-round.js --session {SESSION_DIR}` and by `hooks/fix-loop-gate.js`, so
the two surfaces cannot disagree about an authorized attempt. Without
`--session`, `overrideEvaluated` is `false` and the standing says so.

Nothing has to remember to increment it: the ledger the convergence rule already
writes IS the counter. That is deliberate. The counter used to be
`review.fixLoops` on `{SESSION_DIR}/verification.json`, bumped by a
`loop-controller.incrementFixLoops()` that no live path ever called — and when
verify/review moved onto the portable lifecycle, the last writer of that file
went with it. The ceiling then read a field nothing wrote, so it never fired and
the verify → review → fix → verify cycle ran unbounded. `getFixLoops()` still
reads that artifact for pre-portable sessions, as a fallback and never the
primary; `resolveFixLoops()` prefers the ledger and reports which it used.

In unattended mode, enforcement happens at the Skill-tool boundary via
`hooks/fix-loop-gate.js`, which reads the ledger first and the legacy artifact
second. An agent that keeps looping WITHOUT re-invoking `phantom:fix` is outside
that gate — but not outside the ceiling, because every re-review closes a round
and `review-round.js` reports the standing on every pass. Wrap is not a backstop
here: `commands/wrap.md` validates the recorded review artifacts and does not run
a review of its own.

## Auto-Address Loop

1. If `findings[]` is empty → verdict: pass. Write verification.json.
2. If any finding is `blocking` and not `preExisting` → spawn 1 fix agent with those
   findings scoped to it. That set is what `hooks/loop-controller.js`
   `fixLoopFindings()` returns; nothing else may enter the loop.
3. After fix → re-run correctness commands (lint, build, tests)
4. Re-review the current diff. Note what this does and does not mean: the fix
   changed the worktree fingerprint, so `commands/review.md` runs a fresh pass
   over the whole current diff — a new blocking finding anywhere in the change is
   reported, because the fix may have broken something and catching that is what
   a re-review is for. What round 2+ does NOT do is re-list advisories; B12's
   convergence rule reports those as counts. Bounding the ROUNDS is step 5's job,
   not the reviewer's.
5. Stop at the fix-loop ceiling (above; counted from the round ledger, enforced by
   `hooks/loop-controller.js`). Still blocking → escalate to user
6. Same finding class twice → escalate (don't loop on the same bug)

`advisory` findings never enter this loop, and neither does a `preExisting`
finding whatever its severity — a defect the diff did not introduce cannot be
made worse by refusing to fix it here, and holding an unrelated ship for it is
the failure mode `preExisting` exists to end. When the loop closes,
`hooks/loop-controller.js` records a `preExisting` finding as `deferred`, never
`fixed`, even if the loop happened to touch the same file.

## What Users See

Nothing during review. The review-address loop is invisible. Users see:
- Clean diff + PR if no issues found
- Escalation ONLY if a blocking finding persists past the fix-loop ceiling (above)

Advisory and pre-existing findings go in a collapsed details section in the PR
body — not action items. See `reference/wrap/pr-body.md`.

An escalation is the loop ENDING, not the loop pausing. `commands/fix.md` step 9
hands the user four options (pivot / reduce scope / accept as-is / abandon) and
waits. Re-running `/phantom:verify` in place of choosing one is how a bounded
loop becomes an unbounded one.
