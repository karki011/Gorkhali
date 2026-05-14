---
name: team:verify
description: "Use when checking if code works, running tests, verifying changes, or before claiming work is done. Runs lint, build, tests, simplify, code review, and quality gate."
---

> Load `_shared.md` + `_shared-repo-detection.md` + `_shared-crew.md` + `_shared-contracts.md` + `_shared-superpowers.md` before executing.

# /team:verify

Explicitly trigger the verification phase on current work.

1. Load session state and active contracts
2. Spawn verification agents in sequence:
   a. **Sentinel** -- test coverage against locked contracts
   b. **Sentinel** -- discover verify commands from `_shared-repo-detection.md`, run them (NOT hardcoded `pnpm check`)
   c. **Simplify** -- Call `Skill(skill="simplify")` on changed files. Fix issues found.
   d. **Code Review** -- Call `Skill(skill="code-review:code-review")` on changed files. Fix issues found.
   e. If simplify or code-review produced changes → re-run Sentinel
   e2. **PR Review Toolkit gate:**
       - Call `Skill(skill="pr-review-toolkit:code-simplifier")` — simplify changed code for clarity and maintainability
       - Call `Skill(skill="pr-review-toolkit:code-reviewer")` — review changed files against project guidelines and style
       - If either produced changes → re-run Sentinel (verify fixes didn't break anything)
   f. **Self-evaluation gate** (after Sentinel PASS, before Prism):
      Cortex reviews the full diff against the original contract:
      - Does this diff actually solve the contract goal, or does it just pass tests?
      - Are there logic errors that tests wouldn't catch?
      - Does the solution match the user's stated intent (not just the literal request)?
      - Any scope creep — changes beyond what the contract specified?

      Verdict: ALIGNED / DRIFT / WRONG
      - ALIGNED → proceed to elegance pause (step 2g)
      - DRIFT → flag scope creep, ask user if intentional
      - WRONG → abort quality pipeline, return to fix loop with "wrong solution" classification
   g. **Elegance pause** ("Less is More" check):
      Before quality review, Cortex asks: "Is there a simpler version that delivers the same value?"

      Quick scan checklist:
      - Any code that could be deleted without losing functionality?
      - Any abstraction that only has one consumer?
      - Any config/options that could use sensible defaults?
      - Any wrapper that just passes through?

      If simplification found:
      a. Spawn focused Spark to simplify (scoped to specific files)
      b. Re-run Sentinel on simplified code
      c. If still passes → proceed with simpler version
      d. If fails → revert, proceed with original

      If no simplification needed → proceed directly to Prism
   h. **Prism** -- quality gate review with score rubric (see `prism.md` "Quality Score Rubric")
      - If NEEDS WORK (score 5.0–6.9) → enter quality gate loop (max 2 iterations):
        Spark fixes findings → self-review → Sentinel re-verifies → Prism re-scores
      - If REJECTED (score < 5.0) → return to planning
   - **Verification discipline**: Call `Skill(skill="superpowers:verification-before-completion")`. Every claim needs fresh evidence — run, read output, verify, then claim.
3. **Run Post-Verify Hook** -- capture results in session JSON
4. Route based on result:
   - **PASS**:
     ```
       ┌──────────────────────────┐
       │  ✓ VERIFICATION OK       │
       │  lint ✓  build ✓         │
       │  tests ✓  review ✓       │
       │  quality: {X.X}/10       │
       └──────────────────────────┘
     ```
     Proceed to Prism gauntlet or wrap.
   - **FAIL**:
     ```
       ┌─────────────────────┐
       │  ✗ VERIFICATION FAIL│
       │  {failed step} ✗    │
       │  Run /team:fix ?    │
       └─────────────────────┘
     ```
     Show Cortex diagnosis, ask: "Run `/team:fix`?"
