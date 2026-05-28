---
name: phantom:hound
description: "Use when investigating unknown bugs, regressions, or mysterious failures — something broke after a deploy, wrong output with no error, or root cause is unknown. Also use when user says 'investigate why', 'I suspect', 'started happening after', or 'no error but something is wrong'. NOT for known failures — use phantom:fix. Produces HTML forensic reports."
argument-hint: "<symptoms or file paths>"
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md` + `_shared-auto-learning.md` + `_shared-hound.md`

# /phantom:hound "$ARGUMENTS"

Forensic investigation engine. Traces symptoms to root causes using git history, file relationships, and code structure. Produces an HTML investigation report.

<instructions>

## Investigation Protocol (7 Steps)

READ `reference/detective/protocol.md` for the full 7-step flow (Symptoms → Timeline → Suspects → Ownership → Coupling → Hypothesis → Evidence).

Use git commands from `reference/detective/git-recipes.md`. Use hotspot/coupling formulas from `reference/detective/hotspots.md`.

**Key rules per step:**
- Step 1: Collect evidence, do NOT hypothesize yet. If $ARGUMENTS has file paths, those are initial suspects.
- Step 3: Rank suspects by Hotspot Risk. Top 3 get deep analysis.
- Step 5: Flag coupling strength >0.5. Missing co-changes are often the root cause.
- Step 6: Assign confidence (Low <40%, Medium 40-70%, High >70%). If <40% → loop back to Step 2/3.

<evidence_before_conclusions>
NEVER present a hypothesis without specific evidence.
"Commit abc123 changed the return type of foo() but bar() still expects the old type, confirmed by coupling score 0.67" IS a hypothesis.
</evidence_before_conclusions>

</instructions>

<output_format>

## Output

Write `state/sessions/{TICKET}/investigation.html` using template from `reference/detective/report-template.md`.

Also write a **conversation summary** (3-5 bullets): hypothesis + confidence, key evidence (commit SHA, file, line), recommended fix, files to modify, who to consult (if bus factor = 1).

</output_format>

<auto_trigger_integration>

## Auto-Trigger Integration

| Caller | When | Depth | Output |
|--------|------|-------|--------|
| `start.md` Phase A | Bug report detected | Pre-scan | `hound` field in context.json |
| `verify.md` | Correctness fails | Failure scan | `hound` field in verification.json |
| `fix.md` loop 2+ | Same failure class repeats | Full | investigation.html |

Depth levels and abbreviated flows defined in `reference/detective/depth-levels.md`.

</auto_trigger_integration>

<constraints>

## Rules

- Evidence before conclusions. Always.
- Use git recipes from `_shared-hound.md` / `reference/detective/git-recipes.md`. Do not invent variations.
- One hypothesis at a time. Rank by confidence, present highest first.
- If Phantom MCP available, use `phantom_graph_blast_radius` + `phantom_graph_related` on suspects.
- Max investigation time: 10 minutes. If still low confidence → escalate with findings so far.
- Record outcomes to learnings (via `_shared-auto-learning.md`).

</constraints>
