# Execution

Load this phase only after the required decision artifacts and approvals are
current. Execution turns the approved plan into bounded implementation work;
it never grants shipping authority.

## Enter through the engine

Inspect compact status and confirm the intended task, route, plan-only mode,
and decision gates. Ask the user for explicit implementation authorization,
then record it:

```text
node <skill-directory>/scripts/gorkhali-state.mjs authorize --workspace <path> --scope implementation
node <skill-directory>/scripts/gorkhali-state.mjs execute --workspace <path>
```

Let the state helper reject missing or stale prerequisites. Do not infer that a
chat acknowledgment, approved plan, previous session, or shipping request
substitutes for implementation authorization. A plan-only session cannot enter
execution.

For investigation work, execution also requires current confirmed defect proof.
If the proof is missing, contradictory, stale, or waiting for evidence, return
to investigation or pause; do not mutate toward an unconfirmed hypothesis.

## Prepare bounded assignments

Turn each approved task into a compact assignment containing:

- objective and checkable acceptance criteria;
- repository-relative read-first and owned-write paths;
- dependencies and producer-consumer order;
- relevant instructions, corrections, and risk triggers;
- the failure modes a reviewer would raise for this scope, handled in the same
  change;
- required checks and declared output contract;
- current task identity and baseline fingerprint reference.

Pass context references, not copied conversation or complete session envelopes.
Persist one typed delegation task before a delegated pass and one typed result
after it. Retry a malformed result once with its validation errors; if it stays
invalid, fail or escalate visibly rather than accepting it.

## Choose the smallest useful topology

Use the current agent for one tightly coupled scope. Use serial isolated passes
when distinct judgment helps but writes depend on each other. Use parallel
delegates only for proven independent scopes with non-overlapping write
ownership and no unresolved dependency edge.

State the roster before spawning it: one line per delegate naming its role,
objective, and owned write scope, plus how many run at once. Five concurrent
delegates is the ceiling, and it counts every live delegate whatever its role,
because past that the coordination and context each one carries cost more than
the parallelism returns. Exceeding the ceiling requires the user's explicit
agreement, and so does widening a wave beyond the roster they have already
seen. Keep the count at the smallest number the proven independent scopes
justify, and batch related assignments into fewer delegates rather than adding
workers. A large gateless fan-out is a workflow recommendation, not a silent
escalation.

Session bootstrap is coordinator work, not a wave: reading instructions,
corrections, durable status, and repository patterns to reach a route belongs
in the current context. A bounded research step that an approved route defines
is the exception, and it counts against the ceiling like any other spawn.

### Treat a silent delegate as failed

A delegate's recorded typed result, not its liveness signal, is the
deliverable. Record the delegation task before the pass and require the worker
to persist its result through the state helper before it reports.

Give every wave a bound stated up front, in wall time or coordinator turns.
When the bound passes with no recorded result, stop waiting: reap that
delegate, name the unfinished assignment, and either reassign it once with the
prior failure as context or complete it in the coordinating context. Never poll
a wave indefinitely, and never let a missing result read as a wave that might
still land.

Use native delegation only. Never launch another copy of the active runtime or
assume that parent instructions automatically reach a worker. Inject the
bounded assignment and required rules explicitly. If delegation is unavailable,
run the same role contracts as labeled sequential passes without removing any
gate.

Specialists are not routine implementation workers. Register their requirement
only when observed risk calls for them; their evidence belongs to the later
quality phase.

## Implement and preserve state

Stay within approved scope. Preserve unrelated edits and shared-file ownership.
Use repository-native patterns and the selected minimum-sufficient solution.

When new evidence invalidates the plan, stop and revise the decision artifact
instead of expanding scope silently.

Name the failure modes a reviewer would raise before writing the scope, such as
empty, duplicate, or absent inputs, stale cache keys, and permission
boundaries, and handle them in the same change rather than in a follow-up after
review. Do not invent a threshold, breakpoint, or limit the approved outcome
does not specify; when one is genuinely needed, it is a plan revision.

Record execution evidence through the state helper using the canonical payload
once. Keep timestamps, hashes, run identifiers, and routing diagnostics in the
machine record; return only the compact receipt to the coordinating agent.

Before context loss or when blocked, pause with completed criteria, incomplete
criteria, changed paths, current dirty state, decisions, checks, blockers, and
the exact next safe action:

```text
node <skill-directory>/scripts/gorkhali-state.mjs pause --workspace <path> --reason <text>
```

On resume, reread repository instructions and corrections, compare the current
worktree with recorded state, and continue from the first incomplete criterion.
Do not repeat completed work unless evidence shows it is stale.

When implementation is complete, do not claim success or begin shipping. Hand
the unchanged current worktree to verification.
