---
name: detective
description: "Use when investigating an UNKNOWN cause — bug, regression, wrong behavior with no error, failing since a deploy. HTML forensic reports. Known failures → gorkhali:fix; Gorkhali itself → gorkhali:health."
argument-hint: "<symptoms or file paths>"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob"]
# Hidden from the Claude Code / menu to deduplicate entries — the same-named skill is the single menu surface and delegates to this command, which remains the canonical procedure. Do not flip without re-checking menu duplication.
user-invocable: false
---

> **Preamble Tier: T2** — shared contexts per the canonical registry (`scripts/preamble-tier.js`); `_shared-detective.md` also loads on the detective trigger

# /gorkhali:detective "$ARGUMENTS"

Forensic investigation engine. Main LLM = **coordinator**: gather symptoms, spawn Detective agent to investigate, present findings. Coordinator does NOT run investigation steps — delegates entirely to the Detective agent.

<instructions>

## Step 1: Gather Symptoms (Coordinator)

Parse `$ARGUMENTS` for: **symptom** (what broke, errors, unexpected behavior); **file paths** (initial suspects, if any); **timeline clues** ("after deploy", "since yesterday", commit refs).

Resolve TICKET from session state or `git branch --show-current`.

Load relevant learnings from `_shared-auto-learning.md` — prior investigations of same area, past corrections.

Read `reference/defect-proof.md` and any existing
`{SESSION_DIR}/defect-proof.json`. Preserve prior evidence and explicit user
confirmation unless new evidence contradicts it. Read any `DiagnosticGrant`
before running instrumentation; actions outside its paths or scope are denied.

**Large-scope sweep → recommend a workflow.** If the forensics scope is big (many files / deep
git history / repo-wide), recommend running the sweep as a Claude Code dynamic workflow per
`reference/workflow-delegation.md`: it fans out investigators and returns ranked root causes only,
keeping the raw forensics out of context. ALWAYS scope the recommended prompt "Audit and REPORT
only — do not modify files." Fall back to turn-by-turn investigation if scope is small or workflows
are unavailable.

## Step 2: Spawn Detective Agent

Agent tool — `subagent_type: "detective"`, `name: "detective-draget"`, `mode: "bypassPermissions"`, `run_in_background: false` (effort = session `high`; model per `reference/agents.md` → Model Routing). Prompt:

```
You are the DETECTIVE — forensic investigator for codebase bugs and regressions.

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
## Defect proof artifact
Write or update {TEAM_DIR}/sessions/{TICKET}/defect-proof.json with every field
reference/defect-proof.md requires. Read that reference - it is canonical and is not
restated here.

Gate: only ready_for_fix / confirmed_defect may proceed, and only when every
mutation-gate condition in the reference is satisfied; missing or conflicting proof MUST
produce waiting_for_evidence / unconfirmed_defect. Diagnostic instrumentation requires a
recorded, unexpired DiagnosticGrant. Detective never authorizes or implements a fix.

Never infer: only explicit user confirmation may set confirmedByUser true, only observed
cleanup evidence may set cleanupStatus to cleaned, and only explicit user approval may set
approved_in_scope.

Obtain the canonical baselineFingerprint with portable
`gorkhali-state.mjs fingerprint --workspace <path>` when command execution is
available. Do not invent or approximate it.

## Other output
Write {TEAM_DIR}/sessions/{TICKET}/investigation.html using reference/detective/report-template.md.
Then return a conversation summary: hypothesis + confidence; key evidence (commit SHA, file, line); recommended fix approach; files to modify; who to consult (if bus factor = 1).
```

## Step 3: Present Findings (Coordinator)

After Detective completes:
1. Read agent's returned summary.
2. Validate `defect-proof.json` against `reference/defect-proof.md`. Missing,
   malformed, contradictory, or stale proof becomes
   `waiting_for_evidence` / `unconfirmed_defect`.
3. If this exact claim does not already have explicit user confirmation,
   present its evidence and ask the user to confirm or reject it.
4. After the response, update `confirmedByUser`, `confirmedAt`,
   `rootCause.status`, and the gate state/verdict. Without explicit
   confirmation, preserve `waiting_for_evidence` / `unconfirmed_defect`.
5. Present the remaining findings as a 3-5 bullet summary.
6. Confirm `investigation.html` and `defect-proof.json` were written to
   `{TEAM_DIR}/sessions/{TICKET}/`.
7. Record outcome to learnings via `_shared-auto-learning.md`.

</instructions>

<auto_trigger_integration>

## Auto-Trigger Integration

| Caller | When | Depth | Output |
|--------|------|-------|--------|
| `start.md` Phase A | Bug report detected | Pre-scan | `defect-proof.json` + `detective` field in context.json |
| `verify.md` | Correctness fails | Failure scan | `defect-proof.json` + `detective` field in verification.json |
| `fix.md` loop 2+ | Same failure class repeats | Full | `defect-proof.json` + investigation.html |

Depth levels + abbreviated flows: `reference/detective/depth-levels.md`. When triggered with abbreviated depth (Pre-scan or Failure scan), add to Detective prompt: `"Depth: {depth_level} — follow abbreviated flow from reference/detective/depth-levels.md"`.

</auto_trigger_integration>

<constraints>

## Rules

- Evidence before conclusions. Always.
- Every Detective run writes or updates `defect-proof.json`; inconclusive evidence
  fails closed without authorizing mutation.
- Instrumentation requires a current DiagnosticGrant. Detective records its cleanup
  state and evidence but never infers cleanup or user approval.
- Coordinator delegates entirely to Detective agent — runs no investigation steps itself.
- Detective uses git recipes from `_shared-detective.md` / `reference/detective/git-recipes.md`. Do not invent variations.
- One hypothesis at a time. Rank by confidence, present highest first.
- Max investigation time: 10 min. Still low confidence → escalate with findings so far.
- Record outcomes to learnings (via `_shared-auto-learning.md`).
- Agent spawn MUST use `subagent_type: "detective"`, `name: "detective-draget"`, `mode: "bypassPermissions"` (routing per Step 2).

</constraints>
