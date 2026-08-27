---
name: pr-review
description: "Review someone else's PR against ticket, GitHub issue, or PR-body intent. Advisory. Draft comment; never posts unless asked; never records a lifecycle gate."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
# User-facing hour-one loop. Stay on the / menu (Cursor slash reads this file).
# Duplication with skills/{name} is accepted for start/pause/resume/verify/review/pr-review/wrap.
user-invocable: true
---

> **Preamble Tier: T3** — shared contexts per the canonical registry (`scripts/preamble-tier.js`)

# /gorkhali:pr-review

Reviews someone else's pull request. `/gorkhali:review` reviews YOUR verified diff
and gates on an Inspector artifact bound to your worktree fingerprint; that gate cannot
be satisfied for a branch you did not build, and `worktreeFingerprint(repo.root)`
would describe your checkout rather than the PR head. So this command is
**advisory only**: it never calls `gorkhali-state.mjs record`, never writes a
lifecycle gate, and never claims a session outcome. Wrong surface: your own
verified diff → `/gorkhali:review`; opening your PR → `/gorkhali:wrap`.

It reviews from the **ticket**, not the diff. A change can be correct,
conventional and lint-clean while failing to deliver its intent - the severity
standard already names this: `blocking` is "the diff makes something WORSE than
it was before, **or fails the stated intent**"
(`scripts/lib/review-standard.js`). This command is what supplies the intent.

`$ARGUMENTS` is a PR number, a PR URL, or empty (then use the current branch's PR).

## 1. Resolve the PR

`refs/pull/<n>/head` accepts only a number, while `$ARGUMENTS` may be a number, a
URL, or empty. Normalize FIRST and use the result everywhere below; the raw
argument must never reach a refspec:

```text
PR_NUMBER=$(gh pr view <$ARGUMENTS, or nothing> --json number --jq .number)
```

`gh pr view` accepts all three forms and reports the canonical number for each,
so this is the single place the input shapes collapse into one. When the branch
has no pull request it fails with `no pull requests found for branch`; stop and
say so rather than continuing with an empty number.

Then fetch metadata, the diff, and the head, without checking anything out:

```text
gh pr view <PR_NUMBER> --json number,title,headRefName,headRepositoryOwner,baseRefName,url,body,author,additions,deletions,changedFiles
gh pr diff <PR_NUMBER>
git fetch origin refs/pull/<PR_NUMBER>/head:refs/gorkhali/pr/<PR_NUMBER> --force
```

Read post-change content with `git show refs/gorkhali/pr/<PR_NUMBER>:<path>` and
pre-change with `git show <baseRefName>:<path>`.

Both halves of that fetch are deliberate. `refs/pull/<PR_NUMBER>/head` is served by
GitHub for every pull request including forks, whose head branch does not exist
on `origin` at all - fetching `<headRefName>` resolves only for same-repo
branches and silently excludes the most common external case. And the
destination is under `refs/gorkhali/`, never `refs/heads/`: a ref outside
`refs/heads/` cannot be the checked-out branch, so the fetch can never be
refused for that reason, and it cannot collide with or force-overwrite a local
branch that happens to share the PR's name.

Never check the branch out; never modify the working tree; never write into
`refs/heads/`. This command is read-only against the repository, and that
includes the caller's local branches.

## 2. Establish the intent

Intent sources are first-class and none is a failure. Record the one you used.

Parse a ticket key from the PR title, then the branch name, using the same
pattern `commands/start.md` uses: any match of `[A-Z][A-Z0-9]+-\d+`. Accept it
as-is; do not validate the project prefix.

Then resolve intent in this order, first success wins:

1. **Tracker ticket** — Jira, Linear, or GitHub issue fetched via the configured
   tracker (`scripts/gorkhali-config.js get tracker.provider`). Record
   `intentSource: "ticket"`.
2. **GitHub issue** linked from the PR (`gh pr view --json closingIssuesReferences`).
   Record `intentSource: "issue"`.
3. **PR body** — derive the intent from the description. Record
   `intentSource: "pr-body"`.

A missing tracker ticket is not a defect and does not block. Say which source
you used. `inferred` is not a legal `intentSource`.

Write the resolved intent to `{REVIEW_DIR}/intent.json` with `ticket` (or
`issue`), `intentSource`, `acceptanceCriteria` (array, possibly empty), and
`summary`.

`{REVIEW_DIR}` is `${GORKHALI_DATA:-~/.gorkhali}/repos/{REPO_NAME}/pr-reviews/{PR_NUMBER}`.
It is deliberately NOT a session directory: no session exists, and writing under
`sessions/` would invite the lifecycle machinery to read this as one.

## 3. Reachability - does the change deliver that intent in the running app?

This phase exists because a diff-scoped reviewer cannot answer it. Run it before
the correctness pass, because a change that never executes makes most correctness
questions moot.

For each changed file, establish:

1. **Who renders or calls this, in production?** Enumerate non-test consumers.
   Where a code graph is available (`code-review-graph` MCP: `query_graph` with
   `callers_of`, `get_impact_radius`), prefer it - grep answers this
   probabilistically and a graph answers it definitively. When the graph is
   unavailable, say so in `observationGaps` rather than presenting grep as
   equivalent.
2. **Do those consumers reach the changed branch?** A condition edited behind a
   prop that every production caller hardcodes is dead code, however correct.
3. **Does a sibling copy of this logic exist that was NOT changed?** Duplicated
   components, a drawer and a panel rendering the same form, a hook inlined
   twice. Changing one copy and not the reachable one is the failure mode this
   phase is named for.

A change that cannot execute in production fails its stated intent, and is
`blocking` by the standard - not a nitpick about structure.

## 4. Correctness

If the repository has a `REVIEW.md` at the root (or `.github/REVIEW.md`), read
it before spawning reviewers and treat it as the highest-priority review-only
instruction — per-repo severity, skip paths, and always-check rules. Its
absence is not a gap.

Spawn Auditor against the PR branch using `agents/auditor.md`, writing
`{REVIEW_DIR}/auditor.json`. Add Justice (`agents/justice.md`) writing
`{REVIEW_DIR}/specialists/justice.json` only on explicit risk triggers, exactly as
`commands/review.md` treats specialists - a second reviewer is not free and
agreement between two models drawn from a similar distribution is not independent
evidence.

Delete only the artifact file for a role immediately before spawning that role,
so a truncated run cannot reuse an older verdict. Never delete
`{REVIEW_DIR}/rounds.json`.

Three constraints on how reviewers are prompted:

- **Ask for verdict and evidence. Do NOT ask for a proposed fix in the same
  pass.** Remediation is produced in step 6, for findings that survived, not as
  part of finding them. Do not ask the reviewer for praise; "what landed
  properly" is scored in step 6 from confirmed citations, never from vibe.
- **`confidence` is mandatory on every finding**, not optional as the schema
  permits. `confirmed` requires that the cited line was re-read; anything unread
  is `needs-verification` with a matching `observationGaps` entry.
- **A second reviewer refutes; it does not confirm.** When Justice runs, its task
  is to attack Auditor's findings, not to re-derive them.

Run `scripts/review-gaps.js --files <changed files> --json` for the
mechanically-derivable half - changed source files with no corresponding changed
test. Findings derived from it are `advisory` by construction; it reports and
never gates.

Read each verdict from its named artifact file, never from an agent's final
message. A missing or invalid artifact is `blocked`, never an approval.

## 5. Close the round

```text
{PR_BOOTSTRAP}
[ -z "$PR" ] && { echo "gorkhali: plugin dir not found under ~/.claude/plugins/cache/gorkhali — run /plugin to install"; exit 0; }
node "$PR/scripts/review-round.js" close --reviews {REVIEW_DIR} --json
```

The ledger is keyed by PR number rather than session, and is what distinguishes a
carried-over finding from a newly invented one across re-reviews of the same PR.
Skip this when no valid artifact was written: an unrecorded round leaves the next
pass at the same round number, so a truncated run cannot advance convergence.

**Do not call `gorkhali-state.mjs record`.** There is no verification artifact to
order against and no worktree whose fingerprint describes the reviewed code.
Recording here would bind evidence to the wrong commit.

## 6. Report

Lead with one verdict line (PASS/FAIL, blocking count, advisory count). Advisory
only; not a GitHub review. Every section below is its own collapsed `<details>`
with a `<summary>` that names what it holds, and with **no `open` attribute**.
Do not leave a section as open prose. Empty is allowed; skipped is not — a
required section with nothing confirmed says so inside the block.

Required sections, in this order:

1. **What landed properly** — required even on FAIL. Only work you re-read and
   can cite (`file:line`, or a command you ran). Never generic praise ("looks
   clean", "LGTM", "standard quality") and never a positive that was not
   confirmed. If nothing confirmed-positive, say that and why (what you did not
   re-read or run).
2. **Checklist** — five lines, yes / no / unknown, one evidence clause each:
   1. Intent delivered (against the resolved `intentSource`)
   2. Change is reachable in production
   3. Diff makes something worse than before, or misses an acceptance criterion
   4. Tests cover the changed behavior (or `review-gaps.js` named the miss)
   5. Docs/ops the change requires were updated, or are n/a
   Unknown is legal. Inventing a yes is not.
3. **Blocking** — `<summary>` carries the count. Each surviving blocking finding:
   claim as one bold sentence; remediation numbered when there are alternative
   paths; evidence (quotes, corroborating lines) in a nested `<details>`, not
   merged with the claim. Zero findings: one sentence that none survived re-read.
4. **What can improve** — advisory findings plus optional, still-cited
   improvements. `<summary>` carries the count and "none gate". Zero: say none
   survived re-read. Do not pad with style nits you did not confirm.
5. **Repo and code quality** — two lines, yes / no / unknown, one evidence
   clause each: (a) the change matches this repo's existing patterns; (b) the
   change meets this repo's code-quality bar. Compare to code you re-read on
   the same branch or base, not to a generic standard. Unknown if you did not
   compare.
6. **Acceptance-criteria scorecard** — table, one row per AC (status plus
   one-line evidence). Only when `intentSource` is `"ticket"` or `"issue"`.
   Omit the section for `"pr-body"` — there are no criteria to score.
7. **Verification performed and limits** — which claims were re-read, whether
   tests were executed, which `intentSource` was used, whether a code graph was
   available. A limit the author can see is a limit they can correct.

Now derive remediation for findings that survived step 4, and only those.

A finding or a positive that was not re-read is `needs-verification` and belongs
in limits, not in What landed properly, Blocking, or What can improve as a
confirmed fact. Do not manufacture a review from the PR body's self-description.

Then draft one comment. Do NOT post it unless the user explicitly asked to
post a draft (`--post-draft`). Never submit a formal GitHub review
(Approve / Request changes) — blocking another author's branch is a human
decision.

Report the draft to the caller and stop. The human posts it unless they asked
`--post-draft`.
