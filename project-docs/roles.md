# Roles and Compute

Phantom roles are behavioral contracts for bounded workflow nodes. They are not
resident personas, a mandatory team, or a fixed handoff sequence. The compiled
workflow selects only the passes justified by route, risk, dependencies, and
acceptance criteria.

## Role Contracts

| Role | Default profile | Responsibility |
|---|---|---|
| Apex | `frontier` | Route, scope, coordinate, validate, and synthesize |
| Blade | `balanced` | Implement one bounded write scope |
| Ward | `economy` | Run declared deterministic checks without editing |
| Gaze | `balanced` | Independently review and record complete findings |
| Sage | `deep` | Give bounded advisory guidance when work is stuck |
| Lens | `balanced` | Inspect user-visible behavior when visual evidence matters |
| Archer | `balanced` | Review cross-file structure and integration when warranted |
| Rival | `balanced` | Challenge a material planning decision |
| Plan-checker | `balanced` | Validate plan coverage and ordering |
| Hound | `deep` | Reproduce and trace an unconfirmed defect |
| Sweep | `economy` | Apply the post-check minimum-sufficient complexity pass |
| Warden | `economy` | Perform an explicitly authorized lifecycle operation |

A small, clear task may stay entirely in the current context. Deterministic
checks normally run there too. An independent reviewer, visual pass, structural
pass, or specialist is added only when the workflow's risk policy or measurable
criteria require it.

## Execution Topology

Topology is chosen after dependency inspection:

| Topology | Use |
|---|---|
| `current-agent` | One clear objective, tightly coupled work, or shared-write hotspot |
| `native-serial` | Isolated contexts help, but dependency order prevents parallel work |
| `native-parallel` | Independent scopes have non-overlapping ownership and no unresolved producer-consumer edge |

File count alone does not trigger delegation. Phantom does not create a worker
to repeat a check that already ran or to rubber-stamp another worker. When
native delegation is unavailable, the same required passes run as fresh labeled
sequential work; missing delegation does not add or remove gates.

Delegated tasks and results use versioned envelopes with explicit scope,
artifact digests, acceptance criteria, requested profile, findings, risks, and
checks. A malformed result gets one bounded correction attempt and cannot be
silently accepted.

## Semantic Compute Profiles

| Profile | Intended use |
|---|---|
| `inherit` | Keep the active model when selection is unavailable or deliberately omitted |
| `economy` | Deterministic, mechanical, bounded work |
| `balanced` | Scoped implementation, coordination, and ordinary review |
| `deep` | Architecture, forensics, ambiguity, and high-risk review |
| `frontier` | Orchestration, decomposition, and final synthesis |

Profiles express desired capability, not a hard-coded model family. Concrete
host mappings live only in
`skills/phantom/references/model-presets.json`. Resolution order is explicit
user choice, optional external map, bundled preset, then active-model
inheritance.

Effort is profile-specific and evidence-driven. Phantom does not impose one
effort setting on every task. A host without model selection inherits the
active model while preserving the workflow, artifacts, and acceptance policy.

## Findings and Acceptance

Reviewers record every evidence-backed supported severity. Deterministic policy
then decides which findings block the node. Lower-severity findings are not
discarded, and a fixed severity shortcut does not replace the workflow's
acceptance criteria.

The verification contract is in
[`skills/phantom/references/verification.md`](../skills/phantom/references/verification.md),
with role and compute policy in
[`roles.md`](../skills/phantom/references/roles.md) and
[`models.md`](../skills/phantom/references/models.md).
