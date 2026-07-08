# plan-brainstorm fixtures

Author: Subash Karki

Fixtures for `test/plan-brainstorm-eval.test.js`, the golden-file eval that asserts *output quality* for `scripts/render-plan.js` and `scripts/render-brainstorm.js` - not just that they don't crash.

- `plan.json` - a minimal plan with one wave/task, modeled on the canonical task template (`description` as the outcome headline, `acceptance_criteria` as a checklist).
- `intent.json` - the sibling narrative-lead contract (`goal`/`problem`/`tradeoffs`) that `render-plan.js` auto-discovers next to `plan.json`.
- `wiring.json` - the sibling dependency-topology contract (`dependencies`/`riskPoints`) that `render-plan.js` auto-discovers next to `plan.json`.
- `brainstorm.json` - three approaches (one carrying `visualType: "diagram"`) plus a `recommendedDefault`, for `render-brainstorm.js`.

## Running the eval standalone

```
node --test test/plan-brainstorm-eval.test.js
```

It also runs as part of the full suite via `npm test` (`node --test test/*.test.js`).

## Falsifiability proof

This eval is provably not vacuous: a bogus expected string was temporarily swapped into the "Tradeoffs section renders from intent.json" assertion (`'<h2>Tradeoffs</h2>'` -> `'<h2>Tradeoffs-BOGUS</h2>'`). Re-running the file failed exactly one test, with the named message `plan.html regressed: Tradeoffs section missing` - confirming a real renderer regression would be caught, not silently passed. The assertion was then reverted and the suite re-ran green.

The test file also carries a skipped `canary` test that exercises the `missingElements()` helper directly against a deliberately-nonexistent heading, for anyone who wants to re-verify the same property without editing a real assertion.
