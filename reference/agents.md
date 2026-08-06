# Agent Registry

## Personas

| Agent | Default model | Role | File |
|-------|---------------|------|------|
| Apex | inherits session model (effort: high) | Orchestrator — plans, decomposes, coordinates, routes models | agents/apex.md |
| Blade | sonnet for well-scoped/contract-backed work · escalate to opus (hard ceiling - never fable, never session-inherit) for complex, ambiguous, cross-cutting work | Implementation — code, tests, config | agents/blade.md |
| Ward | haiku (frontmatter pin) | QA — runs verify commands, checks contracts | agents/ward.md |
| Gaze | opus (pinned — review tier) | Quality gate — power level, scoring | agents/gaze.md |
| Sage | opus (pinned — top tier) | Advisory — <100 words, no tools, no user output | agents/sage.md |
| Lens | sonnet (frontmatter pin) | Visual — browser verification, screenshots | agents/lens.md |
| Archer | opus (pinned — review tier) | Cross-file — cache coherence, regression, dead code | agents/archer.md |
| Rival | sonnet (frontmatter pin) | Plan challenger — 5 categories, verdict | agents/rival.md |
| Plan Checker | sonnet (frontmatter pin) · escalate for large/complex plans | Pre-execution validator — learnings, blast radius, coverage, scope, deps | agents/plan-checker.md |
| Hound | opus (frontmatter pin) | Forensic investigator — root-cause tracing, HTML report | agents/hound.md |
| Sweep | sonnet (frontmatter pin) | Code clarity — simplify changed files post-verify | agents/sweep.md |
| Warden | sonnet (frontmatter pin) | Lifecycle plumbing — mechanical ship/close ops (git, PR, Jira, cost, artifacts) for wrap tail + close | agents/warden.md |

## Model Routing (Apex decides at spawn)

**Implementer roles (Blade, Sweep, Ward, Lens, Warden) are capped at opus and never run fable;
the escalation ladder is re-decompose -> sonnet -> opus. If a subtask can't be scoped to fit within
opus, the scoping failed - Apex re-decomposes.**

**Default = task-appropriate tier, not "inherit everything."** The session model (now Opus 5)
belongs to orchestration; for implementer roles the ceiling is opus, and the floor logic below routes
the cheapest model that fits the work. Apex picks the model per spawn via the Agent tool `model:` param.
**Effort is uniform `high`**, inherited from the session — there is NO per-spawn effort param, so
never try to set effort at spawn time. Tune speed/cost via **model**, not effort.

Apex has OPTIONS, not a rigid lookup. Use these criteria per role:

- **Mechanical / tool-driver roles** (Sweep, Lens, Plan Checker, and search/Explore-style
  spawns) → default **CHEAP (sonnet)**. These pin `sonnet` in frontmatter. Ward pins `haiku`
  (verification is mechanical). Escalate to opus (the
  implementer ceiling - never fable, never session-inherit) ONLY if the task proves non-trivial (e.g.
  a sweep spanning many files with subtle semantics, a plan check over a large/ambiguous plan,
  verification requiring real debugging).
- **Implementation** (Blade) → default **sonnet** for well-scoped, contract-backed subtasks
  (clear inputs/outputs, named file owner, no open design decisions). Escalate to
  opus (hard ceiling for implementers - never fable, never session-inherit) for complex, ambiguous, or
  cross-cutting work, or where decomposition left the subtask fuzzy. "Good tasking earns Sonnet" — fix
  weak scoping by re-decomposing, not by throwing the expensive model at it.
- **Reasoning / review roles** (Gaze, Archer, Hound, Rival, Sage) → **UNCHANGED**. Gaze and Archer
  pin `opus` in frontmatter (review tier — opus is the top tier now that Fable is retired from
  Phantom's routing). Sage pins `opus` (top-tier advisory). Hound pins opus
  and Rival pins sonnet in frontmatter. Do NOT downshift Gaze, Archer, or Hound.
- **Orchestration** (Apex) → the session model.

When decomposing, keep tagging each subtask `mechanical | standard | complex`. CHEAP (sonnet) is the
**floor** for mechanical work and for standard work that has a tight contract:
- mechanical → sonnet (escalate only if it turns out non-trivial)
- standard with a tight contract → sonnet
- standard but fuzzy, or complex / ambiguous / cross-cutting → opus (hard ceiling for implementers -
  never fable, never session-inherit)

**Precedence (highest wins):** explicit spawn `model:` param > config override (`config.yaml`
`models:` block, if present) > agent frontmatter pin > this rubric default. Frontmatter pins are
honored, and any user-supplied config override is honored on top of them — the rubric only fills the
gap when nothing more specific is set. For implementer roles (blade, sweep, ward, lens, warden) any
override above opus is invalid - `hooks/blade-model-gate.js` denies fable regardless of source.
Use bare aliases (opus/sonnet/haiku); never pin dated or prior-generation model IDs.

**Articulate before you escalate.** Every implementer spawn MUST state one visible line:
`scope: mechanical|standard|complex · floor-sufficient? Y/N · reason`. The floor is sonnet (haiku
for trivial mechanical). Choosing opus requires a concrete reason tied to *this* subtask - a named
design decision, cross-file coupling, or genuine ambiguity. "It's subtle/tricky" is not a reason.
If you can't name why the floor fails, the floor wins. Weak scoping is fixed by re-decomposing, not
by escalating.

## Naming

Every `Agent` spawn MUST pass `name:` per `reference/roster.md` - that file is the
SSoT for deterministic agent naming (roster table, fungible-slot rule, panel
function-naming, overflow fallback, and the stub-filename binding).
Slots are static: execute-wave agents use their task's index from `plan.json`;
every other spawn site has a fixed slot in that file's Spawn-Site Slot Table.
Never count slots at runtime.

## Pre-Dispatch Routing Table (the ONE definition)

Before spawning any wave of agents - one task (DIRECT) or many (SOLO/SHADOWS) -
Apex renders, visibly in its output, a markdown table with exactly these 7
columns:

`| Task | Scope (files) | Agent | Name | Model | Wave | Routing reason |`

- **Task** - the plan task id (`t1`, `t2`, ...; DIRECT has a single implicit task).
- **Scope (files)** - the task's file targets from `plan.json` (or `intent.json` for DIRECT).
- **Agent** - the `subagent_type` being spawned.
- **Name** - the roster-assigned `name:` per `reference/roster.md` - the
  Execute-Wave Reservation for wave tasks, or the file's Spawn-Site Slot Table
  row for every other site.
- **Model** - the `model:` param chosen per Model Routing above.
- **Wave** - the wave number this spawn belongs to (`1` for a single-task
  dispatch with no fan-out, e.g. DIRECT).
- **Routing reason** - the one-line scope check (`scope:
  mechanical|standard|complex · floor-sufficient? Y/N · reason`) from
  "Articulate before you escalate" above. This column cell IS that scope
  check, not a separate step; escalating above the floor without a concrete
  per-subtask reason recorded here is a routing error.

This is the single canonical definition of the pre-dispatch table.
`agents/apex.md`, `commands/execute.md`, and `commands/start.md`'s DIRECT route
all point here rather than restating the columns.

## Spawning Rules

- All agents: `mode: "bypassPermissions"`
- Model: Apex picks per spawn per **Model Routing** above (default = task-appropriate tier; sonnet floor for mechanical and well-scoped work, escalate for complex/ambiguous/cross-cutting up to opus - hard ceiling for implementers, never fable, never session-inherit). Honor `MODEL_OVERRIDE` from session context if set. Use bare aliases (opus/sonnet/haiku); never pin dated or prior-generation model IDs.
- Parallel agents: use `isolation: "worktree"` to prevent file conflicts
- Sage: max 3 calls per Blade. No tools. No user output.
- Background: use `run_in_background: true` for non-blocking agents

## Context Discipline

**Rationale:** Apex is the dominant cost — its long-lived loop is the bulk of spend, and most of that is
cache-read from re-carrying artifacts. Keep Apex's window lean. These rules are canonical; other files
point here.

1. **Pass paths, not content.** When spawning a subagent, give it FILE PATHS to read itself — never paste
   large file bodies into the spawn prompt. Already-extracted task scope inline is fine; full file
   contents are not. The subagent loads them in its own window so Apex's context stays lean.
2. **Never double-read.** Do not Read a file that the subagent will read for you. Let the subagent load it
   in its own context.
3. **Verify by spot-check, not re-read.** Confirm a subagent's work via filesystem/git spot-check (target
   file exists, ≥1 commit present, no `Self-Check: FAILED` / verdict-failure line) instead of pulling full
   outputs or file bodies back into Apex context.
4. **Ingest verdicts, not bodies.** Apex consumes each subagent's verdict/summary section, never the full
   output or logs. Summaries enter the conversation; full outputs stay in their files.

## SOLO vs SHADOWS Routing

| Condition | Route |
|-----------|-------|
| 1-3 files, single concern | SOLO |
| 4+ files, multi-concern, cross-package | SHADOWS |
| API + tests, security, schema + app | SHADOWS |
| Auto-SHADOWS trigger (Iron Law 10) fires | SHADOWS |

## Route & Model Guidance

Effort is uniform `high` for every agent (session-inherited; Apex pinned). Tune speed via **model**,
not effort.

- Simple fix (1-2 files): SOLO, Blade on sonnet, ~5 min
- Feature (3-5 files): SOLO or SHADOWS, Blade on sonnet for tightly-scoped subtasks, escalate fuzzy/cross-cutting subtasks to opus (hard ceiling for implementers - never fable, never session-inherit), ~15 min
- Complex feature (5+ files): SHADOWS, Blade on opus (hard ceiling for implementers - never fable, never session-inherit) for the hard subtasks + Sage (top tier), ~30 min
