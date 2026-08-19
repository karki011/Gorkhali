# Contract Templates

## Contract Types

| Type | Key Sections |
|------|-------------|
| **Feature** | Metadata, goal, inputs/outputs, ownership, acceptance criteria, non-goals |
| **API** | Endpoint, request, response, consumer notes (caching, retry, optimistic) |
| **Testing** | Coverage areas (render, interactions, states, a11y, edge), out of scope |
| **UI** | Component name, states (default/loading/error/empty/success/disabled), a11y, responsive |

## Hook Checkpoints

| Hook | When | Key Checks |
|------|------|------------|
| **Pre-Plan** | Before planning | Task type, missing context, scout needs, Auditor gate |
| **Pre-Execute** | Before execution | Contracts exist, owners assigned, interfaces defined. **BLOCK if critical interfaces undefined.** |
| **Post-Agent** | After each agent | Validate output format, capture handoff, list files, unblock downstream |
| **Post-Verify** | After verification | Capture result in session JSON. PASS → wrap. FAIL → fix loop (ceiling in `reference/fix-loop.md`). Same failure twice → escalate. |
| **Pre-Wrap** | Before wrapping | Implementation notes exist, test/verification recorded, quality review recorded |

## Done Definition

A task is done when:
1. Contract deliverables satisfied
2. Agent handoffs complete (if multi-agent)
3. Verification passed or failures explicitly documented
4. Fix loop completed (if triggered) or escalated with documented reason
5. Quality review complete for the chosen risk level
6. Shadows evaluation recorded (for wrap)
