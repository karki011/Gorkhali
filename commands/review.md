---
name: review
description: "Run one independent Gaze review of the current verified diff. Adds Archer only for explicit risk triggers; UI confirmation remains a user verification step."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
---

> **Preamble Tier: T3** — loads `_shared.md` + `_shared-shadows.md` + `_shared-discipline.md` + `_shared-contracts.md`

# /phantom:review

## Review round procedure

This is the one procedure for a review round; `/phantom:verify` runs it as its
review stage rather than restating it.

1. Resolve the active portable session and current worktree fingerprint.
2. Require the latest portable verification artifact to be passed, current, and
   bound to that fingerprint. If it is absent or stale, stop with `blocked` and
   direct the caller to `/phantom:verify`; do not recreate Ward evidence here.
   Read its `requiredSpecialists` role-string array as the authoritative
   selection; do not reclassify the diff in this command.
3. Load the intent, repository rules, current changed-file list, and diff.
4. Read the round number before deleting anything:

   ```text
   {PR_BOOTSTRAP}
   [ -z "$PR" ] && { echo "phantom: plugin dir not found under ~/.claude/plugins/cache/phantom — run /plugin to install"; exit 0; }
   node "$PR/scripts/review-round.js" status --reviews {SESSION_DIR}/reviews --session {SESSION_DIR}
   ```

   Delete only `{SESSION_DIR}/reviews/gaze.json` — never
   `{SESSION_DIR}/reviews/rounds.json`, and never any other file — then
   run one fresh, read-only Gaze pass using `agents/gaze.md`, telling it the
   round number that command printed. The targeted delete prevents a failed or truncated run
   from reusing an older verdict; the round ledger survives it because it is a
   different file and holds no verdict to reuse — only the finding ids earlier
   rounds raised, which is what tells a carried-over finding from a newly
   invented one (B12). A missing ledger is round 1, which is the normal first
   pass and not an error.
5. Run exactly the roles named by verification's `requiredSpecialists`, without
   reclassifying the diff. For each named role, create
   `{SESSION_DIR}/reviews/specialists/`, delete only that role's
   `{SESSION_DIR}/reviews/specialists/{role}.json` immediately before spawning
   it, then spawn that role — the only role in the normal path is `archer`, at
   `{SESSION_DIR}/reviews/specialists/archer.json`.

   Do not delete, require, or spawn a role absent from the persisted array. An
   empty array means Gaze is the only reviewer.
6. Read Gaze's verdict from `{SESSION_DIR}/reviews/gaze.json`, not its final
   message. If the file is missing or unreadable, give the same agent one
   `SendMessage` resume (never a respawn). If it remains absent, record
   `not_observed`/`blocked`, never an approval. For every required specialist,
   read its named file rather than its final message and require: the matching
   `role`; `verdict: pass|fail|blocked`; `findings` as an array; and
   `observationGaps` as an array. Missing or invalid evidence is blocked.

   When this procedure runs from `/phantom:verify`, the accepted Gaze result
   must also carry exactly one passed check named
   `user-verification-classification`: Gaze checks verification's
   `userVerification` classification against the complete diff, and any
   user-visible behavior paired with `required: false` is a blocking finding. A
   missing, duplicate, failed, or skipped check blocks the review record.
7. Close the round, but only once a valid Gaze artifact was actually read:

   ```text
   {PR_BOOTSTRAP}
   [ -z "$PR" ] && { echo "phantom: plugin dir not found under ~/.claude/plugins/cache/phantom — run /plugin to install"; exit 0; }
   node "$PR/scripts/review-round.js" close --reviews {SESSION_DIR}/reviews --session {SESSION_DIR} --fingerprint <current worktree fingerprint> --json
   ```

   Pass the fingerprint from `phantom-state.mjs fingerprint` — the same one this
   round's verification is bound to. It is what separates a re-review of an
   unchanged worktree from a round that followed an actual fix, and the fix-loop
   count below is derived from it. An unstamped round still records; the count
   just falls back to counting rounds, which escalates earlier than it needs to.

   It stamps the finding ids, appends this round to the ledger, and returns
   `reported`, `suppressed`, a `convergence` object and a `loop` object. On round
   2 and later, itemize only the `reported` blocking findings and give the
   non-blocking ones as the `suppressed` counts (`carriedOver` / `new`) — never
   re-listed one by one. Skip this entirely when no artifact was written or the
   review is `blocked`: an unrecorded round leaves the next pass at the same round
   number, so a truncated run cannot advance convergence any more than it can
   reuse a verdict.

   Report `loop` verbatim alongside the verdict. It is the fix-loop standing the
   ledger now holds (`reference/fix-loop.md`), and `loop.decision.escalate` means
   the next fix loop is the one that must not silently happen — this command
   still never starts one, but it is what makes the ceiling visible at the moment
   it is reached rather than after another round.
8. Record the merged outcome through the portable helper:

   ```json
   {
     "verdict": "pass",
     "findings": [],
     "specialists": [
       { "role": "archer", "verdict": "pass", "findings": [], "observationGaps": [] }
     ],
     "observationGaps": []
   }
   ```

   ```text
   node <skill-directory>/scripts/phantom-state.mjs record --workspace <workspace> --type review --status <status> --run <run-id> --input <review-file>
   ```

   Copy each valid required artifact unchanged into the review payload's
   `specialists` array, and carry step 7's `convergence` object into the payload
   unchanged when it exists. Do not introduce another reducer or fingerprint. A
   specialist `fail` forces overall review status `failed`; a missing, invalid,
   or `blocked` specialist forces `blocked`. Overall `passed` requires Gaze pass
   and every role named by verification's `requiredSpecialists` to pass.

The helper is authoritative for fingerprint and ordering: review must be newer
than the current verification, and its single merged record binds all specialist
evidence to that worktree fingerprint. Report findings with file/component,
evidence, impact, and smallest remediation. Review is read-only; never auto-fix
or start a fix loop. The optional RPSL preset is invoked explicitly for
unusually deep review and is not part of this normal command.
