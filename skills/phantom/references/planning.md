# Decision-first planning

Planning exists to help a human understand and approve a researched direction.
Tasks and dependency waves are an execution appendix, not the primary result.

## Select depth

- `quick`: scope, pattern, risk, and deterministic verification are known. Use a
  concise plan and no fan-out.
- `standard`: dependencies or several components need inspection. Use targeted
  research and one independent critic.
- `deep`: the request is ambiguous, cross-cutting, hard to reverse, externally
  researched, or lacks a reliable verifier. Use bounded research fan-out.

Apex selects this depth and its delegation topology automatically from evidence;
do not ask the user to choose worker count or models. Quick planning does not
fan out; required execution or review passes may still use native delegation.
Standard work uses only the targeted passes it needs. Deep work fans out only
independent uncertainty and still uses the smallest useful worker set.

For a newly persisted `quick` plan, omit `solution_shape`, `change_set`, and
`readiness`; emit `scenarios`, `alternatives`, and `coverage` as empty arrays.
Do not use `null`, placeholder objects, or invented entries to fill the contract.

Apex stays on the `frontier` profile for framing and synthesis. Delegate scoped
reasoning to `balanced`, difficult specialist work to `deep`, and deterministic
checks to `economy`. If model selection is unavailable, inherit the active model
and record the fallback.

## Build the artifact

Capture these sections before decomposing work:

1. `summary`: one cohesive, plain-language paragraph that states the problem
   and its impact, the chosen direction, what the plan will put in place, and
   the expected outcome. Use 3-5 sentences. Do not mention task IDs, waves,
   agent roles, model names, files, or commands.
2. `decision`: approval question, recommendation, evidence-backed rationale,
   and `pending` or explicitly delegated status.
3. `outcome`: observable goal and definition of done.
4. `scope`: included work, exclusions, and hard constraints.
5. `solution_shape`: architecture summary, components, and data flow for
   standard/deep plans. Omit it for quick work when there is no meaningful
   architecture decision.
6. `change_set`: explicit `added`, `modified`, `removed`, and `unchanged`
   behavior or surfaces for standard/deep plans.
7. `scenarios`: observable Given/When/Then behavior with stable IDs.
8. `evidence`: claim, source, `verified`, `supported`, `inferred`, or `unknown`
   status, observation time, confidence, and any material conflicts.
9. `alternatives`: materially different options and why they were not selected.
   Use an empty array for quick work with one obvious path; do not invent filler.
10. `assumptions`, `open_questions`, and `risks`, including reversibility and
   recovery.
11. `validation`: strategy, concrete checks, and definition of done.
12. `coverage`: map every requirement to scenarios, task IDs, and concrete
    checks. Reject unknown references and uncovered standard/deep tasks.
13. `tasks`: research-free actions with `read_first`, owned files, explicit
    `new_files`, dependencies, `consumes`, `produces`, acceptance criteria,
    verification, risk, recovery, and delegated profile.
14. `readiness`: `READY`, `CONCERNS`, or `BLOCKED`, with reasons and unresolved
    items. Readiness never invents or replaces human approval.

For `standard` and `deep` output, make every section decision-grade rather than
merely present. Give evidence a concrete implication; alternatives distinct
benefits, costs, rejection reasons, and reconsideration conditions; assumptions
confidence, impact, and a validation path; and risks likelihood, impact,
trigger, mitigation, and recovery. Rationale should contain 2-4 substantive
reasons, and tasks should read as executable dossiers rather than headings.
Quick output stays concise and must not invent filler to look comprehensive.

Use `contract_version: 3` in every portable plan payload.
Use exact JSON keys for traceability: scenarios are `{ id, given, when, then }`;
evidence rows are `{ claim, source, status, observed_at, confidence, conflicts? }`,
where `observed_at` is an RFC 3339 timestamp with timezone, `confidence` is from
`0` to `1`, and `conflicts` is an optional string array;
coverage rows are `{ requirement, scenarioIds: [], taskIds: [], checks: [] }`;
tasks are `{ id, description, read_first: [], action, files: [], dependsOn: [],
new_files: [], consumes: [], produces: [], acceptance_criteria: [], verify, risk,
recovery, profile }`; and readiness is `{ verdict, reasons: [], unresolved: [] }`,
where verdict is `READY`, `CONCERNS`, or `BLOCKED`. IDs are stable within the
artifact, coverage references must resolve, and every standard/deep task must be
covered.

Use normalized `/`-separated repository-relative paths only. Never emit absolute
paths, `..`, globs, placeholders, or guessed paths. Put only existing workspace
paths inspected during planning in `read_first`. Put every touched path in
`files`; put each intentional creation in both `files` and `new_files`, never in
`read_first`. If a path cannot be confirmed, record the uncertainty in
`open_questions` and set readiness to `CONCERNS` or `BLOCKED` instead of guessing.
Every accepted standard/deep v3 plan must include the complete change-set,
scenario, coverage, task-interface, `new_files`, and readiness fields. Refresh
each evidence row before a canonical write and require `observed_at` plus bounded
`confidence`; include `conflicts` only when sources materially disagree.

The plan records task dependencies and semantic profiles, not provider-specific
spawn instructions. At execution time Apex derives waves from those dependencies
and delegates only tasks whose independence and write boundaries are established.

## Review HTML

Run Plan-checker for structural defects, then one Rival pass for a false
assumption, missing failure mode, or simpler direction. Revise once. A second
review is justified only when the first produced new evidence.

Create the portable v3 JSON payload first and persist it when file writing is
available. Validate the JSON before generating HTML; an active session's
`phantom-state.mjs record --type plan --status pending --input <json-file>`
validates it while persisting the canonical envelope. Only after validation
succeeds, create `plan.candidate.html` from the current JSON using
`<skill-directory>/references/review-html.md`, then run
`<skill-directory>/scripts/validate-review-html.mjs` against it. Do not repair stale HTML:
update the JSON and regenerate the disposable review page.

Render the self-contained, offline implementation dossier in this order:
plain-language plan summary; chosen direction and human gate;
added/modified/removed/unchanged change ledger; outcome, scope, and
Given/When/Then scenarios; architecture and requirement coverage; evidence,
alternatives, and risks; validation; readiness verdict; then task interfaces and
execution dossiers in a final appendix collapsed by default. If file writing is
unavailable, present the payload in one fenced `json` block and state that it was
not persisted or presented. If JSON can be written but HTML generation or viewing is
unavailable, keep the JSON artifact and present the same hierarchy in chat.

Replan only when a precondition is disproven, a new hard constraint appears,
blast radius changes materially, a required capability is unavailable,
verification disproves the diagnosis, or the same failure class repeats.
