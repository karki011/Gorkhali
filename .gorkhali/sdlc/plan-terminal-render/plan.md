# Plan: plan-terminal-render

## Files that change
- commands/start.md
- commands/brainstorm.md
- commands/resume.md
- reference/planning.md
- reference/brainstorm.md
- reference/agents.md
- reference/schemas/plan.md
- test/review-artifact-delivery.test.js
- skills/gorkhali/references/planning.md
- skills/gorkhali/references/brainstorming.md
- skills/gorkhali/references/capabilities.md
- skills/gorkhali/manifest.json
- test/portable-skill.test.js
- skills/gorkhali/scripts/validate-review-html.mjs
- skills/gorkhali/references/review-html.md
- test/validate-review-html.test.js
- ROADMAP.md
- evals/evals.json
- test/portable-lifecycle.test.js
- test/wrap-greploop-watch.test.js

## Order of work
- T1. Make the chat brief the only presentation at the native plan gate and the native brainstorm gate, update the plan schema example that still teaches a gate review page, and rewrite the tests that assert the removed page instructions.
- T2. Remove the gate review page from the portable references and the capability ledger, and refresh the portable manifest digest.
- T3. Narrow the review page validator and its contract to the three reading surfaces that still publish pages.
- T4. Record the reversal in the roadmap and retire the eval that judges the skill for producing a plan page.
- T5. Run the whole suite and the strict portable skill validator, and confirm nothing outside the two gates lost its page.

## Risks
- The portable manifest digest goes stale and the whole suite fails on an edit that looks like prose.
- Narrowing the validator breaks one of the three surfaces that must keep working.
- Rewriting the validator's test file quietly drops safety coverage.
- A large plan turns the gate into a wall of chat that is harder to read than the page it replaced.
- An async or remote reviewer loses the shareable link for these two gates.
- The change reverses the gate half of PR #17 one release later without the record showing it.

## Proof
- No command or reference instructs anyone to author plan.candidate.html or brainstorm.candidate.html
- No command calls the Artifact tool for plan.html or brainstorm.html
- Both gates carry an explicit line offering implementation detail on request
- --to-plan and the unattended loop write plan.json only
- The review page validator accepts visualflow, detective and review and nothing else
- The full node test suite and the portable skill validator both pass
- node --test test/review-artifact-delivery.test.js
- node --test test/portable-skill.test.js
- node --test test/validate-review-html.test.js
- node --test test/portable-lifecycle.test.js
- node scripts/validate-portable-skill.mjs skills/gorkhali

## Linkage
- Task: plan-terminal-render
- Tracker: _Not recorded
- Commit: _Not recorded
- Canonical record: session JSON (not this file)
