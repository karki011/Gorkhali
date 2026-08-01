# Adaptive workflows

## Router

Classify with scope clarity, likely file count, novelty, dependency depth, user
impact, reversibility, and confidence.

| Route | Typical signals | Required flow |
|---|---|---|
| `direct` | Clear pattern, low risk, small blast radius, confidence at least 0.90. | Context, implement, required checks. |
| `plan` | Clear outcome with multiple files or dependencies, confidence at least 0.70. | Context, plan, required approval, execute, required checks. |
| `brainstorm` | Ambiguous outcome, novel domain, or confidence below 0.70. | Research, diverge, compare, user decision, then plan. |
| `full` | Cross-layer, broad, security-sensitive, irreversible, or high-risk. | Brainstorm, plan, dependency wiring, required approval, staged execute, risk-selected checks and evaluation. |

Explain the selected route and signals in the session. The user may override it.

Lifecycle authority is explicit and cumulative:

| Route | Approval prerequisites before `execute` |
|---|---|
| `direct` | None; implementation authorization is still required. |
| `plan` | Approved plan plus implementation authorization. |
| `brainstorm` | Approved direction before plan approval, then approved plan plus implementation authorization. |
| `full` | Approved direction, approved plan, approved wiring, and implementation authorization. |

`--mode to-plan` is a permanent denial of `execute` and `ship` for that session.
Starting work never grants draft-PR shipping authority. The
`ship-draft-pr` authorization is separate from implementation authorization.
For the same active task, route and material intent do not change after the
initial start. A missing route fails closed; changed direction must be recorded
as a revision or restarted under a new task id.

Approval applies to reviewed content, not merely to a gate name. Direction
approval binds the current passed brainstorm, plan approval binds the current
passed plan, and wiring approval binds the current passed plan plus decisions
artifact. Each binding records the artifact `record_sequence` and digest and is
revalidated at `execute`; changed or recovered unbound artifacts require fresh
approval.

Gate approval and implementation/shipping authorization are recorded only from
short-lived signed host decisions. Each decision binds the canonical
repository and exact task, the current worktree fingerprint and artifact
bindings, its gate or scope, pinned key/source, actor, source event, replay id,
and expiry. Bare approval, caller-controlled identity, replay, stale bindings,
or a replaced decision is denied.

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
| Two or more independent read-heavy investigations or adversarial reviews that do not require isolated branch writes. | `native-parallel` |

Specialized or noisy work can justify one delegate even when it is not
parallel. Do not delegate work the active agent can finish in a handful of
tool calls, and never create a delegate solely to double-check completed work.
File count alone never justifies fan-out. Prefer a star topology:
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

This bundle has no trusted isolated branch executor or signed isolation
attestation verifier. A production workflow containing a `parallel` node is
rejected before the compiled plan or journal is written. Lower every
write-bearing parallel topology to current-agent or sequential chain nodes;
filesystem snapshots are evidence, not proof of continuous isolation.

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
8. For a defect, use Hound after starting with `--work-kind investigation` (or
   preserving the conservative detected classification). Hound writes
   `defect-proof.json`: reproduce, collect evidence, trace the exact path, form
   one root-cause hypothesis, and obtain user confirmation before a fix.
9. For a `brainstorm` or `full` route, follow
   [brainstorming](brainstorming.md): establish the decision frame and stance,
   gather evidence, diverge into traceable ideas, cluster connections, converge
   to 2-3 independent options, and preserve dissent.
10. Select the first solution rung that fully satisfies the contract and safety
   bounds. For `direct` and `plan`, use the traced evidence; for `brainstorm` and
   `full`, use the converged approaches. Record only material choices using
   existing rationale, evidence, alternatives, or session decisions.
11. For a `brainstorm` or `full` route, recommend the selected direction,
    create the exploration review HTML from its canonical JSON, validate and
    promote it, then obtain direction.
12. For a planned route, follow [planning](planning.md): create and persist the
   canonical decision-first JSON payload whose plain-language summary states the
   problem, chosen direction, expected changes, and outcome before execution
   details.
13. When material ambiguity or risk warrants independent challenge, select one
    bounded Plan-checker or Rival pass. Do not run both by default and do not
    create a challenge pass merely to repeat the active agent's inspection.
14. Validate the JSON, then author review HTML for the specific decision using
    [review HTML guidance](review-html.md). Validate it with
    `<skill-directory>/scripts/validate-review-html.mjs`, promote the validated artifact, and
    open it directly. Regenerate the disposable HTML from JSON after a change;
    never parse HTML back into state. Use one fenced `json` block only when file
    writing is unavailable. If JSON can be written but HTML generation or opening is
    unavailable, preserve it and present the same information hierarchy in chat.
15. Obtain required approval before implementation when repository policy or the
    task's risk requires it.

## Execute

1. Pass the portable `execute` gate. For investigation work, first validate the
   session-scoped defect proof and any DiagnosticGrant against the current
   worktree. Then confirm implementation authorization, the active route's
   approval prerequisites, branch, plan, contracts, and allowed scope.
2. Build execution waves from observed dependency evidence. Do not parallelize
   shared writes, and do not treat partial graph coverage as proof of isolation.
3. Apply the recorded topology. Delegate bounded implementation-role
   assignments through the runtime's native capability when delegation adds
   value; otherwise execute the contract in the current context. Parallelize
   only tasks in a proven-independent wave.
4. Give each delegated assignment a single objective, the minimum-sufficient-
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
stale. `waiting_for_evidence` / `unconfirmed_defect` remains resumable, but it
does not permit execute until Hound records complete current proof.

## Verify and finish

The compiled workflow declares deterministic checks, any applicable complexity
check, whether an independent evaluator is required, its rubric, and its
iteration limit. Persist declared result artifacts, append their typed
completion/evaluation events through `advance-workflow`, and use replay as the
only acceptance authority. The state helper has no separate verify transition.
Select evaluation because risk or acceptance criteria justify it, never merely to
double-check the active agent. Visual or structural evaluation is
conditional on the changed behavior, not a fixed role stack.

Record checks, complete findings, and the separate acceptance decision against
the current worktree fingerprint. A newer fingerprint makes earlier evidence
stale. A bounded repair iteration repeats only the affected checks and stops on
acceptance, budget or iteration limit, repeated failure class, missing
evidence, or human-decision requirement.

`ship` additionally requires separate draft-PR authorization plus replayed
graph readiness at the current fingerprint. `complete` requires replay to reach
`accepted`, current route approvals, and the exact current approved-plan
binding; it does not implicitly ship. Capture reusable learnings, then complete
or pause the session.
