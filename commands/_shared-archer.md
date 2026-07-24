# Phantom Shadows -- Archer Integration

> Opt-in: triggered by `/phantom:verify` when code-review-graph MCP is available.

**What it does:** Cross-file pre-PR review. Catches cache coherence bugs, regressions, semantic mismatches, dead code, convention deviations.

**When to skip:** Docs-only changes, single-file fixes, test-only changes.

**Protocol:** Gather graph context (git diff + code-review-graph) → spawn Archer agent (opus — pinned review tier, the top tier now that Fable is retired from Phantom's routing) → merge findings with power level → auto-triage P0/P1 only.

**Finding merge:** Archer findings feed into the power level pipeline. P0/P1 from Archer = auto-fix. P2+ = drop.

> Full protocol: `agents/archer.md`
