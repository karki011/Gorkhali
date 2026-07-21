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
| Lens | `balanced` | none | Inspect visual behavior. Output scenarios, evidence, differences, and unverified states. |
| Archer | `deep` | none | Review cross-file structure and integration. Output dependency risks and actionable findings. |
| Rival | `balanced` | none | Challenge a proposed plan. Output missing assumptions, counterexamples, and verdict. |
| Plan-checker | `balanced` | none | Validate scope, ordering, learnings, coverage, and blast radius before execution. |
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

## Delegation contract

When the host supports structured output, use delegation contract version `1`.
The task shape is:

```json
{
  "contract_version": 1,
  "task_id": "T1",
  "role": "Blade",
  "profile": "balanced",
  "objective": "Implement one bounded change",
  "context_refs": [{ "id": "plan", "kind": "artifact", "ref": "current-plan" }],
  "requires_judgment": false,
  "inputs": {},
  "constraints": [],
  "deliverables": ["Scoped implementation"],
  "acceptance_criteria": ["Focused checks pass"],
  "write_scope": ["owned/path"]
}
```

Context references are typed pointers to an artifact, resource, or conversation
already available to the host. They do not require a shared filesystem or
provider-specific state service. Keep large shared context at its source and
pass only the minimum task-specific inputs.

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

The worker returns version `1` as
`{ contract_version, task_id, status, output, error }`. For `status: "ok"`,
`output` is an object and `error` is `null`; for `status: "error"`, `output` is
`null` and `error` is `{ code, message, retryable }`. Put interpretive prose
inside a typed output field instead of replacing the envelope.

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
