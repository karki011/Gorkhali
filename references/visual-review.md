# Reuse visual approval for the approved experience

Human visual approval concerns the user-visible acceptance criteria, not a commit
ID. Never ask for another "pass" merely because a repair changed HEAD, refreshed
tests, or invalidated Inspector/Auditor evidence.

For user-visible work, define the acceptance scope in the plan:

```json
{
  "visualReview": {
    "scope": "Device list search and status indicators",
    "checklist": [
      "Revoked devices remain searchable by their revoked status",
      "A revoked collector uses the gray inactive indicator"
    ]
  }
}
```

Describe expected behavior rather than implementation details or commit hashes.
Keep this scope stable for refactors, tests, internal repairs, and fixes restoring
that behavior. A color correction or search fix implementing an already accepted
requirement does not automatically constitute a new design decision. Do not alter
the checklist solely to manufacture a fresh confirmation gate.

Before requesting human review, call `visual-status`. If `reusable:true`, continue
with fresh mechanical verification and the applicable independent review. Do not
ask the user to repeat their approval or overwrite the original approval record.
This also applies to post-ship repairs when the Auditor waiver is available.
Amended plans still need a current Auditor review, even when their visual
acceptance is unchanged and the human approval carries forward.

For an initial review, show the concrete expected results and record the user's
pass with `human-confirmation`. It records the approved scope and Git context.
Future descendant commits in the same checkout and branch reuse that approval
when the scope is unchanged. Plans without `visualReview` use their full plan hash
as the conservative scope; unchanged-plan repairs still reuse approval.

Ask again only when the acceptance scope actually changes or existing approval
cannot be established. Present the specific new design/behavior decision, batch
related changes, and avoid ritual "reply pass for this commit" messages. Material
changes to layout, interaction, workflows, or expected behavior belong in an
amended visual scope and the normal plan-approval process. Do not conceal scope
changes by leaving an obsolete checklist untouched or marking the work non-visual.
Auditor checks that the declared scope still covers the implementation.

Git divergence and uncommitted work require reconciliation, not a new visual pass
as a shortcut. Mechanical and independent-review evidence remains tied to current
code and must be refreshed according to the verification policy.

Legacy confirmations without scope metadata remain usable at their original
fingerprint. Once that state changes, they cannot be carried forward automatically;
one scoped confirmation establishes reuse for subsequent repairs. Never fabricate
that approval from passing tests, agent opinion, or an inferred user response.
