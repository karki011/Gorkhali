---
name: phantom:hound
description: "Use when investigating unknown bugs, regressions, or mysterious failures — something broke after a deploy, wrong output with no error, or root cause is unknown. Also use when user says 'investigate why', 'I suspect', 'started happening after', or 'no error but something is wrong'. NOT for known failures — use phantom:fix. Produces HTML forensic reports."
argument-hint: "<symptoms or file paths>"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob"]
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md` + `_shared-auto-learning.md` + `_shared-hound.md`

# /phantom:hound "$ARGUMENTS"

Forensic investigation engine. The main LLM acts as **coordinator** — it gathers symptoms, spawns a Hound agent to run the investigation, then presents findings to the user.

<instructions>

## Step 1: Gather Symptoms (Coordinator)

Parse `$ARGUMENTS` for:
- **Symptom description** — what broke, error messages, unexpected behavior
- **File paths** — initial suspects (if provided)
- **Timeline clues** — "after deploy", "since yesterday", commit refs

Resolve TICKET from session state or `git branch --show-current`.

Load relevant learnings from `_shared-auto-learning.md` — check for prior investigations of same area, past corrections.

## Step 2: Spawn Hound Agent

Use the Agent tool to spawn a dedicated investigator:

```
Agent call:
  description: "Investigate: {1-line symptom summary}"
  subagent_type: "hound"
  mode: "bypassPermissions"
  run_in_background: false
  # model + effort come from the hound agent definition
  prompt: |
    You are the HOUND — a forensic investigator for codebase bugs and regressions.

    ## Symptoms
    {parsed symptoms from Step 1}

    ## Initial Suspects
    {file paths if any, or "none — derive from symptoms"}

    ## Relevant Learnings
    {any matching learnings from auto-learning index}

    ## Investigation Protocol (7 Steps)

    Follow the 7-step flow from reference/detective/protocol.md:
    1. SYMPTOMS — Collect all evidence. Do NOT hypothesize yet.
    2. TIMELINE — Use git log, blame, bisect from reference/detective/git-recipes.md.
    3. SUSPECTS — Rank by Hotspot Risk (reference/detective/hotspots.md). Top 3 get deep analysis.
    4. OWNERSHIP — Check bus factor, recent authors.
    5. COUPLING — Flag coupling strength >0.5. Missing co-changes are often the root cause.
    6. HYPOTHESIS — Assign confidence (Low <40%, Medium 40-70%, High >70%). If <40%, loop back to Step 2/3.
    7. EVIDENCE — Confirm with specific commits, lines, coupling scores.

    NEVER present a hypothesis without specific evidence.
    "Commit abc123 changed the return type of foo() but bar() still expects the old type, confirmed by coupling score 0.67" IS a valid hypothesis.

    Use git recipes from reference/detective/git-recipes.md — do not invent variations.
    Use hotspot/coupling formulas from reference/detective/hotspots.md.
    If Phantom MCP available, use phantom_graph_blast_radius + phantom_graph_related on suspects.

    ## Output

    Write {TEAM_DIR}/sessions/{TICKET}/investigation.html using template from reference/detective/report-template.md.

    After writing the HTML report, return a conversation summary with:
    - Hypothesis + confidence level
    - Key evidence (commit SHA, file, line)
    - Recommended fix approach
    - Files to modify
    - Who to consult (if bus factor = 1)
```

## Step 3: Present Findings (Coordinator)

After the Hound agent completes:
1. Read the agent's returned summary
2. Present the findings to the user as 3-5 bullet conversation summary
3. Confirm `investigation.html` was written to `{TEAM_DIR}/sessions/{TICKET}/`
4. Record investigation outcome to learnings via `_shared-auto-learning.md`

</instructions>

<auto_trigger_integration>

## Auto-Trigger Integration

| Caller | When | Depth | Output |
|--------|------|-------|--------|
| `start.md` Phase A | Bug report detected | Pre-scan | `hound` field in context.json |
| `verify.md` | Correctness fails | Failure scan | `hound` field in verification.json |
| `fix.md` loop 2+ | Same failure class repeats | Full | investigation.html |

Depth levels and abbreviated flows defined in `reference/detective/depth-levels.md`.

When triggered with abbreviated depth (Pre-scan or Failure scan), the Hound agent prompt should include:
`"Depth: {depth_level} — follow abbreviated flow from reference/detective/depth-levels.md"`

</auto_trigger_integration>

<constraints>

## Rules

- Evidence before conclusions. Always.
- The coordinator does NOT run investigation steps — it delegates entirely to the Hound agent.
- Hound agent uses git recipes from `_shared-hound.md` / `reference/detective/git-recipes.md`. Do not invent variations.
- One hypothesis at a time. Rank by confidence, present highest first.
- If Phantom MCP available, use `phantom_graph_blast_radius` + `phantom_graph_related` on suspects.
- Max investigation time: 10 minutes. If still low confidence → escalate with findings so far.
- Record outcomes to learnings (via `_shared-auto-learning.md`).
- Agent spawn MUST use `subagent_type: "hound"`, `mode: "bypassPermissions"` (model + effort from the agent definition).

</constraints>
