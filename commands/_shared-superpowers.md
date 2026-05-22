# Team Skill Crew -- Superpowers Discipline Context

> Loaded by commands that benefit from superpowers discipline enforcement.
> Always load `_shared.md` first.

---

## Superpowers Integration Map

These skills provide **discipline enforcement** at specific workflow phases.
The orchestrator invokes them by name -- do NOT duplicate their content here.

| Phase | Superpowers Skill | Trigger |
|-------|-------------------|---------|
| **B (Planning)** | `superpowers:writing-plans` | Start of Phase B, before Explore/Plan agents |
| **B (Planning)** | `superpowers:brainstorming` | Complex features (risk >= medium OR multiple subsystems) |
| **D (Dispatch)** | `superpowers:dispatching-parallel-agents` | Spawning 2+ independent agents |
| **D (Dispatch)** | `superpowers:subagent-driven-development` | Spec-compliance + quality review pattern |
| **D→Fix** | `superpowers:systematic-debugging` | Every fix loop entry (before triage) |
| **Verify** | `superpowers:verification-before-completion` | Every verification phase, before PASS/FAIL claim |

Discipline details (planning, dispatch, debugging, verification): see `reference/governance.md` and `reference/verification.md`.
