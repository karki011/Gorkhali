---
name: team:detective
description: "Use when investigating unknown bugs, regressions, or mysterious failures — something broke after a deploy, wrong output with no error, or root cause is unknown. Also use when user says 'investigate why', 'I suspect', 'started happening after', or 'no error but something is wrong'. NOT for known failures — use team:fix. Produces HTML forensic reports."
argument-hint: "<symptoms or file paths>"
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md` + `_shared-auto-learning.md` + `_shared-detective.md`

# /team:detective "$ARGUMENTS"

Forensic investigation engine. Traces symptoms to root causes using git history, file relationships, and code structure. Produces an HTML investigation report.

<instructions>

## Investigation Protocol (7 Steps)

### Step 1: SYMPTOMS

Collect observable evidence. Do NOT hypothesize yet.

- Error messages (exact text)
- Test output (which tests, what assertion)
- User report (behavior vs expectation)
- Stack traces (if available)
- When it started ("it was working yesterday" → git bisect candidate)

Write symptoms to conversation. If $ARGUMENTS contains file paths, those are the initial suspects.

### Step 2: TIMELINE

Establish when the behavior changed.

```bash
# Recent changes to suspect files
git log --oneline --since="2.weeks" -- {suspect_files}

# If "when did it break?" is unknown, widen to 30 days
git log --oneline --since="30.days" -- {suspect_files}
```

Identify the suspect commit range. If clear breakpoint → note the commit SHA.

### Step 3: SUSPECTS

Run hotspot analysis on suspect files. Use recipes from `_shared-detective.md`.

For each suspect file, collect:
- Change frequency (from hotspot recipe)
- Complexity proxy (line count + branch density)
- Hotspot Risk = normalize(freq) × normalize(complexity)

Rank suspects by risk score. Top 3 files get deep analysis.

### Step 4: OWNERSHIP

For top suspect files:

```bash
git shortlog -sn --no-merges -- {file}
```

Calculate bus factor. Flag if >80% single author (knowledge silo risk).
Note who to consult if hypothesis needs human validation.

### Step 5: COUPLING

Check temporal coupling for suspect files:

```bash
# Files that change together with suspect
git log --format='---' --name-only --since="6.months" -- {suspect_file} | ...
```

Flag coupling strength >0.5. Key question: **did a coupled file change when it should have?**
Missing co-changes are often the root cause.

### Step 6: HYPOTHESIS

Formulate root cause theory. Assign confidence:
- **Low** (<40%) — circumstantial evidence only. Need more data.
- **Medium** (40-70%) — evidence pattern matches but no confirmation.
- **High** (>70%) — specific commit + specific behavior change + reproducible.

<evidence_before_conclusions>
NEVER present a hypothesis without specific evidence.
"I think file X is the problem" is not a hypothesis.
"Commit abc123 changed the return type of foo() but bar() still expects the old type, confirmed by coupling score 0.67" IS a hypothesis.
</evidence_before_conclusions>

If confidence < 40%, loop back to Step 2 with wider timeline or Step 3 with more files.

### Step 7: EVIDENCE

Compile the proof:
- Specific commit SHAs that introduced the change
- Specific line numbers where the bug manifests
- Test cases that confirm/deny the hypothesis
- Coupling violations (files that should have co-changed)
- Research benchmarks exceeded (cite from `_shared-detective.md`)

</instructions>

<output_format>

## Output: HTML Investigation Report

Write `state/sessions/{TICKET}/investigation.html` using the template from `reference/detective-protocol.md`.

The HTML report includes:
- Case header (ticket, date, investigator)
- Symptoms section
- Timeline visualization (commit list)
- Suspect files with hotspot scores (progress bars)
- Ownership breakdown (contributor chart)
- Coupling map (co-change matrix)
- Hypothesis with confidence meter
- Evidence trail (commit links, line references)
- Recommended actions

Also write a **conversation summary** (3-5 bullets):
1. Hypothesis + confidence level
2. Key evidence (commit SHA, file, line)
3. Recommended fix approach
4. Files to modify
5. Who to consult (if bus factor = 1)

</output_format>

<auto_trigger_integration>

## Auto-Trigger Integration

This command is also invoked automatically by other team skills:

| Caller | When | Depth | What happens |
|--------|------|-------|-------------|
| `start.md` Phase A | Bug report detected | Pre-scan | Lightweight hotspot + ownership. Results added to `context.json`. |
| `verify.md` | Correctness check fails | Failure scan | Targeted analysis on failing files. Results added to `verification.json`. |
| `fix.md` loop 2+ | Same failure class repeats | Deep investigation | Full 7-step protocol. Produces `investigation.html`. |

When auto-triggered at reduced depth, skip the full 7-step protocol and use the abbreviated flow:

**Pre-scan (start.md):**
1. Identify suspect files from ticket/description
2. Run hotspot check (1 git command)
3. Run ownership check (1 git command)
4. Return findings as structured data for context.json

**Failure scan (verify.md):**
1. Identify failing files from test/build output
2. Run hotspot + coupling check (3 git commands)
3. Return findings as structured data for verification.json

</auto_trigger_integration>

<phantom_integration>

## Phantom AI Integration

If Phantom MCP available:
- Call `phantom_graph_blast_radius` on suspect files for dependency context
- Call `phantom_graph_related` to discover files involved in the same feature
- Use graph data to inform coupling analysis (supplements git-based temporal coupling)

If unavailable → skip silently. Detective mode works without Phantom.

</phantom_integration>

<constraints>

## Rules

- Evidence before conclusions. Always.
- Use git recipes from `_shared-detective.md`. Do not invent variations.
- Cite research benchmarks when thresholds exceeded.
- One hypothesis at a time. If multiple theories, rank by confidence and present highest first.
- If Phantom MCP available, use it. If not, degrade gracefully.
- Max investigation time: 10 minutes wall clock. If still low confidence → escalate to user with findings so far.
- Record investigation outcomes to learnings (via `_shared-auto-learning.md` protocol).

</constraints>
