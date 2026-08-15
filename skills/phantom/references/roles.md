# Shadow role contracts

Roles are behavioral passes. Use native delegation when available; otherwise
perform them sequentially and label their outputs. The output contract remains
the same in either mode.

| Role | Profile | Write scope | Purpose and output contract |
|---|---|---|---|
| Apex | `frontier` | workspace | Route, scope, coordinate, and synthesize. Output decisions, dependencies, status, and next action. |
| Blade | `balanced` | scoped | Implement one bounded assignment. Output files changed, checks run, risks, and unresolved items. |
| Ward | `economy` | none | Run deterministic checks. Output commands, results, failures, and skipped checks. |
| Gaze | `deep` | none | Perform independent quality review. Output findings by severity with evidence and gate decision. |
| Sage | `deep` | none | Give brief advice when work is stuck. Output a bounded recommendation, not implementation. |
| Lens | `balanced` | none | On explicit user request only, inspect visual behavior and return advisory evidence; never replace user verification or become a lifecycle gate. |
| Archer | `deep` | none | Review cross-file structure and integration. Output dependency risks and actionable findings. |
| Rival | `balanced` | none | Challenge a proposed plan and validate scope, ordering, learnings, coverage, and blast radius before execution. Output missing assumptions, counterexamples, and verdict. |
| Hound | `deep` | none | Reproduce and trace a defect. Output evidence, exact code path, root-cause hypothesis, and confidence. |
| Sweep | `economy` | scoped | Reapply the solution ladder to remove unnecessary complexity without behavioral change. Output edits or a no-change result. |
| Warden | `economy` | scoped | Perform authorized lifecycle mechanics. Output actions, external links when available, and final state. |

## Orchestration ownership

Apex decides automatically whether delegation adds value; the user does not
need to choose workers, worker count, or models. Work directly when the task is
small, single-pass, tightly coupled, dominated by shared writes, or cheaper to
coordinate in one context. Delegate automatically when two or more bounded
workstreams are independent, a specialist should isolate noisy context, or a
fresh adversarial review materially improves confidence.

Honor an explicit user instruction to require, limit, or disable delegation
within repository safety, runtime permissions, and dependency constraints. When
the runtime requires approval, request it before spawning and preserve a
sequential fallback if approval is denied. Apex remains the default sole
delegator: a worker may not create more workers unless the plan explicitly
authorizes bounded nesting and the runtime provides it natively.

Delegation pays off on sizeable independent tracks and multiplies cost on
small ones, since every spawned worker carries its own coordination and
context overhead. Batch related small edits into one assignment rather than
handing out one agent per change; never spawn one worker per one-line edit.
Prefer a single worker whenever one suffices for the full scope. Keep spawn
counts low, and brief each worker fully on the first assignment so no
re-briefing round-trip is needed mid-task.

This is the portable-contract copy of this calibration, carried deliberately;
`reference/agents.md` is canonical for the native host agent-definition path.

### Generated-code style contract

Comments only for what code cannot express, at the file's existing density —
never narration. Every new test traces to an acceptance criterion or a fixed
defect — no speculative suites, sized to the change, prefer extending an
existing test file. PR body conciseness is owned by `reference/wrap/pr-body.md`
(pointer only).

Finish in a single run: no early stop before the role's own checks run and the completion record is written; implementing roles additionally land the commit.

## Delegation contract

When the host supports structured output, use delegation contract version `2`.
The task shape is:

```json
{
  "contract_version": 2,
  "task_id": "T1",
  "delegation_id": "delegation-T1-attempt-1",
  "role": "Blade",
  "profile": "balanced",
  "risk": "moderate",
  "objective": "Implement one bounded change",
  "requires_judgment": false,
  "locked_decisions": [],
  "corrections": [],
  "constraints": [],
  "deliverables": ["Scoped implementation"],
  "acceptance_criteria": ["Focused checks pass"],
  "write_scope": ["owned/path"],
  "context_refs": [{
    "id": "plan",
    "kind": "artifact",
    "source": "session",
    "locator": "plan.json",
    "content_sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "observed_at": "2026-01-01T00:00:00Z"
  }]
}
```

The canonical task is recursively key-sorted JSON encoded as UTF-8 and is at
most 64,000 bytes. It carries at most five locked decisions, five corrections,
eight constraints, eight deliverables, eight acceptance criteria, twelve write
scopes, and eight context references. References point to a workspace or
session file, bind its exact bytes with SHA-256, and reject absolute paths,
traversal, missing files, directories, and symlink escapes. Keep large context
at its source and pass only the minimum assignment-specific references.

Every delegated assignment must still include:

- the role and requested semantic profile;
- a single objective and explicit file or subsystem scope;
- repository rules and relevant corrections;
- the minimum-sufficient-solution ladder, including the requirement to select
  the first rung that fully satisfies the assignment and its safety bounds;
- required inputs and output contract;
- allowed write scope;
- verification expectations;
- a prohibition on unrelated changes.

The worker returns version `2` with the matching `task_id`, `delegation_id`, and
the SHA-256 `task_digest` of the accepted canonical task. Canonical result JSON
is at most 32,000 UTF-8 bytes and is never truncated. For `status: "ok"`,
`output` contains a summary of at most 8,000 bytes; required `files_changed`,
`checks`, `findings`, and `risks` arrays; and a required `blocker` that is
either `null` or at most 4,000 bytes. Paths must stay within `write_scope`.
Checks use `{ name, status, summary? }`, where status is `passed`, `failed`, or
`skipped` and summary is at most 2,000 bytes. String-array entries are at most
2,000 bytes. For `status: "error"`, `output` is `null` and `error` remains
`{ code, message, retryable }`.

Version `1` tasks cannot be newly recorded. A version `1` result is accepted
only to finish a matching version `1` task already recorded in the same run.

The worker must return the selected rung and brief evidence when that choice
materially shapes the implementation. Do not assume parent-session policy or
reasoning reaches a delegated context automatically.

The delegator validates each result before advancing. On a shape failure, retry
the same assignment once with the validation errors. If the retry also fails,
escalate it to a judgment-capable Apex pass and surface the structured failure;
never advance on malformed output. Parallelize only assignments without shared
writes or unresolved producer-consumer edges. Apex waits for every required
return, resolves conflicts against repository evidence and acceptance criteria,
and produces one synthesized result.

## Sequential fallback

When delegation is unavailable, Apex performs each required role as a separate
pass. Reset the pass objective, re-read the artifact under review, and avoid
using implementation intent as evidence. A sequential Gaze pass must still
search for defects independently rather than narrating the implementation.
When structured output is unavailable, preserve the same task and result fields
as labeled prose and validate them manually. Lack of a structured-output API
must not disable the sequential workflow or discard its acceptance gate.
