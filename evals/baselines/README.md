# Eval Baselines

Per-model snapshots written by `node scripts/run-evals.js --baseline --model <alias>` (live run — spends tokens).

- One file per model: `<model>.json` — `{ model, host, date, cases: { "<id>": "pass" | "fail" }, passRate }`. No `--model` writes `default.json`. `host` records which runtime produced the verdicts (`claude-code` or `kimi`); files written before the field existed are `claude-code` runs. Host-scoped cases (e.g. the claude-code-only ones) are excluded from other hosts' baselines, so a `kimi` baseline legitimately holds fewer case IDs.
- Live runs WITHOUT `--baseline` diff against the matching file and print a DRIFT section (cases that flipped since the baseline).
- Re-baseline after a model upgrade or a deliberate skill/router change, and commit the new file with that change.

## Release gate (`--gate`)

`node scripts/run-evals.js --gate --model <alias>` turns that advisory drift report into a decision: it exits 1 and names every reason the run may not ship. Five rules block:

| Rule | Why it blocks |
|---|---|
| No baseline for this model | Nothing to gate against. |
| Baseline records no case verdicts | An unusable record, not a bar of zero. |
| A verdict outside `pass`\|`fail` | `"passed"` is not `"pass"`: it would read as a non-pass, depressing the baseline rate while never arming the regression rule. Regenerate with `--baseline`. |
| `baseline.model` ≠ `--model` | Cross-model comparison is a confound. |
| `baseline.host` ≠ `--host` | Cross-host comparison is a confound; verdicts are only comparable within one runtime. Writing a baseline over another host's file is refused outright. |
| Baseline case did not run, or a case ran that the baseline does not cover | Unequal case sets are not comparable. This is the rule that closes the filtered-run hole: three green cases against a 55-case baseline used to print "no flips, 100% pass" and read as a clean release. |
| A case flipped `pass` → `fail` | Regression. |
| Pass rate below baseline | Catches a net loss that no single flip explains. |

Two properties worth knowing before you rely on it:

- **It gates movement, not greenness.** A case that failed in the baseline and fails again does not block — that is the point of a baseline. The printed PASS line always states the absolute pass rate so a low one is never hidden.
- **`--gate` and `--baseline` are mutually exclusive.** A run cannot be gated against the record it is writing; `parseArgs` rejects the combination.
- **`passRate` in the file is display-only.** The gate recomputes from `cases`, so hand-editing the number cannot move the decision.

Deleting a case from `evals.json` without regenerating the baselines leaves an orphaned verdict, and the pairing rule then blocks every full run on a case that cannot be run — a gate no run can satisfy. `test/run-evals.test.js` pins every committed baseline's case ids to `evals.json`, so that drift fails CI instead of reaching a release.
