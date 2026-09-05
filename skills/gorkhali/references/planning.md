# Planning

Load when starting, resuming, investigating, choosing direction, or preparing
implementation. Produces decision-useful artifacts; does not authorize code
mutation or external lifecycle actions.

## Establish current truth

1. Run compact `status` first. Resume a matching active session rather than
   replacing it.
2. Read the nearest repository instructions and relevant learnings. A recorded
   failed correction blocks repeating that approach unless current evidence
   explains why this case differs.
3. Trace the current code path and existing patterns. For shared or refactored
   surfaces, inspect dependency impact with a native graph or the bundled
   read-only impact analyzer. A `research` worker traces and drafts the
   plan; the orchestrator ingests fields, never source files.
4. Record capability availability without destructive probes. A fallback must
   be visible and preserve the same decision or evidence contract.
5. Apply the minimum-sufficient ladder after understanding the code path:
   omit unnecessary machinery, reuse the repository, prefer standard or native
   behavior, reuse installed dependencies, then write the smallest custom
   implementation that completely satisfies the approved outcome.
6. Verify the request's claims before planning against them. A ticket or a
   reported behavior is a hypothesis: classify every claim the plan depends on
   as `confirmed`, `refuted`, or `stale` against a repository location or
   command result. A refuted or stale premise still stops planning; report it
   and do not proceed to the gate.
7. Measure what is measurable. Read reported limits, counts, sizes, dimensions,
   and contrast; never estimate. A design artifact or schema is the intended
   result; a neighboring file shows only what exists today.

## Classify the route

Routing selects gates and artifacts, not worker count. Do not restate the
route table.

The route and material intent are immutable for an active session. Capture a
material change as a revision or new task; never silently retain old
approvals across changed intent.

Plan-only mode is conservative and permanent. Pick safe defaults, record
assumptions, produce the plan, and stop — no implementation, verification,
shipping, worktree, or git mutation.

## Investigate defects before a fix

Classify a bug, defect, incident, regression, or flaky failure as an
investigation. Reproduce it, preserve observable evidence, trace the exact
causal path, form one falsifiable root-cause claim, and get user confirmation
before implementation.

Record complete proof as confirmed and ready for fix. Incomplete reproduction
or confirmation pauses. Diagnostic instrumentation needs a bounded grant
(purpose, actions, paths, expiry, cleanup) and authorizes evidence collection
only.

The state engine validates the proof against the active repository, task, and
fingerprint before execution. Do not reproduce that validation in prose or
infer a pass from narrative confidence.

## Build decision artifacts

Use the current versioned decision contracts. JSON is canonical; HTML is a
disposable review projection, never parsed back into state.

A plan should communicate only what a reviewer or implementer needs:

- briefing: What is being tackled, the Problem it solves, and How the
  recommendation works, in the plain-English voice of
  [review-html.md](review-html.md); it is quoted verbatim onto the gate;
- decision question, recommendation, intended outcome, and scope boundaries;
- inspected evidence with observation time, confidence, and conflicts,
  including the verified claim set and any premise found refuted or stale;
- alternatives and substantive tradeoffs;
- affected and newly created repository-relative paths;
- risks, triggers, recovery, validation, and acceptance criteria;
- bounded tasks with dependencies, read-first context, write ownership, and
  required outputs.

Never guess a path or pad required fields with generic prose; unresolved
material uncertainty makes the plan concerned or blocked.

For brainstorm routes, research genuinely distinct approaches before convergence.
Record what evidence would change the recommendation, then promote the approved
direction into a plan. For full routes, record approved cross-scope decisions
after the plan.

Record canonical artifacts through the engine:

```text
node <skill-directory>/scripts/gorkhali-state.mjs record --workspace <path> --type <brainstorm|plan|decisions> --status passed --input <json-file>
```

Validate canonical JSON before creating any human review page. When a review
page is useful, follow [review HTML guidance](review-html.md), generate the
disposable HTML from the validated JSON, and run
`scripts/validate-review-html.mjs --target artifact|file` before presenting it.
Publish an artifact and give its URL, or open a file; a failed publish falls back
to `file`. If file writing is unavailable, present one fenced `json` block; if
HTML generation or viewing is unavailable, preserve JSON and present the same
What/Problem/How brief in chat.

## Plan Quality Rules

### Acceptance Criteria

Every acceptance criterion must be verifiable by one of:

| Type | Form |
|------|------|
| Test command | `{TEST_CMD}` exits 0 |
| Lint/build | `{LINT_CMD} && {BUILD_CMD}` exits 0 |
| File existence | `[ -f src/foo.ts ]` |
| Grep match | `grep -r "export.*FooComponent" src/` finds a result |
| API/CLI output | `curl localhost:{DEV_PORT}/health` returns `{"status":"ok"}` |
| Snapshot/diff | `git diff --name-only` includes expected file |

Placeholders resolve through the discovery precedence in
[verification](verification.md); `{DEV_PORT}` comes from dev-server config or
startup output. Never assume a fixed port or leave a placeholder unresolved.

These forms fail the plan immediately: `TBD`, `TODO`, `TBC`, "similar to Task
N", "etc.", "and so on", "as needed", "if necessary", "where appropriate",
"appropriate error handling", "proper validation", "update tests accordingly".
If any appears in an acceptance criterion, task description, or action, rewrite
it as a command or an observable fact.

### Cross-cutting (standard/deep; always on `full`)

Record `crossCutting` with closed keys `security`, `privacy`, `observability`,
`rollout`, `docs`, each `{ status: "n/a"|"note", detail }`. `n/a` needs a
one-line reason. Quick plans omit the object. Do not invent architecture to
fill a key. `outcome.signal` is optional product/UX language beside mechanical
`doneWhen`.

### Contracts are not a planning gate

`plan.json` is canonical. `contract` is an optional post-approval projection
for API/UI detail. Do not wait on `contracts/*.html` or treat it as a second
source of truth.

### Coverage and research-free tasks

Every acceptance criterion maps to a task; every task owns a file; every
dependency names a real task. Every task is research-free: read-first paths,
exact files, the pattern, and the contract are resolved here. Exploring the
repo or making a design decision during implementation means the plan is
incomplete. Raising the implementer model never remedies weak scoping.

## Decision-First Plan Artifact (mandatory at every plan gate)

A plan is a researched recommendation before it is an execution manifest.

At standard and deep depth, completeness is useful content, not populated
keys: evidence implies a decision; alternatives have distinct benefits, costs,
rejection reasons, and reconsideration conditions; assumptions have confidence,
impact, and validation; risks have likelihood, impact, trigger, mitigation, and
recovery; rationale is 2-4 points; every task is an executable dossier. Quick
plans may omit alternatives, solution shape, and task-local risk when not
applicable. Never invent architecture or fake alternatives to fill a template.

Use evidence states, not unsupported numeric confidence: `verified`,
`supported`, `inferred`, or `unknown`. Cite a repository location, command
result, or authoritative URL. Keep unresolved questions explicit and mark
whether they block approval.

### Human review order

A review page chooses its design but must use this order:

1. Plain-English briefing: What (`briefing.tackling`), Problem
   (`briefing.problem`), and How (`briefing.how`).
2. Evidence, scope, risks, and open questions, then the approval question.
3. Outcome, architecture, alternatives, assumptions, and validation.
4. Execution appendix inside a collapsed `<details>` element with no `open`
   attribute: affected files, waves, task dossiers, and dependencies.
5. Plan check, review provenance, and unrecognized compatibility fields.

The first screen must answer what is being tackled, the problem, how the
recommendation works, what evidence supports that How, what remains uncertain,
and whether to approve. A How without supporting evidence is an assumption:
record it in `assumptions`, never present it as a finding. Tasks and waves never
lead the gate and never appear in the chat brief.

## Collect approvals

Approvals follow the route and bind to the current passed decision artifacts:

```text
node <skill-directory>/scripts/gorkhali-state.mjs approve --workspace <path> --gate direction
node <skill-directory>/scripts/gorkhali-state.mjs approve --workspace <path> --gate plan
node <skill-directory>/scripts/gorkhali-state.mjs approve --workspace <path> --gate wiring
```

`lite` and `direct` have no decision approval; `plan` requires plan approval;
`brainstorm` requires direction before plan; `full` additionally requires
wiring. New decision artifacts invalidate dependent approvals. Never carry
approval forward manually.

After required decision gates pass, ask for explicit implementation
authorization. If denied, unavailable, or ambiguous, pause with the plan and
the next safe action. Shipping authorization is not part of this phase.
