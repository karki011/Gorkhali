# Actions

Each public entrypoint is a direct Agent Skill under `skills/<action>/SKILL.md`.
It applies the canonical `skills/phantom/` contracts and declares one portable
action. Hosts may display a namespace, but the action meaning and lifecycle
gates remain identical.

## Work Lifecycle

| Action | Purpose |
|---|---|
| `start` | Resume matching work or route and compile a new workflow; covers local planning and implementation only |
| `execute` | Run an approved compiled workflow after implementation authorization passes |
| `pause` | Persist the exact next action, evidence, dirty state, and blockers without external operations |
| `resume` | Validate workspace identity and continue from the first current incomplete node |
| `status` | Show the active session, workflow nodes, evidence, budgets, and blockers |
| `sessions` | List durable current, paused, completed, and resumable sessions |
| `wrap` | Finalize current evidence and optionally request a separately authorized idempotent draft pull request |
| `close` | Archive completed state after merge; any tracker or branch mutation needs its own authorization |

## Planning and Scoping

| Action | Purpose |
|---|---|
| `brainstorm` | Diverge and converge on options when direction is genuinely ambiguous |
| `contract` | Define scope, interfaces, acceptance criteria, and testable boundaries |
| `scout` | Inspect the codebase and dependencies without implementing |
| `wire` | Map dependency order, integration points, shared files, and legal execution waves |
| `recruit` | Request one bounded specialist pass when isolated expertise materially helps |

## Quality and Evidence

| Action | Purpose |
|---|---|
| `verify` | Run the deterministic checks declared by the current workflow node; never repairs or ships |
| `review` | Independently inspect a diff and record complete evidence-backed findings; never repairs or ships |
| `visual` | Gather visual evidence for implemented user-visible behavior |
| `visualflow` | Create a decision artifact for a proposed UI flow before implementation |
| `validate` | Audit completed session artifacts against contracts and requirements |
| `grill` | Challenge assumptions and the user's understanding of a change |

## Investigation and Repair

| Action | Purpose |
|---|---|
| `hound` | Reproduce and trace an unknown defect without guessing at a fix |
| `fix` | Apply a scoped repair only after the cause is confirmed, within a bounded evaluator loop |
| `greploop` | Assess external review feedback and apply only separately authorized pull-request updates |

## Knowledge and Operations

| Action | Purpose |
|---|---|
| `learn` | Record a correction or reusable pattern through the locked learning API |
| `evolve` | Consolidate and promote validated knowledge |
| `health` | Diagnose session, learning, artifact, and index integrity |
| `eval` | Evaluate workflow output and coordination against a declared rubric |
| `loop` | Perform one read-only ready-work triage pass and propose bounded next actions |

No action implicitly commits, pushes, opens a pull request, changes a ticket, or
deletes a branch. Those effects require a matching workflow node, current
evidence, an available capability, explicit user authorization, and an
idempotent capability request.
