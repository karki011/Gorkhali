# Phantom Shadows -- Discipline Enforcement Context

> Loaded by commands that benefit from discipline enforcement at workflow phases.
> Always load `_shared.md` first.

---

## Discipline Integration Map

These disciplines are enforced at specific workflow phases by the Phantom's own agents and references.
No external plugins required.

| Phase | Discipline | Enforced By | Reference |
|-------|-----------|-------------|-----------|
| **B (Planning)** | Structured planning with decomposition | Apex agent + `reference/planning.md` | Plan must have verifiable acceptance criteria, no placeholders |
| **B (Planning)** | Brainstorming for ambiguous scope | Apex detects ambiguity → diverge/converge exploration | Ask targeted questions, propose 2-3 approaches with tradeoffs |
| **B (Planning)** | Adversarial challenge | Rival agent (inherits session model, no tools) | Max 5 challenges, PROCEED/REVISE/RETHINK verdict |
| **D (Dispatch)** | Parallel agent coordination | Execute phase, native Agent tool | Spawn independent agents with worktree isolation |
| **D (Dispatch)** | Spec-compliance enforcement | Blade agents check contracts before writing code | `reference/contracts.md` |
| **D→Fix** | Systematic debugging | Hound agent + `reference/hound-protocol.md` | Reproduce → trace → confirm cause → fix. No stacking patches. |
| **Verify** | Evidence-before-assertions | Ward agent + `reference/verification.md` | Run lint/build/tests, capture output, THEN claim pass/fail |

## Key Principles (why, not just what)

**Planning discipline:** Plans consumed by execution agents must be machine-parseable. Vague plans produce vague implementations — acceptance criteria must be checkable with grep, file read, test command, or CLI output.

**Brainstorm discipline:** When scope is ambiguous, exploring options before committing prevents the most expensive failure mode: implementing the wrong thing well. Ask only what you can't infer from codebase context (graph, learnings, git history).

**Debugging discipline:** Root-cause tracing before fixing prevents patch-stacking — the pattern where multiple fixes are applied to a wrong hypothesis, each making the real problem harder to find.

**Verification discipline:** Claiming "tests pass" without running them is the single most common agent failure mode. Evidence-before-assertions means: run the command, capture the output, THEN make the claim.
