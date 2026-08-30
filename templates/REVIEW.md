# Review instructions

Copy to the repository root or `.github/REVIEW.md`. Reviewers read this when
present and treat it as the highest-priority review-only instruction. Absence
is not a gap.

## Passes

Run three passes and tag each finding with its pass:

- Bugs: logic errors, broken edge cases, subtle regressions
- Security: the named categories in the review standard
- Compliance: the change matches the approved plan and stated intent

## Severity

Reserve `blocking` for a diff that makes something worse than it was, or that
fails the stated intent. Everything else that is worth saying is `advisory`.
Style, naming, and anything CI already enforces are not reported.

## Cap the noise

Report at most five advisories; summarize the rest as a count.

## Do not report

Generated files and anything a required check already enforces.

## Plan compliance

When a mechanical `plan-compliance` report is supplied: `wrong` is blocking,
`drift` is advisory unless required proof files are missing, `n/a` is not a pass.
