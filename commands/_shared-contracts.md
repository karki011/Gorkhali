# Team Skill Crew -- Contracts & Hooks Context

> Loaded by commands that create/validate contracts or run verification hooks. Always load `_shared.md` first.

---

## Contract Templates

Four types, live in `.claude/contracts/` or session state:

| Type | Key Sections |
|------|-------------|
| **Feature** | Metadata, goal, inputs/outputs, ownership, acceptance criteria, non-goals |
| **API** | Endpoint, request, response, consumer notes (caching, retry, optimistic) |
| **Testing** | Coverage areas (render, interactions, states, a11y, edge), out of scope |
| **UI** | Component name, states (default/loading/error/empty/success/disabled), a11y, responsive |

---

## Hook Checkpoints

| Hook | When | Key Checks |
|------|------|------------|
| **Pre-Plan** | Before planning | Task type, missing context, scout needs, Prism gate |
| **Pre-Execute** | Before execution | Contracts exist, owners assigned, skills listed, risky work has review path. **BLOCK if critical interfaces undefined.** |
| **Post-Agent** | After each agent | Validate output format, capture handoff, list files, open questions, unblock downstream |
| **Post-Verify** | After verification | Capture result in session JSON, route: PASS -> Prism (gauntlet mode)/wrap, FAIL -> Cortex (triage) fix loop (max 3), same failure twice -> escalate |
| **Pre-Wrap** | Before wrapping | Implementation notes exist, test/verification recorded, quality review recorded |

---

## Post-Verify Session JSON Shape

```json
{
  "verification": {
    "status": "pass | fail",
    "loop": 0,
    "results": {
      "lint": "pass | fail",
      "typecheck": "pass | fail",
      "build": "pass | fail",
      "tests": "pass | fail",
      "reviewer": "approved | needs_work | skipped"
    },
    "failures": [{
      "class": "build | type | contract | ui | a11y | test | performance | docs | integration",
      "description": "what failed",
      "file": "path/to/file.ts",
      "owner": "agent name",
      "pre_existing": false
    }]
  }
}
```

---

## Done Definition

A task is done when:
- Contract is satisfied
- Agent handoffs are complete
- Verification passed or failures are explicitly documented
- Fix loop completed (if triggered) or escalated with documented reason
- Quality review is complete for the chosen risk level
- Crew evaluation is recorded (for `/team:wrap`)
