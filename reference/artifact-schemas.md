# Artifact Schemas

Canonical schemas for all file-based artifacts in Phantom v2.
A validation hook enforces these shapes at write time.

Each artifact has its own schema file:

- [_meta](schemas/_meta.md) --- Required header on every artifact
- [context.json](schemas/context.md) --- Phase A ticket context
- [intent.json](schemas/intent.md) --- Phase B goal contract
- [plan.json](schemas/plan.md) --- Phase B execution plan
- [execution.json](schemas/execution.md) --- Phase C results
- [verification.json](schemas/verification.md) --- Verify gate output
- [review.json](schemas/review.md) --- Reviewer artifact (auditor / specialist), findings + disposition
- [wrap.json](schemas/wrap.md) --- Post-merge wrap record
- [pause-state.json](schemas/pause-state.md) --- Pause/resume state
- [review-panel.json](schemas/review-panel.md) --- Pre-ship review panel
- [run-artifacts](schemas/run-artifacts.md) --- Per-run artifact directory layout

All artifacts require the `_meta` header. See [_meta](schemas/_meta.md).
