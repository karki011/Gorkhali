# Team Skill Crew -- Hawkeye Integration

> Opt-in: triggered by `/team:verify` when code-review-graph MCP is available.

**What it does:** Cross-file pre-PR review. Catches cache coherence bugs, regressions, semantic mismatches, dead code, convention deviations.

**When to skip:** Docs-only changes, single-file fixes, test-only changes.

**Protocol:** Gather graph context (git diff + code-review-graph) → spawn Hawkeye agent (opus) → merge findings with temperature review → auto-triage P0/P1 only.

**Finding merge:** Hawkeye findings feed into the temperature review pipeline. P0/P1 from Hawkeye = auto-fix. P2+ = drop.

> Full protocol: `agents/hawkeye.md`
