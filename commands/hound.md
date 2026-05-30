---
name: phantom:hound
description: "Use when investigating unknown bugs, regressions, or mysterious failures — something broke after a deploy, wrong output with no error, or root cause is unknown. Also use when user says 'investigate why', 'I suspect', 'started happening after', or 'no error but something is wrong'. NOT for known failures — use phantom:fix. Produces HTML forensic reports."
argument-hint: "<symptoms or file paths>"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob"]
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md` + `_shared-auto-learning.md` + `_shared-hound.md`

# /phantom:hound "$ARGUMENTS"

Forensic investigation engine. Main LLM = **coordinator**: gather symptoms, spawn Hound agent to investigate, present findings. Coordinator does NOT run investigation steps — delegates entirely to the Hound agent.

<instructions>

## Step 1: Gather Symptoms (Coordinator)

Parse `$ARGUMENTS` for: **symptom** (what broke, errors, unexpected behavior); **file paths** (initial suspects, if any); **timeline clues** ("after deploy", "since yesterday", commit refs).

Resolve TICKET from session state or `git branch --show-current`.

Load relevant learnings from `_shared-auto-learning.md` — prior investigations of same area, past corrections.

## Step 2: Spawn Hound Agent

Agent tool — `subagent_type: "hound"`, `mode: "bypassPermissions"`, `run_in_background: false` (model + effort from agent definition). Prompt:

```
You are the HOUND — forensic investigator for codebase bugs and regressions.

## Symptoms
{parsed symptoms from Step 1}
## Initial Suspects
{file paths if any, or "none — derive from symptoms"}
## Relevant Learnings
{matching learnings from auto-learning index}

## Investigation Protocol (7 Steps) — from reference/detective/protocol.md
1. SYMPTOMS — collect all evidence. Do NOT hypothesize yet.
2. TIMELINE — git log, blame, bisect from reference/detective/git-recipes.md.
3. SUSPECTS — rank by Hotspot Risk (reference/detective/hotspots.md). Top 3 get deep analysis.
4. OWNERSHIP — bus factor, recent authors.
5. COUPLING — flag coupling strength >0.5. Missing co-changes are often the root cause.
6. HYPOTHESIS — confidence Low <40% / Medium 40-70% / High >70%. If <40%, loop back to Step 2/3.
7. EVIDENCE — confirm with specific commits, lines, coupling scores.

NEVER present a hypothesis without specific evidence. Valid example:
"Commit abc123 changed return type of foo() but bar() still expects old type, confirmed by coupling score 0.67".
Use git recipes from reference/detective/git-recipes.md and hotspot/coupling formulas from reference/detective/hotspots.md — do not invent variations.
If Phantom MCP available, use phantom_graph_blast_radius + phantom_graph_related on suspects.

## Output
Write {TEAM_DIR}/sessions/{TICKET}/investigation.html using reference/detective/report-template.md.
Then return a conversation summary: hypothesis + confidence; key evidence (commit SHA, file, line); recommended fix approach; files to modify; who to consult (if bus factor = 1).
```

## Step 3: Present Findings (Coordinator)

After Hound completes:
1. Read agent's returned summary.
2. Present to user as 3-5 bullet summary.
3. Confirm `investigation.html` written to `{TEAM_DIR}/sessions/{TICKET}/`.
4. Record outcome to learnings via `_shared-auto-learning.md`.

</instructions>

<auto_trigger_integration>

## Auto-Trigger Integration

| Caller | When | Depth | Output |
|--------|------|-------|--------|
| `start.md` Phase A | Bug report detected | Pre-scan | `hound` field in context.json |
| `verify.md` | Correctness fails | Failure scan | `hound` field in verification.json |
| `fix.md` loop 2+ | Same failure class repeats | Full | investigation.html |

Depth levels + abbreviated flows: `reference/detective/depth-levels.md`. When triggered with abbreviated depth (Pre-scan or Failure scan), add to Hound prompt: `"Depth: {depth_level} — follow abbreviated flow from reference/detective/depth-levels.md"`.

</auto_trigger_integration>

<constraints>

## Rules

- Evidence before conclusions. Always.
- Coordinator delegates entirely to Hound agent — runs no investigation steps itself.
- Hound uses git recipes from `_shared-hound.md` / `reference/detective/git-recipes.md`. Do not invent variations.
- One hypothesis at a time. Rank by confidence, present highest first.
- If Phantom MCP available, use `phantom_graph_blast_radius` + `phantom_graph_related` on suspects.
- Max investigation time: 10 min. Still low confidence → escalate with findings so far.
- Record outcomes to learnings (via `_shared-auto-learning.md`).
- Agent spawn MUST use `subagent_type: "hound"`, `mode: "bypassPermissions"` (model + effort from agent definition).

</constraints>
