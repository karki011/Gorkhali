# Workflow Delegation Protocol (WDP)

> Gorkhali does NOT run dynamic workflows — it RECOMMENDS them. Chief CANNOT launch a workflow:
> the `workflow` keyword fires only on USER input and there is no programmatic launch (verified
> 2026-05, Claude Code v2.1.157). Gorkhali's job: recognize WHEN a Claude Code dynamic workflow
> beats turn-by-turn shadows, and hand the user the exact command.

## What a dynamic workflow is
A background JavaScript script (Claude Code v2.1.154+, research preview) that orchestrates many
subagents at scale; intermediate results stay in script variables so ONLY the final synthesized
report enters context. Best for BIG, gateless, fan-out-and-cross-check work. Docs:
https://code.claude.com/docs/en/workflows

## When to recommend — the `workflow_candidate` test
Recommend a workflow for a phase ONLY when ALL hold. Clause 1 is the dominant lever.
1. **SCALE (primary)** — fan-out is BIG. Rough, TUNABLE guidance (refine from real sessions):
   - >= ~20 files in blast radius, OR
   - >= ~5 independent sources/angles to cross-check, OR
   - a deep git-history steward, OR
   - the ask says "codebase-wide" / "every X" / "all <plural>".
   Small task -> stay turn-by-turn. Workflows cost more tokens. "Use it when we need it."
2. **GATELESS** — phase needs NO mid-phase human input (a workflow takes none; gates run in Chief
   before/after).
3. **READ-MOSTLY or GENERATIVE** — forensics, search, review, plan-generation. NOT direct code
   edits (deferred to v2).
4. **SYNTHESIS PAYOFF** — value is a cross-checked / voted / adversarially-reviewed / multi-angle
   result.
5. **AVAILABLE** — workflows enabled (Claude Code >= v2.1.154; not disabled via /config,
   `disableWorkflows`, or `CLAUDE_CODE_DISABLE_WORKFLOWS`). If unknown/disabled -> run
   turn-by-turn; NEVER block.

If any clause fails -> turn-by-turn shadows (current behavior). **Default is NOT to recommend.**

## How to recommend (Chief output pattern)
When a phase qualifies, Chief prints a short block like:

> This {phase} is big ({N files / N sources}). A dynamic workflow keeps the fan-out out of
> context and returns one cross-checked report. To run it, type:
> `/deep-research {question}` — Claude Code's built-in research workflow (requires workflows
> enabled), for source/claim cross-check
> or: `Run a workflow to {scoped task}. Audit and REPORT only — do not modify any files.`
> Then paste the report back (or I'll read it) and I'll continue the phase. Skip it and I'll
> proceed turn-by-turn.

ALWAYS include **"Audit and REPORT only — do not modify files"** for read-only phases (detective /
review): a workflow's subagents run in `acceptEdits` and could otherwise write.

## Folding the result back
The workflow returns ONE report; Chief treats it as the phase output:
- detective  -> ranked root causes -> detective pre-scan artifact
- review -> filtered findings  -> review output
- brainstorm (optional) -> ranked approaches -> GATE 1 options
Chief still runs any human GATE in-conversation AFTER the report lands.

## ultracode — DO NOT rely on it for gated gorkhali work
`/effort ultracode` makes the runtime auto-wrap tasks in background workflows that take NO mid-run
input, and a skill CANNOT detect the effort level. So under ultracode the runtime may wrap a gated
gorkhali phase and your approval/direction GATES cannot surface — silent gate bypass.
**RULE:** run gated gorkhali phases at `/effort high`, not `ultracode`. Use ultracode only for
ungated single-shot gorkhali work (e.g. a standalone scout/research). Documented warning, not an
enforced check.

## Phases wired in v1
- `detective`  (forensics steward)  — commands/detective.md
- `review` (codebase-wide)    — commands/review.md
(brainstorm multi-angle = optional follow-up; `deliberation` intentionally NOT wired — 2 agents is
not "scale".)

## Deferred / open
- Programmatic launch unavailable today — re-evaluate if Claude Code exposes a launch tool/API.
- Saved `.claude/workflows/gorkhali-*.js` library deferred until the workflow JS agent-spawn API is
  confirmed (probe a run, `Ctrl+G` / "View raw script").
- `execute`-SHADOWS-as-workflow deferred (direct edits + worktree/merge + bypass/acceptEdits risk).
- No telemetry yet on whether recommendations help — refine thresholds from real session data.
