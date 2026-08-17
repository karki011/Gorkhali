# Phantom Shadows -- Archer Integration

> Opt-in: triggered by `/phantom:verify` when code-review-graph MCP is available.

**What it does:** Cross-file pre-PR review. Catches cache coherence bugs, regressions, semantic mismatches, dead code, convention deviations.

**When to skip:** Docs-only changes, single-file fixes, test-only changes.

**Protocol:** Gather graph context (git diff + code-review-graph) → spawn Archer agent (`subagent_type: "archer"`, `name: "archer-sylas"` per `reference/roster.md`; sonnet — Archer sits at the review tier in `model-policy.json`, and every delegated role resolves to sonnet on this host) → merge findings with power level → auto-triage blocking findings only.

**Finding merge:** Archer findings feed into the power level pipeline on the one severity scale (`scripts/lib/review-standard.js`). `blocking` from Archer = auto-fix; `advisory` = report only; `preExisting: true` = report, never fix.

> Full protocol: `agents/archer.md`
