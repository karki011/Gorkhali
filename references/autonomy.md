# Scoped autonomous work

Apply this path only to requests to implement work. A request for advice, a plan,
or read-only review is not implementation authorization. Honor an explicit request
to wait, seek approval, or stop at a particular stage.

For a clear ticket or described task, inspect the repository and write the normal
plan. If acceptance criteria, affected callers, ownership, and implementation path
are understood and no clarification is needed, estimate the complete change and
record:

```json
{
  "baseHead": "full current commit ID from snapshot",
  "autonomy": {
    "wellScoped": true,
    "estimatedImplementationLines": 80,
    "openQuestions": [],
    "ticketProvided": false
  }
}
```

Use `approve` with `{autonomous:true}` when eligible. The runtime limit is
`LINE_LIMIT` in `lib/autonomy.js`: fewer than 300 implementation lines, across the
whole plan. Added and deleted lines both count; a replaced line counts twice.
Exclude test code, comment-only lines, and blank lines. A line containing code and
an inline comment counts as code. Docstrings, runtime strings, configuration, and
documentation text are not automatically comments or tests. Do not minify code,
drop tests, relabel production helpers as tests, or split a request to fit the limit.
An uncertain estimate or classification requires clarification or normal approval.

Present a short scope and verification update, then proceed without waiting for a
plan yes/no. This is policy authorization, never a claim that the user approved a
plan. Repository restrictions, tool permissions, independent review, human visual
confirmation when applicable, and human-only merge still apply. A clarification,
scope/dependency amendment, or reaching 300 implementation lines switches to the
normal explicit approval path. Preserve completed work and show the amended plan;
do not discard it or restart the session to reset its size allowance.

Supplied tickets must be bound and read before approval and follow every tracking
stage. For an eligible description without a ticket, approval records an explicit
`autonomous-policy` no-ticket decision; do not interrupt just to ask the optional
tracking question or pretend the user answered it. Non-autonomous work keeps the
normal intake question. Resume reuses the recorded decision and original base.

## Measure the actual diff

The original autonomous approval records its base commit, plan hash, branch, and
checkout. `scope` with no input returns every changed file's added-plus-deleted
line total against that base. After integrating committed work, provide `scope`
with a complete classification when the raw total reaches the limit:

```json
{
  "files": [
    {"file":"src/work.js","implementation":42,"tests":0,"comments":0,"blank":2,"reason":"Two blank-only lines"},
    {"file":"test/work.test.js","implementation":0,"tests":340,"comments":0,"blank":0,"reason":"Test assertions; no runtime consumers"}
  ]
}
```

Categories are disjoint and must sum to Git's total for each file. Count the full
base-to-current diff, including earlier tasks and repairs. Read the old and new
source to distinguish comments from strings and test code from production helpers;
file names alone are not proof. Unknown or binary content needs human approval.
The CLI checks coverage and arithmetic; language-aware classification is evidence
from the roles, not a universal parser. Exclusions always need a concrete reason.
Saved classifications become stale when Git content or identity changes.

Engineer stops and reports if the estimate no longer fits. Before another task or
repair, the runtime accepts either a conservative raw total below the limit or a
current complete classification below it. At final verification, Inspector must
independently classify every changed file in `scopeFiles`, even for tiny changes.
Auditor checks those exclusions against the complete diff and sets
`scopeReviewed:true` only when the measured implementation size and scope are
correct. Autonomous work always requires this current independent review,
including repairs after a PR; the post-ship Auditor waiver does not apply.

The [no-code-comments rule](code-comments.md) applies in every mode, independently
of autonomous eligibility or line counting.
