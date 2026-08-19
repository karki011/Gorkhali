# Phantom Shadows -- Discipline Enforcement Context

> Loaded by commands that benefit from discipline enforcement at workflow phases.
> Always load `_shared.md` first.

---

## Discipline Integration Map

These disciplines are enforced at specific workflow phases by the Phantom's own agents and references.
No external plugins required.

| Phase | Discipline | Enforced By | Reference |
|-------|-----------|-------------|-----------|
| **B (Planning)** | Structured planning with decomposition | Chief agent + `reference/planning.md` | Plan must have verifiable acceptance criteria, no placeholders |
| **B (Planning)** | Brainstorming for ambiguous scope | Chief detects ambiguity → diverge/converge exploration | Ask targeted questions, propose 2-3 approaches with tradeoffs |
| **B (Planning)** | Adversarial challenge + plan validation | Opposition agent (sonnet (pinned), no tools) - the one plan critic | Max 5 challenges, PROCEED/REVISE/RETHINK verdict in `plan-check.json` |
| **D (Dispatch)** | Parallel agent coordination | Execute phase, native Agent tool | Spawn independent agents with worktree isolation |
| **D (Dispatch)** | Spec-compliance enforcement | Engineer agents check contracts before writing code | `reference/contracts.md` |
| **D (Dispatch)** | Pre-write minimalism (YAGNI ladder) | Engineer climbs the ladder before writing code | Minimalism discipline (below) |
| **D→Fix** | Systematic debugging | Detective agent + `reference/detective-protocol.md` | Reproduce → trace → confirm cause → fix. No stacking patches. |
| **Verify** | Evidence-before-assertions | Inspector agent + `reference/verification.md` | Run lint/build/tests, capture output, THEN claim pass/fail |

## Key Principles (why, not just what)

**Planning discipline:** Plans consumed by execution agents must be machine-parseable. Vague plans produce vague implementations — acceptance criteria must be checkable with grep, file read, test command, or CLI output.

**Brainstorm discipline:** When scope is ambiguous, exploring options before committing prevents the most expensive failure mode: implementing the wrong thing well. Ask only what you can't infer from codebase context (graph, learnings, git history).

**Debugging discipline:** Root-cause tracing before fixing prevents patch-stacking — the pattern where multiple fixes are applied to a wrong hypothesis, each making the real problem harder to find.

**Verification discipline:** Claiming "tests pass" without running them is the single most common agent failure mode. Evidence-before-assertions means: run the command, capture the output, THEN make the claim.

**Minimalism discipline (YAGNI ladder):** The cheapest code to maintain is the code never written. Before writing, climb to the first rung that holds — the ladder runs *after* understanding the problem, not instead of it (read the code the change touches, trace the real flow, then climb):

1. **Does this need to exist?** Speculative need → skip it, say so in one line. (YAGNI)
2. **Already in this codebase?** A helper, util, type, or pattern that already lives here → reuse it. Re-implementing what's a few files over is the most common slop.
3. **Stdlib does it?** Use it.
4. **Native platform feature covers it?** Use it (`<input type="date">` over a picker lib, CSS over JS, DB constraint over app code).
5. **Already-installed dependency solves it?** Use it. Never add a new dependency for what a few lines do.
6. **Can it be one line?** One line.
7. **Only then:** the minimum code that works.

Two rungs work → take the higher one and move on. Bug fix = root cause, not symptom: grep every caller of the function you touch and fix the shared function once — one guard there is a smaller diff than one per caller, and patching only the path the ticket names leaves a sibling caller broken (reinforces Debugging discipline above). **Never lazy about:** understanding the problem, input validation at trust boundaries, error handling that prevents data loss, security, accessibility, or anything explicitly requested. A small diff you don't understand is laziness dressed up as efficiency. _Adapted from [ponytail](https://github.com/DietrichGebert/ponytail) (MIT)._

**Model-routing discipline:** owned entirely by `reference/agents.md` → **Model Routing**. Not restated here.
