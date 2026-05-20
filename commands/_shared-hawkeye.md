# Team Skill Crew -- Hawkeye Integration

> Loaded by commands that run Hawkeye (currently: `verify`).
> Always load `_shared.md` first.

---

## Purpose

Hawkeye catches cross-file issues that file-local reviewers (Prism, code-review, simplify) miss.
It uses graph tools to understand dependencies, then reviews the diff against five dimensions:
cross-file coherence, regression detection, semantic accuracy, dead code, and convention deviation.

---

## Graph Context Gathering

Before spawning Hawkeye, Cortex gathers cross-file context. This is the "intelligence briefing" that gives Hawkeye the same repo-wide awareness Greptile has.

### Required Context (always gather)

```
1. git diff main...HEAD              → full diff for regression detection
2. git diff main...HEAD --stat       → file-level change summary
3. git log main...HEAD --oneline     → commit messages (for cross-referencing intentional removals)
```

### Graph Context (if code-review-graph MCP available)

```
4. detect_changes()                  → risk-scored change list with structural context
5. get_impact_radius(files)          → per-file: callers, importers, test files
6. get_affected_flows(files)         → execution paths impacted by changes
```

If code-review-graph tools fail or are unavailable, proceed with git-only context. Hawkeye degrades gracefully — graph context enhances precision but isn't required.

### Phantom Context (if phantom-ai MCP available)

```
7. phantom_graph_blast_radius(files) → dependency-level blast radius
```

Same degradation rule: skip if unavailable.

### Context Assembly

Combine all gathered data into a structured briefing for Hawkeye:

```
## Hawkeye Intelligence Briefing

### Change Summary
{git diff --stat output}

### Commit Messages
{git log --oneline output}

### Graph: Risk-Scored Changes
{detect_changes output, or "graph unavailable — review based on diff only"}

### Graph: Impact Radius
{get_impact_radius output per file, or "graph unavailable"}

### Graph: Affected Flows
{get_affected_flows output, or "graph unavailable"}

### Graph: Blast Radius
{phantom_graph_blast_radius output, or "phantom unavailable"}

### Full Diff
{git diff main...HEAD output}
```

---

## Spawning Hawkeye

Spawn as Agent tool call with:
- `subagent_type`: `"reviewer"` (uses the reviewer agent type)
- `model`: `"opus"`
- `mode`: `"bypassPermissions"`

Prompt template:

```
You are Hawkeye, the cross-file pre-PR reviewer.

Read your agent definition: ~/.claude/team/agents/hawkeye.md

Then review the following changes using the five Hawkeye dimensions
(cross-file coherence, regression detection, semantic accuracy, dead code, convention deviation).

## Intelligence Briefing

{assembled context from Graph Context Gathering above}

## Instructions

1. Read your agent definition for detailed dimension descriptions and detection methods
2. Analyze the briefing — focus on cross-file interactions, not single-file quality
3. For each finding: read the actual source files to confirm (don't rely solely on diff context)
4. Output findings in the format specified in your agent definition
5. Include the Auto-Triage section with FIX/SKIP classification

If you find zero issues across all five dimensions, report: "Hawkeye: 0 findings. Cross-file review clear."
```

---

## Finding Merge Protocol

After both Prism and Hawkeye complete:

1. Collect Prism findings (CRITICAL / WARNING / INFO with file:line)
2. Collect Hawkeye findings (P0/P1/P2 with file:line)
3. Deduplicate: if both flag the same file:line (within 5 lines), keep the more specific finding
4. Unified finding list ordered by severity: P0 → P1 → CRITICAL → P2 → WARNING → INFO

---

## Auto-Triage Gate

Present merged findings to the user as a batch with Hawkeye's auto-triage:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Hawkeye + Prism Pre-PR Review — {N} findings ({F} FIX, {S} SKIP)          │
│                                                                              │
│  {FIX/SKIP}  {SEV}  {DIMENSION}  {FILE:LINE}  {ONE-LINE DESCRIPTION}       │
│  ...                                                                         │
│                                                                              │
│  Confirm batch? [Y to proceed / type line numbers to toggle FIX↔SKIP]       │
└──────────────────────────────────────────────────────────────────────────────┘
```

**User responses:**
- `Y` or `yes` → proceed with current triage (fix FIX items, skip SKIP items)
- Line numbers (e.g., `4 5`) → toggle those findings between FIX and SKIP, re-display
- `skip all` → skip Hawkeye fixes entirely, proceed to pass/fail

---

## Spark Fix Loop

For each finding marked FIX:

1. Spawn Spark (model: sonnet, bypassPermissions) with:
   - The finding description + suggested fix
   - The relevant source file(s)
   - Instruction: make the minimal change to resolve the finding
2. After all Spark agents complete → re-run Sentinel (verify fixes didn't break build/tests)
3. If Sentinel fails → fix loop (max 2 iterations)
4. If still failing → escalate to user with error output

---

## When NOT to Run Hawkeye

- **Docs-only changes** (only `.md`, `.txt`, `.json` config files changed) — skip, no cross-file code interactions
- **Single-file changes** with no exports modified — cross-file coherence is irrelevant
- **Test-only changes** — tests don't affect production dependency graph

Detection: check `git diff main...HEAD --stat` — if all changed files match skip patterns, skip Hawkeye and log: "Hawkeye: skipped (no cross-file code changes)"
