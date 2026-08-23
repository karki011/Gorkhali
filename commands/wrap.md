---
name: wrap
description: "Validate current portable quality evidence, create a ready-for-review pull request, and record the release summary and lifecycle outcome."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
# Hidden from the Claude Code / menu to deduplicate entries — the same-named skill is the single menu surface and delegates to this command, which remains the canonical procedure. Do not flip without re-checking menu duplication.
user-invocable: false
---

> **Preamble Tier: T4** — loads ALL shared contexts (canonical registry: `scripts/preamble-tier.js`)

# /gorkhali:wrap

Wrap is a thin shipping adapter. Portable lifecycle state, worktree fingerprint,
verification, and review artifacts are the authority. Do not run a second Chief
review or mandatory RPSL panel.

## 1. Validate the current release candidate

1. Resolve the active portable skill and session.
2. Read portable status and fingerprint:

   ```text
   node <skill-directory>/scripts/gorkhali-state.mjs status --workspace <workspace>
   node <skill-directory>/scripts/gorkhali-state.mjs fingerprint --workspace <workspace>
   ```

3. Require the portable ship gate's authoritative latest
   `verification` and `review` artifacts to:
   - be `passed`;
   - bind the complete current worktree fingerprint;
   - contain at least one named passed Inspector check and an Auditor `verdict: pass`
     with a findings array; and
   - preserve ordering: review is newer than verification.
4. Rely on the portable helper's cross-gate validation that every role persisted
   in verification's `requiredSpecialists` has exactly one passing entry in the
   merged review's `specialists` array. Do not inspect the diff to select roles
   again during wrap.

If Inspector, Auditor, or a triggered specialist is missing, failed, blocked, or stale,
the helper rejects the cross-gate contract: stop with the exact gap and run
`/gorkhali:verify`. A mismatched required/result role set is the same blocking
case. Never infer approval from a legacy `verification.json`, chat message, old
panel, or clean-looking diff.

If `--deep-review` was explicitly requested, run the optional RPSL preset in
`reference/wrap/rpsl.md`. Its selected failed, blocked, or missing perspective
blocks this wrap. Without that flag, do not create or require a review panel.

## Step 2: Defense Brief (auto, always)

On every wrap, regardless of file count, Chief prepares
`{SESSION_DIR}/defense-brief.md` using
`reference/wrap/defense-brief.md`. This is release-context judgment work and is
never clerk work. It contains exactly these headings:

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

The optional `--grill` flag may invoke `gorkhali:grill`; it is never automatic.

## 3. Prepare the release summary and render the PR body

Inspect `main...HEAD` (or the repository's resolved base branch) once for release
facts, not as another quality gate. Prepare a concise title, then render the PR
body into `{SESSION_DIR}/pr-body.md` using `reference/wrap/pr-body.md`. This is
release-context judgment work and is never clerk work — clerk only passes the
finished file to `gh pr create --body-file`.

`reference/wrap/pr-body.md` is the single copy of that contract — three sections
(`## What & why`, `## Verification`, `## Review focus`), each sourced from a
session artifact rather than free prose, under hard caps of 40 lines and 2500
characters. Do not restate the section spec here; follow it there.

For a UI-facing change you MAY attach a Gorkhali Surveyor screenshot under
`## Verification` as optional supporting evidence (test credentials are already
in the user's shell env); its absence never blocks the wrap.

The mechanical ship preflight checks the three headings, and that no section is
empty, before git operations:

```bash
BODY="{TEAM_DIR}/sessions/{TICKET}/pr-body.md"
for h in "What & why" "Verification" "Review focus"; do
  grep -qF "## $h" "$BODY" || exit 1
done
awk '/^## /{if (h) exit 1; h=1; next} NF {h=0} END {exit h}' "$BODY" || exit 1
```

Use repo-relative paths. Do not publish local absolute paths, credentials,
private session data, or screenshots without explicit approval. Do not commit
Gorkhali session artifacts.

## 4. Authorize and cross the portable ship gate

PR-shipping authorization is distinct from implementation authorization. When the
user asked to create a PR, record that authorization, then cross the ship gate:

```text
node <skill-directory>/scripts/gorkhali-state.mjs authorize --workspace <workspace> --scope ship-pr
node <skill-directory>/scripts/gorkhali-state.mjs ship --workspace <workspace>
```

The helper revalidates current fingerprint, gate status, and artifact ordering.
A rejection stops all external git/PR actions.

## 5. Create the PR (ready for review)

Use the existing ship-ceremony mechanics for mechanical git operations only:

1. verify the target branch and remote;
2. stage only intended repository changes;
3. commit with an accurate conventional message and requested author credit;
4. push the current branch; and
5. create a **ready-for-review** PR whose title is the release summary and whose
   body is `{SESSION_DIR}/pr-body.md` passed verbatim via `--body-file`. Clerk
   does not author, fill, or re-order any section of that body.

Do not merge the PR, transition unrelated tickets, or start an automatic
review/fix loop. Any destructive or newly external action beyond the authorized
PR requires separate authority.

## Step 6: Record the outcome

Write the normal wrap/run artifact through the existing portable recording
path, including the summary, base/head branches, commit, PR number and
URL, quality artifact references, known caveats, and observable model-routing
diagnostics. Include `defenseBrief` as `{ path, questions, sections }`, where
`path` names `defense-brief.md`, `questions` counts its Q/A pairs, and `sections`
is 6.
Include `prBody` as `{ path, sections, gaps }`, where `path` names `pr-body.md`,
`sections` is 3, and `gaps` lists the headings that carry a stated gap because
their source artifact was absent (empty array when every section was sourced).
Preserve lifecycle/session completion mechanics and reusable learnings; cost,
routing, and learning enrichments remain non-blocking.

Report `done` with the PR URL only after creation and artifact recording.
Use `done-with-caveat` for a non-blocking enrichment failure, or `blocked` with
the exact failed gate/action. A PR-creation failure must not be reported as a
completed wrap.
