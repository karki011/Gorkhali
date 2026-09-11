---
name: wrap
description: "Validate passed verification and review, write the PR brief from the plan and the Inspector/Auditor records, open a ready-for-review PR, then hand off to greploop; not for reviewing someone else's PR."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
user-invocable: true
---

# /gorkhali:wrap

Wrap ships the current session's work. It runs after `/gorkhali:verify` and
`/gorkhali:review` already passed - it re-checks their evidence, it does not
repeat their work.

## 1. Require passed evidence

Read `progress.json` (`lib/session.js`'s `readProgress`) and confirm every
task in the plan has an Inspector entry with verdict `pass`. Read
`{SESSION_DIR}/reviews/auditor.json` and confirm `verdict: pass`. Either
missing, `fail`, or `blocked` stops wrap here: name the exact gap and point
to `/gorkhali:verify` or `/gorkhali:review`. Never infer a pass from chat or
a stale file.

## 2. Write the PR brief

Read `plan.json`. Render a short PR body from what these sources actually
say, never invented text - a source with nothing to report gets one line
saying so:

- **What & why** - `briefing.tackling`, `briefing.problem`, `briefing.how`.
- **Verification** - the Inspector checks, named, with their results.
- **Review** - the Auditor verdict and any advisory findings worth a
  reviewer's attention.

## 3. Version bump

Compare each plugin manifest's `version` field against its value on the base
branch. If unchanged, bump the patch component before committing - a
shipped change always carries a new version.

## 4. Ship

Branch, stage the intended files, commit with the repository's configured
author and no AI attribution or session trailer, push, then open a
ready-for-review PR - never `--draft` - with the step 2 brief as the body.
State the ship authorization explicitly in chat before this first push;
that line is the second gate, after plan approval, and it is never skipped.

## 5. Hand off

Run `/gorkhali:greploop <PR number>` as the next command. Do not ask
first. Never merge the PR - merging is always a human action.
