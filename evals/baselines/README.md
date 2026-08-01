# Eval Baselines

Per-model snapshots written by `node scripts/run-evals.js --baseline --model <alias>` (complete live run — spends tokens).

- One schema-v2 file per model: `<model>.json` records the model, date, full case map, pass rate, and provenance. No `--model` writes `default.json`.
- Provenance binds fixture, route-truth, harness, candidate-plugin, isolation, tool-access, candidate-model, judge-model, timeout, exact complete case IDs, filter semantics, and Claude CLI identity.
- `--baseline` rejects every filtered selection. The writer also verifies that the selected IDs are the complete unfiltered case set.
- Complete live runs without `--baseline` diff only when every provenance field matches. Filtered or partial runs never compare; legacy and changed-provenance files are explicitly non-comparable.
- Re-baseline after a model upgrade or a deliberate skill/router change, and commit the new file with that change.
