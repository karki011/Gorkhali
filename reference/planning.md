# Planning Protocol

## Intent Capture (mandatory)

```
Goal:            [success in one sentence]
Done When:       [machine-checkable exit conditions -- verifiable predicates]
Priority:        [speed | quality | ux | stability | scope -- ranked]
Tradeoffs:       [what CAN be sacrificed]
Non-negotiables: [what MUST NOT be compromised]
Spec Delta:      [what changed from original requirements -- or "none" if first pass]
```

Done When sourcing: 1) Jira AC if available, 2) ask user if no Jira, 3) format as verifiable predicates.

### Spec Delta Tracking

Every planning action produces a `specDelta` entry in `intent.json`:
- **Changed**: describe what changed and why
- **Unchanged**: `"specDelta": "none -- original requirements unchanged"`
- **Narrowed/expanded**: record what was cut/added and rationale

Pre-Ship Review Panel checks `specDelta` during wrap to verify scope alignment.

## Rival (mandatory, every plan)

Spawn sage agent (top tier via agent definition — Fable 5 with opus fallback; no tools, blocking):
- Input: complete plan + coding principles
- Output: Challenges (must address), Warnings (consider), Verdict
- PROCEED -> continue. REVISE -> address + re-run. RETHINK -> back to research.
- Max 2 iterations. Still RETHINK -> escalate to user.

## Codebase Research

Spawn Explore (session model) + Plan (session model) agents for:
- File structure and patterns
- Existing similar implementations
- Import/dependency chains

## Anti-Repetition Check

Before finalizing plan:
1. Scan `learnings/INDEX.md` for matching corrections
2. `[failed]` entries -> acknowledge, explain difference, or choose alternative
3. Log matches in plan under anti-repetition notes

## SOLO vs SHADOWS Decision

See `reference/agents.md` for routing table.

---

## Plan Quality Rules

### Machine-Checkable Acceptance Criteria

Every `doneWhen` entry in `intent.json` must be verifiable by one of:

| Type | Form |
|------|------|
| Test command | `{TEST_CMD}` exits 0 |
| Lint/build | `{LINT_CMD} && {BUILD_CMD}` exits 0 |
| File existence | `[ -f src/foo.ts ]` |
| Grep match | `grep -r "export.*FooComponent" src/` finds a result |
| API/CLI output | `curl localhost:{DEV_PORT}/health` returns `{"status":"ok"}` |
| Snapshot/diff | `git diff --name-only` includes expected file |

`{TEST_CMD}` / `{LINT_CMD}` / `{BUILD_CMD}` / `{TYPECHECK_CMD}` are resolved via the discovery protocol in `reference/verification.md`. `{DEV_PORT}` comes from dev-server config or framework startup output — never assume a fixed port.

**Banned forms** (plan fails immediately if any appear):
```
TBD / TODO / TBC
"similar to Task N"
"etc." / "and so on"
"as needed" / "if necessary" / "where appropriate"
"appropriate error handling"
"proper validation"
"update tests accordingly"
```

If any appear in `doneWhen`, `description`, or `action` fields -- the plan is incomplete. Rewrite as a command or observable fact.

### Requirement Coverage

Before finalizing `plan.json`, trace every `doneWhen` entry to at least one task:
```
intent.doneWhen[i]  ->  plan.tasks[j].description  (must match)
```
A `doneWhen` with no matching task is a coverage gap. Either add a task or remove the criterion.

### Placeholder Prohibition

The apex agent MUST reject `plan.json` with `verdict: REVISE` if:
- Any task `description` contains banned terms above
- Any `doneWhen` is not independently verifiable (no command, no file, no grep)
- Any task has `files: []` (every task must touch at least one file)
- `dependsOn` references a non-existent task ID

### Research-Free Tasking

Every task handed to an implementer must arrive research-free.
Apex resolves all open questions during planning: `read_first` paths, exact files, the pattern or example to follow, and the contract.
If executing a task would require the implementer to explore the codebase, search docs, or make a design decision, the plan is incomplete - re-decompose the task instead of escalating its model.
Raising the implementer model is never a remedy for weak scoping, and `fable` is never a legal implementer model (enforced by `hooks/blade-model-gate.js`).

## Task Structure

See `schemas/plan.md` for the full task template, field rules, and extended fields (`read_first`, `acceptance_criteria`).

## Plan Artifacts

Every plan produces two required files, each with one job, plus one optional third:

- **`plan.json`** — the machine source of truth. `phantom:execute`, `phantom:wire`, and `phantom:resume` all read this file, never `plan.html`.
- **`plan.html`** — the human gate surface. Always rendered from `plan.json` via `node scripts/render-plan.js <path-to-plan.json>` (see `commands/start.md` PLAN route, HUMAN GATE step). Never hand-authored, never parsed back into anything.
- **`plan-check.json`** (optional) — the plan-checker's verdict, written to the session directory by the plan-checker agent (`agents/plan-checker.md`). When present as a sibling of `plan.json`, `render-plan.js` auto-discovers it and renders a "Plan Check" section inside `plan.html`, so the human sees the checker's verdict alongside the plan. Absent means no section — the plan-checker didn't run, or wasn't required for this route.

If `plan.json` changes after the initial render — during deliberation, a fix-loop revision, or a resumed session — re-run the renderer so `plan.html` stays in sync before the next human review.

### Gate-loop revisions

During the plan-gate annotate-revise loop (`commands/annotate.md`, plan-gate case), each cycle edits `plan.json` and regenerates `plan.html` — `plan.html` is never hand-edited. Every cycle is recorded as an entry in the `revisions[]` array of `{SESSION_DIR}/decisions.json`, shaped `{cycle, annotations[], classification, planChanges, recheck}` (`recheck` holds the plan-checker/rival verdicts on material changes, `null` on cosmetic-only cycles). The loop ceiling is 3 cycles; after that, unresolved sticking points move to plain chat discussion rather than a re-render.

## Research-Enriched Plan Artifact (mandatory at the gate)

A plan gate that opens with tasks/files/waves and buries or omits the actual findings is a failed gate — for research/evaluation/investigation tickets ("how does X work", "what's causing Y", "should we adopt Z"), the human must be able to tell what was found without reading task descriptions.

### `research` block in `plan.json`

Phase B writes a `research` block whenever the ticket is research/evaluation/investigation-shaped. Optional for pure implementation tickets — even then, a findings-first narrative is preferred over a manifest-first one.

```
research: {
  question:   "..."                                       -- what was being investigated
  findings:   [{ claim, evidence: "path/to/file.ts:123" }] -- every finding cites file:line
  comparison: "..."                                        -- gap analysis, current vs desired
  options:    [{ name, tradeoffs, status: "chosen" | "deferred", why }]
  verdict:    "..."                                        -- the recommendation
}
decisions: [{ decision, rationale }]
```

### Render order

The gate artifact leads with the research narrative — question -> findings -> verdict -> options -> decisions. Tasks, files, and contracts render last, as the "what we'll do about it" tail, never the opening.

### Renderer fallback

If `render-plan.js` doesn't render the `research` block (older renderer, no section support yet), Apex authors the enriched HTML directly over `plan.html` before opening the gate. The mechanical render is a fallback skeleton, never the final research artifact — `plan.json` stays the machine SSoT throughout, `plan.html` is only ever the human-facing view of it.
