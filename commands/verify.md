---
name: verify
description: "Run the repository's correctness checks, simplify the changed files, and obtain an independent review. Reports failures; it never edits code to make a check pass."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md`

# /phantom:verify

Use the portable lifecycle and artifact contract as the authority. This command is
an adapter for the ordered quality pipeline; it must not create a second
fingerprint, freshness rule, or verification store.

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
`reference/verification.md`, runs every applicable command without modifying the
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
trigger table in `reference/verification.md`. Convert the result to a unique
`requiredSpecialists` array containing only the role strings `lens` and/or
`archer`; use an empty array when no trigger applies. This selection belongs to
verification and must not be recomputed by review or wrap.

Write a provider-neutral verification evidence payload containing at least:

```json
{
  "checks": [
    { "name": "test", "command": "<exact command>", "result": "passed", "exit_code": 0 }
  ],
  "sweep": { "result": "passed", "changed_files": [] },
  "requiredSpecialists": ["lens", "archer"],
  "observation_gaps": []
}
```

Use only `passed`, `failed`, `blocked`, or `not-applicable`. Record it through
the portable helper; the helper binds it to the complete current worktree
fingerprint and advances lifecycle state atomically:

```text
node <skill-directory>/scripts/phantom-state.mjs record --workspace <workspace> --type verification --status <status> --run <run-id> --input <evidence-file>
```

Never hand-author `worktree_fingerprint`. The portable helper binds both the
checks and `requiredSpecialists` selection to the final worktree.
Missing passed Ward evidence blocks the pipeline and records a non-passing verification. A
failed required command or unexplained skipped required command also stops
before review.

### 4. Gaze — one default independent reviewer

Delete only `{SESSION_DIR}/reviews/gaze.json`, then run one fresh, read-only Gaze pass
using `agents/gaze.md`. Gaze reviews the current diff, intent, repository rules,
and the current portable Ward evidence. It does not run fixes, tests, or Sweep.
The targeted delete prevents a failed or truncated run from reusing an older
verdict. Read its durable artifact rather than inferring a verdict from the
agent's final message.

For the compatibility artifact, read `{SESSION_DIR}/reviews/gaze.json` and its
`findings` key. If it is missing or unreadable, give the same Gaze agent one
`SendMessage` resume (never a respawn) to finish the artifact. If it remains
missing, record `not_observed`/`blocked`; never substitute an empty findings
array or a clean verdict.

Read `requiredSpecialists` from the current passed verification artifact. Do not
inspect the diff to select roles again. Give each required specialist a bounded
question that does not duplicate Gaze's general review. If `lens` is required,
create
`{SESSION_DIR}/reviews/specialists/`, delete only
`{SESSION_DIR}/reviews/specialists/lens.json`, and then immediately spawn Lens.
If `archer` is required, create the same directory, delete only
`{SESSION_DIR}/reviews/specialists/archer.json`, and then immediately spawn
Archer. Do not clear or spawn a role absent from `requiredSpecialists`, and do
not clear any other review file.

After each required specialist returns, require the newly written named file
to be valid. It must contain exactly the role it represents, a `verdict` of
`pass`, `fail`, or `blocked`, a `findings` array, and an `observationGaps`
array. The pre-spawn delete makes a present file evidence from this run rather
than stale evidence. Read the file, not the specialist's final message.
An empty `requiredSpecialists` array means no normal specialist pass. The
optional RPSL preset remains separate and is not part of normal verify.

Record the final review only after the current passed verification artifact:

```json
{
  "verdict": "pass",
  "findings": [],
  "specialists": [
    {
      "role": "lens",
      "verdict": "pass",
      "findings": [],
      "observationGaps": []
    }
  ],
  "observation_gaps": []
}
```

Merge each required role's artifact unchanged into `specialists`; do not add a
second reducer or fingerprint. Gaze plus these specialists form the one review
payload recorded below, so the portable helper binds the merged evidence to the
current worktree fingerprint. A required specialist `fail` makes the overall
review `failed`. A missing, invalid, or `blocked` required specialist makes the
overall review `blocked`. Only Gaze pass plus every role named by verification's
`requiredSpecialists` passing may record an overall passed review.

```text
node <skill-directory>/scripts/phantom-state.mjs record --workspace <workspace> --type review --status <status> --run <run-id> --input <review-file>
```

The helper enforces that review is newer than verification and bound to the same
worktree fingerprint. Missing Gaze or triggered-specialist evidence is
`blocked`, never zero findings and never an approval. Any later worktree change
makes the merged review stale; rerun the affected pipeline rather than patching
metadata.

## Result

Report the ordered evidence: Ward checks, Sweep result, affected Ward rerun,
Gaze verdict, triggered specialists, and portable artifact locations. End with:

- `done` only when required checks and review passed;
- `done-with-caveat` only for a genuinely optional unavailable capability; or
- `blocked` with exact failures or missing evidence.

This command reports and records. It never auto-fixes findings, retries code
changes, or proceeds to wrap on its own.
