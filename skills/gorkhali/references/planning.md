# Planning

Load this phase when starting, resuming, investigating, choosing direction, or
preparing implementation. Planning produces decision-useful artifacts; it does
not authorize code mutation or external lifecycle actions.

## Establish current truth

1. Run compact `status` before creating or changing state. Resume a matching
   active session rather than replacing it.
2. Read the nearest repository instructions and relevant learnings. A recorded
   failed correction blocks repeating that approach unless current evidence
   explains why this case differs.
3. Trace the current code path and existing repository patterns. For shared or
   refactored surfaces, inspect dependency impact with a native graph or the
   bundled read-only impact analyzer.
4. Record capability availability without destructive probes. A fallback must
   be visible and must preserve the same decision or evidence contract.
5. Apply the minimum-sufficient ladder after understanding the code path:
   omit unnecessary machinery, reuse the repository, prefer standard or native
   behavior, reuse installed dependencies, then write the smallest custom
   implementation that completely satisfies the approved outcome.
6. Verify the request's claims before planning against them. A ticket or a
   reported behavior is a hypothesis: classify every claim the plan depends on
   as `confirmed`, `refuted`, or `stale` against a repository location or
   command result. A refuted or stale premise stops planning; report it.
7. Measure what is measurable. A limit, count, size, rendered dimension, or
   contrast ratio the workspace can report is read, never estimated. Where a
   design artifact or schema defines the intended result, it is the source of
   truth; a neighboring implementation file shows only what exists today.

## Classify the route

Routing selects decision gates and artifacts, not worker count. The router owns
the route table; do not restate it here.

The route and material intent are immutable for an active session. Capture a
material change as a revision or start a new task; never silently retain old
approvals across changed intent.

Plan-only mode is conservative and permanent. Pick safe defaults, record
assumptions, produce the plan, and stop without implementation, verification,
shipping, worktree creation, or other git mutation.

## Investigate defects before planning a fix

Classify a bug, defect, incident, regression, or flaky failure as an
investigation. Reproduce the current failure, preserve its observable evidence,
trace the exact causal code path, form one falsifiable root-cause claim, and ask
the user to confirm that claim before implementation.

Record complete proof as confirmed and ready for fix. If reproduction or
confirmation is incomplete, record the waiting state and pause. Diagnostic
instrumentation requires a bounded grant naming its purpose, allowed actions,
paths, expiry, and cleanup. It authorizes evidence collection only.

The state engine validates the proof against the active repository, task, and
fingerprint before execution. Do not reproduce that validation in prose or
infer a pass from narrative confidence.

## Build decision artifacts

Use the current versioned decision contracts accepted by the state helper.
JSON is canonical; HTML is a disposable human review projection and is never
parsed back into state.

A plan should communicate only what a reviewer or implementer needs:

- decision question, recommendation, intended outcome, and scope boundaries;
- inspected evidence with observation time, confidence, and conflicts,
  including the verified claim set and any premise found refuted or stale;
- alternatives and substantive tradeoffs;
- affected and newly created repository-relative paths;
- risks, triggers, recovery, validation, and acceptance criteria;
- bounded tasks with dependencies, read-first context, write ownership, and
  required outputs.

Never guess a path or fill required fields with generic prose; unresolved
material uncertainty makes the plan concerned or blocked.

For brainstorm routes, research multiple genuinely distinct approaches before
convergence. Record what evidence would change the recommendation, then promote
the approved direction into a plan. For full routes, record the approved
cross-scope decisions after the plan.

Record canonical artifacts through the engine:

```text
node <skill-directory>/scripts/gorkhali-state.mjs record --workspace <path> --type <brainstorm|plan|decisions> --status passed --input <json-file>
```

The input path is a transport into the canonical record, not a second durable
copy inside the session.

Validate canonical JSON before creating any human review page. When a review
page is useful, follow [review HTML guidance](review-html.md), generate the
disposable HTML from the validated JSON, and run
`scripts/validate-review-html.mjs` before presenting it. If file writing is
unavailable, present one fenced `json` block; if HTML generation or viewing is
unavailable, preserve JSON and present the same decision hierarchy in chat.

## Plan Quality Rules

### Machine-Checkable Acceptance Criteria

Every acceptance criterion must be verifiable by one of:

| Type | Form |
|------|------|
| Test command | `{TEST_CMD}` exits 0 |
| Lint/build | `{LINT_CMD} && {BUILD_CMD}` exits 0 |
| File existence | `[ -f src/foo.ts ]` |
| Grep match | `grep -r "export.*FooComponent" src/` finds a result |
| API/CLI output | `curl localhost:{DEV_PORT}/health` returns `{"status":"ok"}` |
| Snapshot/diff | `git diff --name-only` includes expected file |

Command placeholders resolve through the discovery precedence in
[verification](verification.md); `{DEV_PORT}` comes from dev-server config or
startup output. Never assume a fixed port or leave a placeholder unresolved.

These forms fail the plan immediately: `TBD`, `TODO`, `TBC`, "similar to Task
N", "etc.", "and so on", "as needed", "if necessary", "where appropriate",
"appropriate error handling", "proper validation", "update tests accordingly".
If any appears in an acceptance criterion, task description, or task action, the
plan is incomplete. Rewrite it as a command or an observable fact.

### Requirement Coverage

Trace every acceptance criterion to at least one task before recording the plan.
A criterion with no matching task is a coverage gap: add the task or remove the
criterion. Reject and revise the plan the same way when a task owns no file or
a dependency names a task that does not exist.

### Research-Free Tasking

Every task must reach its implementer research-free: read-first paths, exact
files, the pattern to follow, and the contract are all resolved during planning.
If executing a task would require exploring the repository, searching
documentation, or making a design decision, the plan is incomplete. Re-decompose
it; raising the implementer model never remedies weak scoping.

## Decision-First Plan Artifact (mandatory at every plan gate)

A plan is a researched recommendation before it is an execution manifest, for
research work as much as implementation work.

At standard and deep depth, completeness means useful content, not populated
keys: evidence carries a decision implication; alternatives carry distinct
benefits, costs, rejection reasons, and reconsideration conditions; assumptions
carry confidence, impact, and validation; risks carry likelihood, impact,
trigger, mitigation, and recovery; rationale runs to 2-4 substantive points; and
every task is an executable dossier. Quick plans stay concise and may omit
alternatives, solution shape, and task-local risk and recovery when those are
genuinely not applicable. Never invent architecture or fake alternatives to
satisfy a template.

Use evidence states, not unsupported numeric confidence: `verified`,
`supported`, `inferred`, or `unknown`. Each item cites a repository location,
command result, or authoritative URL. Keep unresolved questions explicit and
mark whether they block approval.

### Human review order

A human review page chooses its own design but must use this order:

1. Executive decision brief: approval question, recommendation, rationale, and
   pending calls.
2. Outcome, scope, and architecture.
3. Research findings, evidence, alternatives, assumptions, and risks.
4. Validation strategy and observable definition of done.
5. Execution appendix: affected files, waves, task dossiers, and dependencies.
6. Plan check, review provenance, and unrecognized compatibility fields.

The first screen must answer what is being approved, what is recommended, why,
what remains uncertain, and what happens if the choice is wrong. Tasks and waves
never lead the gate.

## Collect approvals

Approvals follow the route and bind to the current passed decision artifacts:

```text
node <skill-directory>/scripts/gorkhali-state.mjs approve --workspace <path> --gate direction
node <skill-directory>/scripts/gorkhali-state.mjs approve --workspace <path> --gate plan
node <skill-directory>/scripts/gorkhali-state.mjs approve --workspace <path> --gate wiring
```

`lite` and `direct` have no decision approval; `plan` requires plan approval;
`brainstorm` requires direction before plan; `full` additionally requires
wiring. New decision artifacts invalidate dependent approvals through the
engine. Never carry approval forward manually.

After the required decision gates pass, ask for explicit implementation
authorization. If it is denied, unavailable, or ambiguous, pause with the plan
and exact next safe action. Shipping authorization is deliberately not part of
this phase.
