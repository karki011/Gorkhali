---
name: pr-review
description: "Review an EXTERNAL pull request against its ticket intent. Advisory only - produces reviewer artifacts and a draft comment, never records a lifecycle gate and never posts to GitHub."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
# User-invocable (default) - typed /gorkhali:pr-review resolves here. The same-named skill (skills/pr-review/SKILL.md) carries user-invocable: false to stay off the / menu; this command remains the canonical procedure and the single menu surface. Do not flip without re-checking menu duplication.
---

> **Preamble Tier: T3** — shared contexts per the canonical registry (`scripts/preamble-tier.js`)

# /gorkhali:pr-review

Reviews someone else's pull request. `/gorkhali:review` reviews YOUR verified diff
and gates on an Inspector artifact bound to your worktree fingerprint; that gate cannot
be satisfied for a branch you did not build, and `worktreeFingerprint(repo.root)`
would describe your checkout rather than the PR head. So this command is
**advisory only**: it never calls `gorkhali-state.mjs record`, never writes a
lifecycle gate, and never claims a session outcome.

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

Parse a ticket key from the PR title, then the branch name, using the same
pattern `commands/start.md` uses: any match of `[A-Z][A-Z0-9]+-\d+`. Accept it
as-is; do not validate the project prefix.

- **Ticket found** - fetch it and its acceptance criteria via the Jira MCP, the
  same read `commands/start.md` performs. Record `intentSource: "ticket"`.
- **No ticket, or the fetch fails** - derive the intent from the PR body, record
  `intentSource: "inferred"`, and say so in the report.

Never block on a missing ticket.

Write the resolved intent to `{REVIEW_DIR}/intent.json` with `ticket`,
`intentSource`, `acceptanceCriteria` (array, possibly empty), and `summary`.

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
  part of finding them.
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

Draft one comment. Do NOT post it, and never submit a formal GitHub review
(Approve / Request changes) - blocking another author's branch is a human
decision.

The reader deciding whether to act sees only decisions; everything that
justifies a decision is one click deep. So above the fold, and only this: the
verdict line; each blocking finding's claim as a single bold sentence (the
file:line citation stays in the collapsed evidence, not the claim); and that
finding's remediation list, numbered when there are alternative paths that
each close the finding.

Everything else goes behind `<details>`, each with a `<summary>` that names
what it holds without being opened, so the reader can skip it with confidence
rather than open it to find out:

- Each blocking finding's evidence - the quotes, the corroborating lines, the
  reasoning - in its OWN `<details>` block, not merged with the claim above it.
- All advisory findings in one block, its `<summary>` carrying the count and
  the gate status, e.g. "Advisory findings (6 - none gate)".
- The acceptance-criteria scorecard, as a table with one row per AC (status
  plus one-line evidence). This block earns its place only when
  `intentSource` is `"ticket"` - an inferred intent has no criteria to score.
- The verification-performed-and-limits section (see below).

Now derive remediation for findings that survived step 4, and only those.

State the limits plainly in the draft: which claims were verified by re-reading
the source, whether tests were executed, whether the intent was fetched or
inferred, and whether a code graph was available. A limit the author can see is
a limit they can correct.

Report the draft to the caller and stop. The human posts it.
