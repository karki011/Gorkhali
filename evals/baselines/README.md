# Eval Baselines

Per-model snapshots written by `node scripts/run-evals.js --baseline --model <alias>` (live run — spends tokens).

- One file per model: `<model>.json` — `{ model, date, cases: { "<id>": "pass" | "fail" }, passRate }`. No `--model` writes `default.json`.
- Live runs WITHOUT `--baseline` diff against the matching file and print a DRIFT section (cases that flipped since the baseline).
- Re-baseline after a model upgrade or a deliberate skill/router change, and commit the new file with that change.
