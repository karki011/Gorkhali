# SDLC artifact chain

Committed dual-readable markdown that a later stage can read. Canonical
lifecycle state remains session JSON. These files are projections, like
review HTML, not a second source of truth.

## What each stage writes

| Stage | Canonical | Projection | Gate |
|---|---|---|---|
| Plan | `intent.json` | session `intent.md`; wrap copies to `.gorkhali/sdlc/<task>/` | Operator running start is originator; foreign `draft` stays plan-only |
| Design | `brainstorm.json` | `spec.md` beside that intent when a brainstorm exists | Direction approval |
| Build | `plan.json` | `plan.md` | Plan approval, then implementation authorization |
| Test | verification artifact | evidence in the PR body | Inspector pass |
| Deploy | review artifact + ready-for-review PR | PR thread | Independent review, then `ship-pr` |
| Maintain | defect-proof / new intent | a new `intent.md` | Investigation before mutation |

`start` writes the Plan projection into the session (`intent.md` next to
`intent.json`). `start` also reads a product-repo intent file when present.
`wrap` renders the chain into the product repository and stages it with the
change. `review` runs mechanical plan-compliance against the diff.

CLI stdout is a compact receipt (`written`, `found`, `status`). Projection
bodies stay on disk. Do not pretty-print JSON into the model.

## Source of truth

Name one system per artifact:

- Session JSON is canonical for gates.
- The markdown projection is the human/audit copy in the product repo.
- A tracker (Jira or equivalent) may hold a copy or a link. Every projection
  carries a Linkage block with task id, tracker id, and commit SHA. Missing
  values are `_Not recorded`, never invented.

## Policy skills versus workflow skills

Write a skill for institutional knowledge that must apply the same way every
time (security standard, brand rule, API convention). Do not write a skill for
commands, architecture notes, or repeated mistakes — those belong in
repository instructions (`AGENTS.md` or the host equivalent) and in learnings.

A skill is advisory. A hook or a CI check is the deterministic layer behind it
when the rule must always hold.

## Twice rule

When the same correction is already recorded as `[failed]`, propose promoting
it into repository instructions. Do not edit those files without approval.

## Helper

```text
node <skill-directory>/scripts/sdlc-chain.mjs ingest --workspace <path> --task <id>
node <skill-directory>/scripts/sdlc-chain.mjs render --session <dir> --out .gorkhali/sdlc/<task>
node <skill-directory>/scripts/sdlc-chain.mjs plan-compliance --session <dir> --changed a.ts,b.ts
```

Plan-compliance statuses: `aligned`, `drift`, `wrong`, `n/a`. `n/a` is not a
pass. `wrong` means the diff shares no planned files and fails the stated plan.
