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
   f. **Prism** -- quality gate review (if risk >= medium, otherwise advisory)
   - **Verification discipline**: Call `Skill(skill="superpowers:verification-before-completion")`. Every PASS/FAIL claim MUST have fresh evidence.
     Run command -> read full output -> verify claim matches -> THEN claim. No "should pass", no trusting agent reports.
3. **Run Post-Verify Hook** -- capture results in session JSON
4. Route based on result:
   - **PASS**:
     ```
       ┌─────────────────────┐
       │  ✓ VERIFICATION OK  │
       │  lint ✓  build ✓    │
       │  tests ✓  review ✓  │
       └─────────────────────┘
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
