# Phantom Shadows -- Justice Integration

> Opt-in: triggered by `/phantom:verify` when code-review-graph MCP is available.

**What it does:** Cross-file pre-PR review. Catches cache coherence bugs, regressions, semantic mismatches, dead code, convention deviations.

**When to skip:** Docs-only changes, single-file fixes, test-only changes.

**Protocol:** Gather graph context (git diff + code-review-graph) → spawn Justice agent (`subagent_type: "justice"`, `name: "justice-gavelin"` per `reference/roster.md`; sonnet — Justice sits at the review tier in `model-policy.json`, and every delegated role resolves to sonnet on this host) → merge findings with power level → auto-triage blocking findings only.

**Finding merge:** Justice findings feed into the power level pipeline on the one severity scale (`scripts/lib/review-standard.js`). `blocking` from Justice = auto-fix; `advisory` = report only; `preExisting: true` = report, never fix.

> Full protocol: `agents/justice.md`
