---
name: team:verify
description: Run explicit verification phase (Zoro -> Chopper -> Roger)
---

> Load `_shared.md` + `_shared-crew.md` + `_shared-contracts.md` + `_shared-superpowers.md` before executing.

# /team:verify

Explicitly trigger the verification phase on current work.

1. Load session state and active contracts
2. Spawn verification agents in sequence:
   a. **Zoro** -- test coverage against locked contracts
   b. **Chopper** -- `pnpm check` + `pnpm build` + affected tests
   c. **Roger** -- quality gate review (if risk >= medium, otherwise advisory)
   - **Verification discipline** (`superpowers:verification-before-completion`): Every PASS/FAIL claim MUST have fresh evidence.
     Run command -> read full output -> verify claim matches -> THEN claim. No "should pass", no trusting agent reports.
3. **Run Post-Verify Hook** -- capture results in session JSON
4. Route based on result:
   - **PASS** -> show green summary, proceed to Sengoku gauntlet or wrap
   - **FAIL** -> show Kureha's diagnosis, ask: "Run `/team:fix`?"
5. Update board with verification status
