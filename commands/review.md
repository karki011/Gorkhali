---
name: review
description: "Run one independent Gaze review of the current verified diff. Adds Archer only for explicit risk triggers; UI confirmation remains a user verification step."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
---

> **Preamble Tier: T3** — loads `_shared.md` + `_shared-shadows.md` + `_shared-discipline.md` + `_shared-contracts.md`

# /phantom:review

1. Resolve the active portable session and current worktree fingerprint.
2. Require the latest portable verification artifact to be passed, current, and
   bound to that fingerprint. If it is absent or stale, stop with `blocked` and
   direct the caller to `/phantom:verify`; do not recreate Ward evidence here.
   Read its `requiredSpecialists` role-string array as the authoritative
   selection; do not reclassify the diff in this command.
3. Load the intent, repository rules, current changed-file list, and diff.
4. Read the round number before deleting anything:

   ```text
   node <skill-directory>/scripts/review-round.js status --reviews {SESSION_DIR}/reviews
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
5. Run exactly the roles named by verification's `requiredSpecialists`. For
   each required role, create
   `{SESSION_DIR}/reviews/specialists/`, delete only that role's file immediately
   before spawning it, then spawn Archer at
   `{SESSION_DIR}/reviews/specialists/archer.json`.

   Do not delete, require, or spawn a role absent from the persisted array. The
   targeted pre-spawn delete makes any later named file fresh for this review
   run. An empty array means Gaze is the only reviewer.
6. Read Gaze's verdict from `{SESSION_DIR}/reviews/gaze.json`, not its final
   message. If the file is missing or unreadable, give the same agent one
   `SendMessage` resume (never a respawn). If it remains absent, record
   `not_observed`/`blocked`, never an approval. For every required specialist,
   read its named file rather than its final message and require: the matching
   `role`; `verdict: pass|fail|blocked`; `findings` as an array; and
   `observationGaps` as an array. Missing or invalid evidence is blocked.
7. Close the round, but only once a valid Gaze artifact was actually read:

   ```text
   node <skill-directory>/scripts/review-round.js close --reviews {SESSION_DIR}/reviews --json
   ```

   It stamps the finding ids, appends this round to the ledger, and returns
   `reported`, `suppressed` and a `convergence` object. On round 2 and later,
   itemize only the `reported` blocking findings and give the non-blocking ones
   as the `suppressed` counts (`carriedOver` / `new`) — never re-listed one by
   one. Skip this entirely when no artifact was written or the review is
   `blocked`: an unrecorded round leaves the next pass at the same round number,
   so a truncated run cannot advance convergence any more than it can reuse a
   verdict.
8. Record the merged outcome through the portable helper:

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
