---
name: verify
description: "Run the repository's correctness checks, simplify the changed files, and obtain an independent review. Reports failures; it never edits code to make a check pass."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md`

# /phantom:verify

Use the portable lifecycle and artifact contract as the authority. This command is
an adapter for the ordered quality pipeline; it must not create a second
fingerprint, freshness rule, or verification store. The portable helper is the one
freshness authority: it binds every record to the complete current worktree
fingerprint, enforces that review is newer than verification, and makes any later
worktree change stale. Never hand-author `worktree_fingerprint`; rerun the affected
stage instead of patching metadata.

## Preconditions

1. Resolve the active portable skill directory and session.
2. Run the portable `verify` gate before checks:

   ```text
   node <skill-directory>/scripts/phantom-state.mjs verify --workspace <workspace>
   ```

3. Inspect the current changed-file list and diff. Preserve unrelated changes.

If execution has not started or the lifecycle gate rejects the request, report
the exact missing prerequisite and stop.

## Ordered pipeline

### 1. Ward — deterministic correctness evidence

Run one read-only Ward pass using `agents/ward.md`. Ward discovers commands by
`skills/phantom/references/verification.md`, runs every applicable command without modifying the
worktree, and returns exact commands, exit codes, and evidence states. A failed,
blocked, or missing Ward result blocks verification. Do not invoke a fix skill.

### 2. Sweep — minimum-sufficient simplification

Run Sweep on every changed file after Ward. Sweep may simplify within the
approved scope only. Record either the files it changed or an evidence-backed
no-change result.

### 3. Affected Ward rerun

If Sweep changed files, rerun Ward for every affected check. Merge the original
and rerun results so the newest observation for each check is authoritative. If
Sweep changed nothing, record that the rerun was not applicable.

Make the semantic risk decision once against the final post-Sweep diff using the
trigger table in `skills/phantom/references/verification.md`. Convert non-visual specialist risk
to a unique `requiredSpecialists` array containing only `archer`; use an empty
array when no Archer trigger applies. For user-visible UI, prepare the
`/phantom:visual` checklist and wait for explicit user confirmation. This
selection belongs to verification and must not be recomputed by review or wrap.

Write a provider-neutral verification evidence payload containing at least:

```json
{
  "checks": [
    { "name": "test", "command": "<exact command>", "result": "passed", "exit_code": 0 }
  ],
  "sweep": { "result": "passed", "changed_files": [] },
  "requiredSpecialists": ["archer"],
  "userVerification": {
    "required": true,
    "status": "confirmed",
    "routes": ["/dashboard"],
    "confirmedBy": "user",
    "observations": []
  },
  "observation_gaps": []
}
```

For non-UI work, omit the confirmation details and record only the explicit,
compact classification: `"userVerification": { "required": false }`. Never
omit `userVerification` from passed verification evidence. Ward classifies the
complete final diff: select `required: true` whenever any changed source, data,
configuration, or asset affects rendered behavior, regardless of its path or
extension.

Use only `passed`, `failed`, `blocked`, or `not-applicable`. Record it through
the portable helper, which advances lifecycle state atomically:

```text
node <skill-directory>/scripts/phantom-state.mjs record --workspace <workspace> --type verification --status <status> --run <run-id> --input <evidence-file>
```

Missing passed Ward evidence blocks the pipeline and records a non-passing verification. A
failed required command or unexplained skipped required command also stops
before review.

### 4. Gaze — one default independent reviewer

Run the round defined by `commands/review.md` → `## Review round procedure`. That
heading is the single copy of the procedure; follow its steps there. Supply this
verify context:

- **Round source** — `{PR_BOOTSTRAP}; [ -n "$PR" ] && node "$PR/scripts/review-round.js" status --reviews {SESSION_DIR}/reviews --session {SESSION_DIR}` (`{PR_BOOTSTRAP}` per `_shared.md` §Paths), and tell Gaze the round it prints.
- **Artifacts** — Delete only `{SESSION_DIR}/reviews/gaze.json` — never `{SESSION_DIR}/reviews/rounds.json` — then run one fresh, read-only Gaze pass against this verification's Ward evidence and the current diff. Close the round with `review-round.js close` only after a valid artifact was read.
- **Required check** — Gaze checks this verification's `userVerification` classification against the complete diff; `commands/review.md` steps 5-6 own the pass/duplicate/missing consequences.
- **Specialists** — run exactly the roles in this verification's `requiredSpecialists`, without reclassifying the diff. For `archer`, create `{SESSION_DIR}/reviews/specialists/`, then delete only `{SESSION_DIR}/reviews/specialists/archer.json` immediately before spawning it, and bind each role's evidence to this verification's Ward artifact; `commands/review.md` steps 5, 6 and 8 own the verdict shape and the fail/blocked reduction.
- **Recording** — the merged review records through the portable helper, after this verification artifact. User visual confirmation is bound to verification and is not a review artifact. The optional RPSL preset is not part of normal verify.

## Result

Report the ordered evidence: Ward checks, Sweep result, affected Ward rerun,
Gaze verdict, the closed round's `loop` standing (the fix-loop count against the
ceiling — see `reference/fix-loop.md`), user visual confirmation when required,
triggered specialists, and portable artifact locations. End with:

- `done` only when required checks and review passed;
- `done-with-caveat` only for a genuinely optional unavailable capability; or
- `blocked` with exact failures or missing evidence.

This command reports and records. It never auto-fixes findings, retries code
changes, or proceeds to wrap on its own.
