---
name: start
description: Start a feature, fix, or refactor with a small approved plan, risk-aware routing, and isolated Engineer work.
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
and fetch its requirements; otherwise ask whether the user has a ticket/task number
to track the work. Persist their ticket or explicit no-ticket decision before plan
approval. Reuse an existing session's tracking decision.

## Plan and approve

The orchestrator plans. Quick work gets one short task; normal work gets coherent
tasks; ambiguous work gets a brief discussion of alternatives. Optional read-only
scouting is justified only by missing context. Opposition critiques only an
ambiguous or high-risk plan, and re-runs only if that uncertainty remains.

Write a valid plan using CLI `plan`. Required fields are the schema's briefing,
decision, outcome, scope, and tasks with explicit acceptance criteria. Derive task verification commands from actual repository scripts, CI, and test
imports; never assume a runner from file names or install one just to check work. Record
`baseHead` from snapshot for the review range. Optional task fields are
`dependsOn`, `parallelSafe`, `coordinationKeys`, and `riskSignals`.
Use concrete repository-relative files or directories; globs stay sequential.
Declare shared logical resources even if the files differ. Move a schema,
migration, or public-contract change into a preceding serial task; only its
independent consumers may then qualify for parallel work.

Present What, Problem, How, Evidence, Scope, Risks, and Open questions in plain
English. Obtain approval for this exact plan, then call `approve`. Existing
explicit approval counts; the quick route makes the plan smaller, not exempt.

## Execute

Call `route` and show the wave composition and reasoning. Before the first dispatch,
complete tracking stage `start`: preserve or set assignment and move to In Progress
using the provider's actual workflow. Call `dispatch` before
spawning, persisting the approved base commit and task IDs. For each ready task,
spawn `gorkhali:engineer` with the selected model and `isolation: "worktree"`
on the Agent call itself. Include the task, declared ownership, base commit,
absolute plugin root/library paths, integration worktree path, session directory, unique `attemptId`, task hash, and preferences. Do not use agent
teams. Every Engineer must use `prepareWorktree` to verify/fast-forward its own
clean worktree to the wave base before editing; host defaults can start elsewhere.
A worktree that cannot be isolated or aligned blocks dispatch, never falls back
to concurrent writes in the main checkout.

Collect every structured outcome through CLI `result`, including failed, blocked,
and needs-context outcomes. Persist `attemptId` exactly as dispatched. Failures must
use bounded `recover`; ordinary dispatch cannot bypass them. Successful results
remain active until integrated. Use CLI `integrate` in plan order after
the wave returns. Integration checks every source commit for ownership, current task/dependency
revisions, and dependency ancestry. Partial integration keeps remaining peers active.
Never mark a returned task integrated until Git and the journal prove it.
Ownership violations require scope reconciliation. Conflicts stop integration;
delegate resolution to a scoped Engineer in the integration worktree, preserve
the cherry-pick source marker, then retry integration. Never reset away work.

Run subsequent dependency waves only after integration. Default to one Inspector
and one Auditor after all waves. An intermediate Inspector is justified only when
later tasks need a risky wave proven before proceeding. Finish via `verify`.
