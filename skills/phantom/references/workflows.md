# Adaptive workflows

## Router

Classify with scope clarity, likely file count, novelty, dependency depth, user
impact, reversibility, and confidence.

| Route | Typical signals | Required flow |
|---|---|---|
| `direct` | Clear pattern, low risk, small blast radius, confidence at least 0.90. | Context, implement, verify, simplify, review. |
| `plan` | Clear outcome with multiple files or dependencies, confidence at least 0.70. | Context, plan, challenge, required approval, execute, verify. |
| `brainstorm` | Ambiguous outcome, novel domain, or confidence below 0.70. | Research, diverge, compare, user decision, then plan. |
| `full` | Cross-layer, broad, security-sensitive, irreversible, or high-risk. | Brainstorm, plan, dependency wiring, required approval, staged execute, full verification. |

Explain the selected route and signals in the session. The user may override it.

## Automatic delegation decision

Routing selects gates and artifacts; Apex separately selects the execution
topology after routing and dependency inspection. The user supplies the goal
and does not need to request workers, choose their count, or assign models.
Honor an explicit instruction to require, limit, or disable delegation within
repository safety, runtime permissions, and dependency constraints. Honor every
approval or permission boundary imposed by the runtime.

Choose the smallest useful topology:

| Signals | Topology |
|---|---|
| One clear objective; sequential or tightly coupled work; shared-write hotspot; coordination costs more than it saves. | `current-agent` |
| Two or more bounded passes benefit from isolated context but must run in order. | `native-serial` |
| Two or more independent read-heavy investigations, adversarial reviews, or implementation scopes with proven non-overlapping writes and no unresolved producer-consumer edge. | `native-parallel` |

Specialized or noisy work can justify one delegate even when it is not
parallel. File count alone never justifies fan-out. Prefer a star topology:
Apex creates bounded assignments, workers return their declared output, and
Apex waits for all required results, validates them, resolves disagreement, and
synthesizes once. Do not let workers recursively delegate unless the plan
explicitly authorizes a bounded need and native nesting is available.

Use only native delegation exposed by the capability ledger. Process execution
does not imply delegation: never recursively launch the current runtime or
bypass its nesting protections. If spawning is unknown, unavailable, denied,
or rejected at an approval boundary, apply the labeled sequential fallback
without changing role contracts or quality gates. Record the selected topology,
rationale, requested profiles, and any fallback in session state.

## Start and plan

1. Read repository rules, relevant code, history, and matching corrections.
2. Capture task intent, constraints, exclusions, acceptance criteria, and open
   questions.
3. Trace the current flow and collect evidence for omission, repository reuse,
   standard-library support, native platform capabilities, installed
   dependencies, and the smallest clear local change.
4. Create the capability ledger.
5. Inspect dependency impact for candidate shared files. Prefer a native graph;
   otherwise run the bundled analyzer when command execution exists. Record
   partial coverage and supplement it with references, tests, and history.
6. Classify the route.
7. Select required role passes and automatically choose `current-agent`,
   `native-serial`, or `native-parallel` using the policy above. Resolve each
   delegated profile only after the topology and bounded assignment are known.
8. For a defect, use Hound: reproduce, collect evidence, trace the exact path,
   form one root-cause hypothesis, and obtain user confirmation before a fix.
9. For a `brainstorm` or `full` route, follow
   [brainstorming](brainstorming.md): establish the decision frame and stance,
   gather evidence, diverge into traceable ideas, cluster connections, converge
   to 2-3 independent options, and preserve dissent.
10. Select the first solution rung that fully satisfies the contract and safety
   bounds. For `direct` and `plan`, use the traced evidence; for `brainstorm` and
   `full`, use the converged approaches. Record only material choices using
   existing rationale, evidence, alternatives, or session decisions.
11. For a `brainstorm` or `full` route, recommend the selected direction,
    render the exploration workbench, and obtain direction.
12. For a planned route, follow [planning](planning.md): create and persist the
   canonical decision-first JSON payload whose plain-language summary states the
   problem, chosen direction, expected changes, and outcome before execution
   details.
13. Have Plan-checker inspect coverage and ordering. Have Rival challenge
   assumptions. Resolve disagreement or ask the user.
14. Validate the JSON, then invoke the bundled renderer when command execution
    exists. Never author or repair HTML by hand; update the JSON and regenerate.
    Use one fenced `json` block only when file writing is unavailable. If JSON
    can be written but rendering or opening is unavailable, preserve it and
    present the same information hierarchy in chat.
15. Obtain required approval before implementation when repository policy or the
    task's risk requires it.

## Execute

1. Confirm the active branch, worktree, plan, contracts, and allowed scope.
2. Build execution waves from observed dependency evidence. Do not parallelize
   shared writes, and do not treat partial graph coverage as proof of isolation.
3. Apply the recorded topology. Delegate bounded Blade assignments through the
   runtime's native spawn capability when delegation adds value; otherwise run
   each Blade contract directly as a labeled pass. Parallelize only tasks in a
   proven-independent wave.
4. Give each Blade assignment a single objective, the minimum-sufficient-
   solution constraint, and an output contract. Require the worker to select
   the first sufficient rung rather than assuming the parent's reasoning was
   inherited.
5. Wait for every required result, validate each returned change before
   integration, and have Apex synthesize the execution outcome once.
6. Record completed criteria, deviations, decisions, and follow-up risks.
7. If the same error class defeats two attempts, stop patching and re-plan from
   the collected evidence.
8. Preserve user changes and never broaden scope silently.

## Pause and resume

Pause when context, authority, or an external dependency prevents safe progress.
Record the current route, exact next action, completed and incomplete criteria,
changed files, dirty state, decisions, commands and results, blockers, and
relevant corrections.

On resume, re-read governing instructions, validate workspace identity, compare
the worktree to the checkpoint, re-check corrections, and continue from the
first incomplete criterion. Do not repeat completed work without evidence it is
stale.

## Verify and finish

Run Ward, Sweep, conditional Ward, and Gaze in that order. Add Lens for visual
changes and Archer for cross-file or architectural changes. Fix blocking
findings within scope and repeat affected checks. Prepare lifecycle actions only
when authorized. Capture reusable learnings, then complete or pause the session.
