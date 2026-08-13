---
name: wrap
description: "Validate current portable quality evidence, create a draft pull request, and record the release summary and lifecycle outcome."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
---

> **Preamble Tier: T4** — loads all shared contexts

# /phantom:wrap

Wrap is a thin shipping adapter. Portable lifecycle state, worktree fingerprint,
verification, and review artifacts are the authority. Do not run a second Apex
review or mandatory RPSL panel.

## 1. Validate the current release candidate

1. Resolve the active portable skill and session.
2. Read portable status and fingerprint:

   ```text
   node <skill-directory>/scripts/phantom-state.mjs status --workspace <workspace>
   node <skill-directory>/scripts/phantom-state.mjs fingerprint --workspace <workspace>
   ```

3. Require the portable ship gate's authoritative latest
   `verification` and `review` artifacts to:
   - be `passed`;
   - bind the complete current worktree fingerprint;
   - contain at least one named passed Ward check and a Gaze `verdict: pass`
     with a findings array; and
   - preserve ordering: review is newer than verification.
4. Rely on the portable helper's cross-gate validation that every role persisted
   in verification's `requiredSpecialists` has exactly one passing entry in the
   merged review's `specialists` array. Do not inspect the diff to select roles
   again during wrap.

If Ward, Gaze, or a triggered specialist is missing, failed, blocked, or stale,
the helper rejects the cross-gate contract: stop with the exact gap and run
`/phantom:verify`. A mismatched required/result role set is the same blocking
case. Never infer approval from a legacy `verification.json`, chat message, old
panel, or clean-looking diff.

If `--deep-review` was explicitly requested, run the optional RPSL preset in
`reference/wrap/rpsl.md`. Its selected failed, blocked, or missing perspective
blocks this wrap. Without that flag, do not create or require a review panel.

## Step 3: Defense Brief (auto, always)

On every wrap, regardless of file count, Apex prepares
`{SESSION_DIR}/defense-brief.md` using
`reference/wrap/defense-brief.md`. This is release-context judgment work and is
never warden work. It contains exactly these headings:

- `## What we did`
- `## Why we did it`
- `## Watch out for`
- `## What you need to know`
- `## Likely questions and answers`
- `## Decision log`

The mechanical ship preflight checks the six headings before git operations:

```bash
SESSION_DIR="{TEAM_DIR}/sessions/{TICKET}"
for h in "What we did" "Why we did it" "Watch out for" "What you need to know" "Likely questions and answers" "Decision log"; do
  grep -qF "## $h" "$SESSION_DIR/defense-brief.md" || exit 1
done
```

The optional `--grill` flag may invoke `phantom:grill`; it is never automatic.

## 2. Prepare the release summary and render the PR body

Inspect `main...HEAD` (or the repository's resolved base branch) once for release
facts, not as another quality gate. Prepare a concise title, then render the PR
body into `{SESSION_DIR}/pr-body.md` using `reference/wrap/pr-body.md`. This is
release-context judgment work and is never warden work — warden only passes the
finished file to `gh pr create --body-file`.

The body has exactly these five headings, in this order, each populated from a
session artifact rather than free prose:

- `## Goal` — from `intent.json` (`problem`, `goal`, `doneWhen[]`)
- `## Approach` — from `plan.json` (`decision.recommendation`,
  `solution_shape.summary`, `alternatives[]`) and `execution.json`
  (`filesChanged`)
- `## Risk` — from `plan.json` `risks[]`, `intent.json` `tradeoffs[]` /
  `nonNegotiables[]`, and review findings that shipped accepted rather than fixed
- `## Verification evidence` — from the current portable verification artifact
  (`checks[]`, `userVerification`) and review artifact (`verdict`, `findings`,
  `specialists[]`)
- `## What to look at first` — ranked `path:line` pointers, at most five

When a section's source artifact is absent, write the stated gap for it — an
italic `_Not recorded: {artifact} — {what was missing}._` — never a guess, an
`N/A`, or an empty section. `## Verification evidence` has no gap form: missing
required evidence is a blocked ship gate at step 1, so no PR is created.

If the repository ships its own PR template under `.github/`, mirror its headings
and place the five resolved values under them; see `reference/wrap/pr-body.md`.

The mechanical ship preflight checks the five headings, and that no section is
empty, before git operations:

```bash
BODY="{TEAM_DIR}/sessions/{TICKET}/pr-body.md"
for h in "Goal" "Approach" "Risk" "Verification evidence" "What to look at first"; do
  grep -qF "## $h" "$BODY" || exit 1
done
awk '/^## /{if (h) exit 1; h=1; next} NF {h=0} END {exit h}' "$BODY" || exit 1
```

Use repo-relative paths. Do not publish local absolute paths, credentials,
private session data, or screenshots without explicit approval. Do not commit
Phantom session artifacts.

## 3. Authorize and cross the portable ship gate

Draft-PR authorization is distinct from implementation authorization. When the
user asked to create a PR, record that authorization, then cross the ship gate:

```text
node <skill-directory>/scripts/phantom-state.mjs authorize --workspace <workspace> --scope ship-draft-pr
node <skill-directory>/scripts/phantom-state.mjs ship --workspace <workspace>
```

The helper revalidates current fingerprint, gate status, and artifact ordering.
A rejection stops all external git/PR actions.

## 4. Create the draft PR

Use the existing ship-ceremony mechanics for mechanical git operations only:

1. verify the target branch and remote;
2. stage only intended repository changes;
3. commit with an accurate conventional message and requested author credit;
4. push the current branch; and
5. create a **draft** PR whose title is the release summary and whose body is
   `{SESSION_DIR}/pr-body.md` passed verbatim via `--body-file`. Warden does not
   author, fill, or re-order any section of that body.

Do not mark the PR ready, merge it, transition unrelated tickets, or start an
automatic review/fix loop. Any destructive or newly external action beyond the
authorized draft PR requires separate authority.

## Step 9: Record the outcome

Write the normal wrap/run artifact through the existing portable recording
path, including the summary, base/head branches, commit, draft PR number and
URL, quality artifact references, known caveats, and observable model-routing
diagnostics. Include `defenseBrief` as `{ path, questions, sections }`, where
`path` names `defense-brief.md`, `questions` counts its Q/A pairs, and `sections`
is 6.
Include `prBody` as `{ path, sections, gaps }`, where `path` names `pr-body.md`,
`sections` is 5, and `gaps` lists the headings that carry a stated gap because
their source artifact was absent (empty array when every section was sourced).
Preserve lifecycle/session completion mechanics and reusable learnings; cost,
routing, and learning enrichments remain non-blocking.

Report `done` with the draft PR URL only after creation and artifact recording.
Use `done-with-caveat` for a non-blocking enrichment failure, or `blocked` with
the exact failed gate/action. A PR-creation failure must not be reported as a
completed wrap.
