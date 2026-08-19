# Agent Registry

## Personas

The team runs a ladder, and the rung is not decoration: it is the `model-policy.json`
profile in plain language, so it moves only when the policy moves. `frontier` is the
lead, `deep` is principal, `balanced` is staff, `economy` is engineer. The rung sets how
much judgment the role is trusted with and therefore how tightly Chief briefs it: a
principal is handed the problem, a staff engineer a scoped assignment, an engineer a
command to run. `test/agent-seniority.test.js` holds title and profile together.

| Agent | Seniority | Default model | Role | File |
|-------|-----------|---------------|------|------|
| Chief | Engineering lead | inherits session model (effort: high) | Orchestrator: plans, decomposes, coordinates, routes models | agents/chief.md |
| Engineer | Staff | sonnet (frontmatter pin) | Implementation: code, tests, config | agents/engineer.md |
| Inspector | Engineer | sonnet (frontmatter pin) | QA: runs verify commands, checks contracts | agents/inspector.md |
| Auditor | Principal | sonnet (frontmatter pin, review tier) | Quality gate: power level, scoring | agents/auditor.md |
| Advisor | Principal | sonnet (frontmatter pin, top rung) | Advisory: <100 words, no tools, no user output | agents/advisor.md |
| Surveyor | Staff | sonnet (frontmatter pin) | Explicitly requested read-only visual evidence; advisory only | agents/surveyor.md |
| Justice | Principal | sonnet (frontmatter pin, review tier) | Cross-file: cache coherence, regression, dead code | agents/justice.md |
| Opposition | Staff | sonnet (frontmatter pin) | Plan critic: 8 challenge/validation checks, chat verdict + `plan-check.json` | agents/opposition.md |
| Detective | Principal | sonnet (frontmatter pin) | Forensic investigator: root-cause tracing, HTML report | agents/detective.md |
| Steward | Staff | sonnet (frontmatter pin) | Code clarity: simplify changed files post-verify | agents/steward.md |
| Clerk | Engineer | sonnet (frontmatter pin) | Lifecycle plumbing: mechanical ship/close ops (git, PR, Jira, cost, artifacts) for wrap tail + close | agents/clerk.md |

## Model Routing (Chief decides at spawn)

**Everything Chief delegates runs `sonnet`. Opus is orchestration-only.** On this host
`model-presets.json` maps every delegated profile — `economy`, `balanced`, `deep`, and `frontier`
alike — onto `sonnet`, so there is no cheaper tier to fall to and no richer tier to escalate into.
The seniority ladder is unchanged and still load-bearing: the rung a role sits at in
`model-policy.json` decides how Chief BRIEFS it (a principal gets the problem, a staff engineer gets
a resolved contract, an engineer gets the commands), not what it costs.

**One consequence worth stating plainly: escalation is no longer a routing move.** When a subtask
turns out to be too big, too fuzzy, or too cross-cutting for the model, the answer is to
**re-decompose it** — there is nothing above sonnet to hand it to. Weak scoping used to be
survivable by throwing a bigger model at it; now it is not.

**Effort is uniform `high`**, inherited from the session — there is NO per-spawn effort param, so
never try to set effort at spawn time.

Chief still picks the model per spawn via the Agent tool `model:` param, and on this host that value
is always `sonnet`. Spawn it explicitly rather than leaning on the frontmatter pin: the routing
choice belongs in Chief's visible output, and `hooks/engineer-model-gate.js` denies any Engineer spawn that
omits it.

- **Implementation** (Engineer), **mechanical / tool-driver roles** (Steward, Surveyor, Inspector, Clerk, and
  search/Explore-style spawns), and **reasoning / review roles** (Auditor, Justice, Detective, Opposition, Advisor)
  → `sonnet`, every one of them.
- **Orchestration** (Chief) → the session model, which is the only place Opus still belongs.

When decomposing, keep tagging each subtask `mechanical | standard | complex`. The tag no longer
selects a model — it is the honest scope signal that tells Chief whether the subtask is small enough
for one Engineer at all. A `complex` tag on a single assignment is now a decomposition smell, not a
routing instruction.

**Precedence (highest wins):** explicit spawn `model:` param > config override (`config.yaml`
`models:` block, if present) > agent frontmatter pin > this rubric default. Frontmatter pins are
honored, and any user-supplied config override is honored on top of them — the rubric only fills the
gap when nothing more specific is set. A user who explicitly asks for a different model gets it;
`hooks/engineer-model-gate.js` denies fable for implementer roles regardless of source.
Use bare aliases (sonnet/opus/haiku); never pin dated or prior-generation model IDs.

**Articulate before you spawn.** Every implementer spawn MUST still state one visible line:
`scope: mechanical|standard|complex · floor-sufficient? Y/N · reason`. `floor-sufficient? N` no
longer buys a bigger model — it is a signal that this assignment needs re-decomposing before it is
dispatched. Recording it keeps the scoping judgment visible instead of silent.

**Delegation calibration.** Spawning a subagent pays off on sizeable, genuinely independent tracks
of work, and multiplies cost on small ones - each spawn carries its own context load, coordination
overhead, and verification pass, so a one-line change routed through its own agent spends more than
it saves. Batch related small edits into a single Engineer rather than assigning one agent per change;
never spawn one-line-per-agent. Prefer a single worker when one suffices, and keep spawn counts low
even when the work could technically be split further.

This file is canonical for Claude-native hosts; `skills/phantom/references/roles.md` deliberately
carries its own copy of this same calibration for the portable-contract path.

## Naming

Every `Agent` spawn MUST pass `name:` per `reference/roster.md` - that file is the
SSoT for deterministic agent naming (roster table, fungible-slot rule, panel
function-naming, overflow fallback, and the stub-filename binding).
Slots are static: execute-wave agents use their task's index from `plan.json`;
every other spawn site has a fixed slot in that file's Spawn-Site Slot Table.
Never count slots at runtime.

## Pre-Dispatch Routing Table (the ONE definition)

Before spawning any wave of agents - one task (DIRECT) or many (SOLO/SHADOWS) -
Chief renders, visibly in its output, a markdown table with exactly these 7
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
`agents/chief.md`, `commands/execute.md`, and `commands/start.md`'s DIRECT route
all point here rather than restating the columns.

## Spawning Rules

- All agents: `mode: "bypassPermissions"`
- Model: Chief passes it explicitly per spawn per **Model Routing** above — `sonnet` for every delegated role on this host, never session-inherit. Honor `MODEL_OVERRIDE` from session context if set. Use bare aliases (sonnet/opus/haiku); never pin dated or prior-generation model IDs.
- Parallel agents: use `isolation: "worktree"` to prevent file conflicts
- Advisor: max 3 calls per Engineer. No tools. No user output.
- Background: use `run_in_background: true` for non-blocking agents

## Context Discipline

**Rationale:** Chief is the dominant cost — its long-lived loop is the bulk of spend, and most of that is
cache-read from re-carrying artifacts. Keep Chief's window lean. These rules are canonical; other files
point here.

1. **Pass paths, not content.** When spawning a subagent, give it FILE PATHS to read itself — never paste
   large file bodies into the spawn prompt. Already-extracted task scope inline is fine; full file
   contents are not. The subagent loads them in its own window so Chief's context stays lean.
2. **Never double-read.** Do not Read a file that the subagent will read for you. Let the subagent load it
   in its own context.
3. **Verify by spot-check, not re-read.** Confirm a subagent's work via filesystem/git spot-check (target
   file exists, ≥1 commit present, no `Self-Check: FAILED` / verdict-failure line) instead of pulling full
   outputs or file bodies back into Chief context.
4. **Ingest verdicts, not bodies.** Chief consumes each subagent's verdict/summary section, never the full
   output or logs. Summaries enter the conversation; full outputs stay in their files.

## SOLO vs SHADOWS Routing

| Condition | Route |
|-----------|-------|
| 1-3 files, single concern | SOLO |
| 4+ files, multi-concern, cross-package | SHADOWS |
| API + tests, security, schema + app | SHADOWS |
| Auto-SHADOWS trigger (Iron Law 10) fires | SHADOWS |

## Route & Model Guidance

Effort is uniform `high` for every agent (session-inherited; Chief pinned). Model is uniform `sonnet`
for everything delegated, so the only real knobs left are **scope and route**.

- Simple fix (1-2 files): SOLO, one Engineer on sonnet, ~5 min
- Feature (3-5 files): SOLO or SHADOWS, Engineer(s) on sonnet, ~15 min
- Complex feature (5+ files): SHADOWS on sonnet — split the hard subtasks smaller rather than
  reaching for a bigger model, and let a stuck Engineer consult Advisor for a fresh read, ~30 min
