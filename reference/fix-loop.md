# Fix-Loop Protocol

The canonical home of `FIX_LOOP_CEILING` and the verify/fix/re-review loop it
bounds. Split out of `reference/temperature-review.md` by B10: that file carried
two unrelated jobs — this live protocol, and a severity table that four other
files disagreed with. The ceiling is live and referenced from `agents/apex.md`,
`commands/fix.md`, `reference/contracts.md` and `reference/schemas/verification.md`,
so it gets its own file rather than living inside a document about scoring.

## Fix-Loop Ceiling

**The fix-loop ceiling is owned by `scripts/lib/constants.js`** (`FIX_LOOP_CEILING`,
default 2, env override `PHANTOM_FIX_LOOP_CEILING`), enforced by
`hooks/loop-controller.js`. This document is the PROTOCOL reference for every
verify/fix/re-review loop across Phantom — verify.md, fix.md, apex.md, start.md,
contracts.md, and reference/agent-protocols defer to constants.js for the number (so it can't
drift). Rationale for the default: the user's CLAUDE.md rule — *"if a fix attempt
fails twice with the same error class, STOP patching; the approach is wrong."*

The count is tracked by `hooks/loop-controller.js` (a deterministic counter), not by prose.
Prose describes the loop; the controller enforces the ceiling, the same-finding-class
escalation, and the explicit operator override. The `review.fixLoops` field in
`verification.json` is the same counter the controller reads/writes.

In unattended mode, enforcement happens at the Skill-tool boundary via
`hooks/fix-loop-gate.js`; an agent that keeps looping WITHOUT re-invoking
`phantom:fix` is outside this gate — prose discipline and wrap review still apply.

## Auto-Address Loop

1. If `findings[]` is empty → verdict: pass. Write verification.json.
2. If any finding is `blocking` and not `preExisting` → spawn 1 fix agent with those
   findings scoped to it. That set is what `hooks/loop-controller.js`
   `fixLoopFindings()` returns; nothing else may enter the loop.
3. After fix → re-run correctness commands (lint, build, tests)
4. Re-review ONLY the fix diff (not the whole codebase)
5. Stop at the fix-loop ceiling (above; enforced by `hooks/loop-controller.js`). Still
   blocking → escalate to user
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
