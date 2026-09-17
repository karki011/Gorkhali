---
name: start
description: Start a feature, fix, or refactor with a small approved plan, risk-aware routing, and serial Engineer work on the integration branch.
allowed-tools: ["Agent", "Read", "Write", "Bash", "Grep", "Glob"]
user-invocable: true
---

# Start

Read `../references/lifecycle.md`. Open the session and inspect the request, current Git state,
repo instructions, preferences, and relevant callers. If on the default branch,
call CLI `branch` with an appropriate feature name before planning. Do not invoke Detective
merely because the request describes a bug. Use it for unclear, repeated,
flaky, timing-sensitive, or cross-cutting failures that need diagnosis.

Follow `../references/tracking.md` at intake. Bind any supplied ticket number/URL
and fetch its requirements. Assess `../references/autonomy.md` before asking the
optional ticket question: an eligible described task can proceed without it.
Otherwise ask whether the user has a ticket/task number. Persist the tracking
decision before implementation and reuse it on resume.

## Plan and approve

The orchestrator plans. Quick work gets one short task; normal work gets coherent
tasks; ambiguous work gets a brief discussion of alternatives. Optional read-only
scouting is justified only by missing context. Opposition critiques only an
ambiguous or high-risk plan, and re-runs only if that uncertainty remains.

Write a valid plan using CLI `plan`.
Required fields are the schema's briefing, decision, outcome, scope, and tasks with explicit acceptance criteria.
Derive task verification commands from actual repository scripts, CI, and test imports; never assume a runner from file names or install one just to check work.
Record `baseHead` from snapshot for the review range.
For user-visible work, record `visualReview:{scope,checklist}` with concrete expected
behavior under `../references/visual-review.md`. Keep that scope stable for repairs
that restore the agreed behavior; implementation details belong in tasks.
Optional task fields are `dependsOn` and `riskSignals`; `parallelSafe`, `coordinationKeys`, and `isolation` are accepted for saved-plan compatibility and ignored.
Use concrete repository-relative files or directories.
Order a schema, migration, or public-contract change before its consumers with `dependsOn`.

Follow `../references/autonomy.md`. For clear work below its implementation-line
limit, record the estimate and intake facts in `plan.autonomy`, announce the scope,
and call `approve` with `{autonomous:true}` without a confirmation question.
Otherwise present What, Problem, How, Evidence, Scope, Risks, and Open questions in
plain English and obtain approval for this exact plan, then call `approve` with
`{confirmed:true}`. Existing explicit approval counts. Ambiguity or a later scope
amendment requires a human decision rather than a fresh autonomous allowance.

## Execute

Call `route` and show the task order and reasoning.
Every wave holds exactly one task; tasks run in dependency order, then plan order.
Before the first dispatch, complete tracking stage `start`: preserve or set assignment and move to In Progress using the provider's actual workflow.
Call `dispatch` before spawning, persisting the approved base commit and task ID.
Spawn `gorkhali:engineer` with the selected model and without any Agent isolation, so it runs directly in the integration checkout.
Include the task, declared ownership, base commit, absolute plugin root/library paths, integration checkout path, session directory, unique `attemptId`, task hash, and preferences.
For autonomous work also include the full plan estimate, original approval base,
current cumulative scope, and `../references/autonomy.md`.
Do not use agent teams.
Every Engineer must call `prepareBranch` before editing; it verifies the integration checkout is clean and sitting at the wave base.
A base that cannot be verified blocks dispatch; an Engineer never edits a dirty or moved integration tree.

Collect the structured outcome through CLI `result`, including failed, blocked, and needs-context outcomes.
Persist `attemptId` exactly as dispatched.
Failures must use bounded `recover`; ordinary dispatch cannot bypass them.
A successful result remains active until integrated.
Call CLI `integrate` with that one completion record before dispatching the next task.
Integration checks every commit for ownership, the current task/dependency revision, dependency ancestry, and that the recorded head is the integration branch HEAD.
Never mark a returned task integrated until Git and the journal prove it.
Ownership violations require scope reconciliation and, when the plan changes, a full re-presentation of the amended plan before the new approval.
Never reset away work.

Dispatch the next task only after integration.
For autonomous work, use `scope` to classify committed changes when the raw diff
reaches the limit. Count from the original approval base across all tasks; pause
for human approval if implementation itself reaches the limit.
Do not spawn an Inspector or Auditor between tasks.
An intermediate Inspector is justified only when later tasks need a risky change proven before proceeding, and it never brings an Auditor.

## Review with the user, then wrap

After the last task integrates, for `userVisible:true` check `visual-status`. Reuse
existing approval when available; otherwise present the checklist under `verify`.
Each design note becomes a plan amendment through `plan`, `approve`, `dispatch`,
and `integrate`. Batch changes before refreshing machine verification. Only changes
to visual acceptance invalidate the human pass, not every implementation commit.
When visual approval is reusable, the user says the result is right, or nothing is
user-visible, invoke `wrap` yourself and follow it to the end; it runs `verify` once
on the final integrated commit and then ships.
Do not stop to ask whether to continue.
When the request or the plan approval already asked for a PR, wrap ships without asking again; otherwise wrap asks for ship authorization at its ship step, and that is the only pause between the user's pass and the PR.
