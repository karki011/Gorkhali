# PHANTOM - Your Shadow Army of AI Agents

[![CI](https://github.com/Cloudzero/research-phantom-skills/actions/workflows/ci.yml/badge.svg)](https://github.com/Cloudzero/research-phantom-skills/actions/workflows/ci.yml)
[![version](https://img.shields.io/badge/version-0.2.8-blue)](.claude-plugin/plugin.json)
[![tests](https://img.shields.io/badge/tests-689-brightgreen)](test/)
[![runtimes](https://img.shields.io/badge/runtimes-Claude%20Code%20%2B%20Codex%20CLI-8A2BE2)](#install)

**Author: Subash Karki**

Phantom is a multi-agent development harness for Claude Code and Codex CLI that plans, implements, verifies, and ships work through specialized agents behind mechanically enforced gates.

> Inspired by Solo Leveling: you're the Monarch, your AI agents are the shadow army.
> Say `/phantom:recruit` - "Arise!" - and they answer.

## What It Does

Every task is a Gate. Phantom reads the difficulty, assembles the right shadows, and clears it. After every run, the system gains EXP - learning what works, remembering what doesn't.

Trivial tasks skip planning entirely. Ambiguous tasks brainstorm first. Complex tasks get full dependency wiring. Shadows deliberate among themselves; humans approve consensus or break ties.

Zero external plugin dependencies. Fully self-contained.

See `ROADMAP.md` for the durable backlog, decisions, and measured baseline.

## Mechanical Gates, Not Advice

The usual way to constrain an agent is prose in a prompt, which the model is free to ignore.
Phantom's gates are code that returns a decision before the tool call runs.

- `hooks/blade-model-gate.js` inspects every `Agent`/`Task` spawn and returns `permissionDecision: "deny"` when an implementer role is pinned above its ceiling or onto a retired tier.
  The spawn does not happen.
- `hooks/greploop-gate.js` is a `Stop` hook that returns `decision: "block"` when a live PR has not been through the review loop, so a session cannot quietly end unreviewed.
  It is bounded, and any ambiguity allows the stop.
- `hooks/routing-gate.js` returns `permissionDecision: "deny"` on `Edit`/`Write` inside a Phantom-known repo with no active session.
  It is opt-in via `PHANTOM_ROUTING_ENFORCE=1` and fails open by design.
- `test/agent-frontmatter-drift.test.js` fails CI when any `agents/*.md` model pin drifts from `references/model-policy.json`.
  A hand-edited routing decision does not survive to a merge.

Every registration is visible in `hooks/hooks.json`.

## Measured, Not Claimed

One number, with its sample stated before the number.

**99.1% merge rate across 112 distinct PRs** (111 merged, 1 closed), taken from `gh` as ground truth.
Produced by `scripts/baseline-report.js` over 191 canonical wrap records spanning 152 tickets and two months of real use.

The caveats matter more than the figure.
This is one developer's usage on their own repositories, the PRs were largely authored and merged by the same person, and external review ran on only 50 of those 191 sessions.
n=112 is a sample, not a study, and no third party has validated it.
The full table, and the beliefs that measurement disproved, are in `ROADMAP.md` sections 3 and 4.

## One Ticket, End To End

```text
/phantom:start CP-41606
  |- router classifies    -> PLAN route (3+ files, clear scope)
  |- Apex + Rival         -> plan, adversarially reviewed; you approve or break the tie
  |- Blade x2 (parallel)  -> implementation in isolated worktrees
  |- Ward                 -> lint, build, test -> verification.json
  |- Gaze + Archer        -> scored review; P0/P1 auto-fixed, P2/P3 dropped
  `- /phantom:wrap        -> draft PR + ticket cost total
```

The PR body's `## Validation` section is assembled from those artifacts: verify verdict with test counts, review panel outcome, grill verdict.
A missing artifact means a missing subsection, never invented text.
The PR opens as a **draft** deliberately, because marking it ready to review stays a human action.

Report a defect instead of a feature and no fix runs first.
The work is classified `investigation`, and no fix route can be selected until the evidence reaches `ready_for_fix`.

## What Is Actually In The Box

- **Proof before fix.** Every reported bug, regression, or flake writes a `defect-proof.json` and cannot reach a fix route until it reaches `ready_for_fix`. Spec: `reference/defect-proof.md`.
- **An unattended spend ceiling that halts honestly.** `PHANTOM_SPEND_CEILING_USD` (default `5`), enforced by `scripts/run-guard.js`, halts only on a CONFIRMED overrun and writes a halt record. Unknown spend continues rather than failing silently. Interactive sessions are never capped, because the watching human is the ceiling.
- **Model routing generated from one policy file.** `references/model-policy.json` holds semantic role policy, `references/model-presets.json` holds per-host models, and `scripts/gen-agent-frontmatter.js` generates every agent pin from them. No value is hand-maintained twice.
- **Outcome records with closed enums.** `scripts/outcome-write.js` writes a per-ticket outcome whose `pr_state` is one of `draft | open | merged | closed | absent`, derived from `gh` alone. Anything unmappable is recorded as unresolved instead of guessed. This is what made the measurement above possible at all.
- **A config layer with provenance.** `scripts/phantom-config.js get|set|list`, per-repo winning over global, created lazily. Every resolved value reports which layer it came from, and an unset key reports unset rather than a fabricated default.
- **Portable across runtimes.** One provider-neutral Agent Skill at `skills/phantom/` runs on Claude Code and Codex CLI alongside a native plugin distribution. Optional host capabilities degrade to explicit fallbacks instead of breaking the workflow.

## Portable Agent Skill

The canonical product is one provider-neutral Agent Skill at
`skills/phantom/`. Copy that directory unchanged into any Agent
Skills-compatible discovery path. It contains no provider paths, proprietary
tool calls, or plugin manifests. Host-specific model identifiers are isolated
in one data-only preset registry; the workflow remains provider-neutral.

The skill negotiates capabilities at runtime. Delegation, parallel execution,
native dependency graphs, visual tools, hooks, issue trackers, and review
publishing are optional accelerators with explicit fallbacks. When no native
graph is exposed, the skill runs its bundled, read-only impact analyzer through
ordinary command execution. It builds a bounded import graph for that invocation,
returns JSON, and exits; it installs no server, daemon, hook, or host registration.
The workflow and artifact contracts remain the same when optional capabilities
are missing.

Apex makes the delegation decision automatically after routing and dependency
inspection. Users provide the goal; they do not need to request subagents,
choose a worker count, or maintain per-worker model settings. Phantom uses the
smallest useful topology, delegates only through native host capabilities, and
falls back to labeled sequential role passes when spawning is unavailable or
not worthwhile. It never recursively launches the current runtime through
command execution to imitate a native worker.

Phantom also applies a minimum-sufficient-solution ladder after it understands
the real code path: omit what is unnecessary, then prefer repository reuse,
the standard library, native platform capabilities, installed dependencies,
and direct expressions before writing the smallest custom implementation. The
same constraint is included in every delegated assignment and checked again by
Sweep. This policy is adapted from the ideas in
[Ponytail](https://github.com/dietrichgebert/ponytail); Phantom does not bundle
Ponytail's hooks, modes, adapters, or runtime dependency.

Phantom asks for semantic profiles - `inherit`, `economy`, `balanced`, `deep`,
or `frontier` - and ships maintained defaults for Claude Code and Codex. Users
do not need a `models.json`. An explicit user choice or optional external map
can override the defaults; unknown hosts inherit the active model. See
`skills/phantom/references/models.md`.

## Quick Start

In an Agent Skills-compatible host, ask naturally:

```text
Use Phantom to implement CP-41606 through a tested review request.
Use Phantom to investigate why the dashboard feels slow.
Use Phantom to pause this task and preserve a resumable checkpoint.
```

The existing native plugin remains as a compatibility distribution with its
command surface:

```bash
/phantom:start CP-41606                    # router classifies → plan → execute → verify → ship
/phantom:start "the dashboard feels slow"  # ambiguous → brainstorm → plan → execute → verify
/phantom:verify                            # power level (P0/P1 fix, P2/P3 drop)
/phantom:wrap                              # commit, push, PR, Jira transition
/phantom:pause → /clear → /phantom:resume     # context mgmt + portable handoff packet
```

In Codex, type `$` or open `/skills`, then select the namespaced skill such as
`phantom:start`, `phantom:pause`, `phantom:wrap`, `phantom:loop`, or
`phantom:greploop`. Codex can also choose these skills implicitly from their
descriptions. Start a new task or CLI session after installing or updating the
plugin so the complete skill inventory is reloaded.

## Architecture - Adaptive Cognitive Router

The router classifies incoming tasks and selects the right cognitive mode:

```
                        ┌─────────────────┐
                        │   User Input    │
                        └────────┬────────┘
                                 │
                    ┌────────────┴────────────┐
                    │  Phase A: Context +     │
                    │  Classify (signals:     │
                    │  scope, uncertainty,    │
                    │  risk, confidence)      │
                    └────────────┬────────────┘
                                 │
            ┌────────┬───────────┼───────────┬────────┐
            ▼        ▼           ▼           ▼        │
        DIRECT     PLAN    BRAINSTORM     FULL        │
        <3 files   3+ files  ambiguous   cross-cutting│
        known      clear     or new      multi-system │
        pattern    scope     domain      risky        │
            │        │           │           │        │
            │    Planner ←→  Brainstorm  Brainstorm   │
            │    Challenger   → Plan      → Plan      │
            │    (2 rounds)   → Execute   → Wire      │
            │        │           │        → Execute    │
            ▼        ▼           ▼           ▼        │
         Execute  Execute     Execute     Execute     │
            │        │           │           │        │
            ▼        ▼           ▼           ▼        │
         Verify   Verify      Verify      Verify     │
            │        │           │           │        │
            └────────┴───────────┴───────────┘        │
                                 │                    │
                    ┌────────────┴────────────┐       │
                    │       Wrap / Ship       │◄──────┘
                    └─────────────────────────┘
```

**Human intervention scales with uncertainty, not task size.** A big but well-understood refactor may need zero human input. A small but novel integration may need brainstorming.

## Key Concepts

**Adaptive Routing** - AI reads the task and picks the route. Signals: scope clarity, file count, uncertainty level, risk, learnings history. See `reference/router.md`.

**Deliberative Planning** - Planner produces plan, Challenger (Rival) reviews it. If consensus → human gets a quick OK. If disagreement → human breaks the tie. Max 2 rounds.

**Brainstorm Mode** - Diverge/converge for ambiguous scope. Proposes 2-3 approaches with tradeoffs. Asks only what it can't infer from codebase context. See `reference/brainstorm.md`.

**Wiring Mode** - Novel: explicit dependency topology between plan tasks. Maps producers/consumers, assigns parallel execution waves, flags integration risk points. No other system does this. See `reference/wiring.md`.

**Core Disciplines** - 15 rules, each with a WHY explaining the failure mode it prevents. Enforced structurally via hooks and artifact schemas, not prompt ceremony.

**Power Level** - P0 (critical) + P1 (high) auto-fix. P2 (medium) + P3 (low) dropped.

**Direct HTML Review** - For plan and brainstorm gates, the active AI authors a self-contained candidate HTML page from canonical JSON. A local validator promotes it to the accepted artifact, which opens directly; approval and feedback stay in the existing chat. Visualflow artifacts also open directly, with feedback captured in chat.

**Anti-Repetition** - Scans learnings before every approach. `[failed]` entries are blocked. `[validated:5+]` entries auto-apply.

**Self-Evolution** - Tier 0: external absorption (user approval). Tier 1: reference auto-promote. Tier 2: skill edits (user approval). Tier 3: skill spawning (user approval).

**Final Status Block** - every skill ends with a clear 🟢 done / 🟡 done-with-caveat / 🔴 blocked work-state signal.

## Folder Structure

The canonical portable skill and the existing native compatibility plugin live
side-by-side. The portable directory is self-contained and never imports the
native plugin tree:

```
skills/phantom/          # canonical provider-neutral Agent Skill
├── SKILL.md             # intent router and invariant workflow
├── manifest.json        # bundle and portable contract versions
├── references/          # capabilities, profiles, roles, state, workflows, QA
└── scripts/             # portable state, profile, and impact-analysis helpers

{PLUGIN_ROOT}/           # native compatibility plugin
├── .claude-plugin/    # Plugin manifest + self-hosted marketplace
│   ├── plugin.json        # Native Claude Code plugin manifest
│   └── marketplace.json   # Marketplace entry (install source)
├── commands/          # 28 command directives (+ 10 _shared partials)
├── reference/         # reference files (on-demand, injected by hooks)
│   ├── router.md          # Classification algorithm, deliberation protocol
│   ├── brainstorm.md      # Diverge/converge protocol, question-asking rules
│   ├── wiring.md          # Dependency topology, wave assignments
│   ├── planning.md        # Machine-checkable criteria, anti-placeholder rules
│   ├── detective-protocol.md  # 7-step investigation with HTML reports
│   ├── _base-agent.md     # Template for spawning new agent types
│   └── ...
├── agents/            # 12 agent personas
├── bin/               # thin executable entry shims; logic lives in scripts/ (e.g., bin/phantom-preflight → scripts/preflight.js)
├── scripts/           # deterministic helpers (no LLM needed)
│   ├── validate-artifact.js   # JSON schema validation
│   ├── check-learnings-index.js
│   ├── session-health.sh
│   ├── preamble-tier.js
│   ├── timing-report.js       # per-model agent timing (wall-clock by model)
│   ├── phantom-config.js      # config CLI: get/set/list (see Configuration)
│   ├── baseline-report.js     # read-only retrospective miner: PR/merge rates, spawn counts, policy-vs-observed model
│   ├── outcome-write.js       # writes the per-ticket outcome record (closed pr_state enum); called from wrap and close
│   ├── run-guard.js           # unattended-run guard: spend ceiling + stuck detection
│   ├── gen-agent-frontmatter.js  # regenerates agents/*.md model pins from model-policy.json; --check is the CI drift gate
│   └── release-version.js     # keeps the three plugin manifests' versions in sync; --check / --set <semver>
├── evals/             # 55 test cases for skill triggering verification
├── hooks/             # Structural enforcement
│   ├── hooks.json         # Plugin-owned hook registrations
│   └── timing-capture.js  # records agent spawn/stop + model (PreToolUse Agent + SubagentStop)
└── templates/         # Reusable contract templates
```

Portable mutable state lives outside the skill under
`${PHANTOM_DATA:-~/.phantom}`. Set `PHANTOM_DATA` to use an explicit root;
otherwise every supported runtime uses `~/.phantom`:

```
${PHANTOM_DATA:-~/.phantom}/
├── state/current-session/{repo-id}.json
├── repos/{repo-id}/
│   ├── sessions/{task-id}/       # active portable artifacts and run evidence
│   ├── completed/{task-id}/      # completed sessions are retained, not deleted
│   └── learnings/                # provider-neutral corrections and patterns
├── global/patterns/
├── audit/
└── locks/
```

## Repo Brain

**Per-session distilled knowledge cards.** After every session, Phantom writes a lightweight card to the Repo Brain - one card per ticket. Cards live in `${PHANTOM_DATA}/repos/{REPO_NAME}/brain/cards/` as markdown files and grow monotonically (never deleted, only superseded). On-demand grep retrieval retrieves relevant cards at task start (see `commands/_shared-brain.md` for the retrieval query, and `reference/brain.md` for the card schema).

**Auto-migration on first run:** Branch-named repo dirs (leftover from old detection logic) are consolidated on first run via `scripts/migrate-repo-dirs.js` - idempotent and non-destructive.

## Shadows

| Agent | Role |
|-------|------|
| Apex | Orchestrator - plans, decomposes, coordinates, runs router, routes models |
| Blade | Implementation - parallel execution with ROLE FOCUS directives |
| Ward | QA - lint, build, test verification |
| Gaze | Quality gate - power level (scored, P0-P3) |
| Sage | Advisory - guidance for stuck agents (<100 words) |
| Lens | Visual verification - screenshot + diff |
| Archer | Cross-file review - pre-PR structural analysis |
| Rival | Plan challenger - adversarial review (no tools, forced precision) |
| Plan-checker | Pre-execution plan validator - learnings collisions, blast radius, coverage gaps, scope creep, dependency order |
| Hound | Forensic investigator - 7-step protocol, HTML reports |
| Sweep | Code clarity - simplify changed files post-verify |
| Warden | Mechanical session-lifecycle executor - ship/close plumbing: git, gh PR, Jira transitions, cost scripts, artifact writes |

Role-to-profile mapping lives in `skills/phantom/references/model-policy.json`, and profile-to-model per host lives in `skills/phantom/references/model-presets.json`.
`scripts/gen-agent-frontmatter.js` generates each `agents/*.md` `model:` pin from that policy, and a drift test fails CI on a hand-edited pin.

Implementer roles (**Blade**, **Sweep**, **Ward**, **Lens**, **Warden**) pin cheap profiles with an opus hard ceiling enforced by `hooks/blade-model-gate.js`, which also denies `fable` on implementers as a defensive guard.
The escalation ladder is re-decompose -> sonnet -> opus.
If a subtask can't be scoped to fit within opus, the scoping failed - Apex re-decomposes.
**Gaze** and **Archer** pin the review tier, and **Sage** pins the top tier so escalations from a downshifted Blade still reach it.
Apex tunes per spawn only to downshift further for small, well-scoped subtasks, and **effort is uniform `high`**, inherited from the session - there is no per-spawn effort param.
Use bare aliases only; never pin dated or prior-generation model IDs.

## Models & Effort

The portable skill keeps role policy semantic in
`skills/phantom/references/model-policy.json` and confines concrete defaults to
`skills/phantom/references/model-presets.json`. Resolution is explicit user
choice, optional external override, bundled host preset, then active-model
inheritance.

Every resolution diagnostic includes the canonical bundle version from
`skills/phantom/manifest.json`. This attributes routing results to the exact
portable bundle without changing existing resolver fields or precedence.

| Profile | Claude Code | Codex |
|---|---|---|
| `economy` | `haiku` | `gpt-5.6-luna` |
| `balanced` | `sonnet` at high effort | `gpt-5.6-terra` at high effort |
| `deep` | `opus` at high effort | `gpt-5.6-sol` at high effort |
| `frontier` | `opus` at high effort | `gpt-5.6-sol` at max effort |

Apex always requests `frontier` for planning, decomposition, and synthesis.
Delegated work selects the lowest sufficient profile: `economy` for mechanical
tasks, `balanced` for well-scoped implementation, and `deep` for ambiguity or
cross-cutting risk. If a bundled model is unavailable, the host retries without
a selector and inherits the active model. Explicit user choices are never
silently replaced.

For the native compatibility plugin, `scripts/gen-agent-frontmatter.js` generates
each `agents/*.md` `model:` pin from this policy (and `model-presets.json` for
the host); a drift test fails CI on any hand-edited pin.

The following policy describes the existing native compatibility plugin only.

Phantom runs every agent at **`high`** effort - that part is universal; effort is inherited from the session and there is no per-spawn effort param.
**Model is the per-task lever, not effort.**
Only the session and **Apex** (orchestration) leave model unset and inherit the session model - run your session on **Opus 5** (`/model opus`) for the best orchestration experience.
Implementer roles never inherit the session model; they pin cheap models with an opus hard ceiling instead (see above).
See `reference/agents.md` → Model Routing.

**Run at `/effort high`, not `ultracode`.** Ultracode lets the runtime wrap a phase in a background workflow that takes no mid-run input, which can silently bypass Phantom's approval gates. Use `high` for all gated phantom work.

Opus 5 (`claude-opus-5`, the recommended session model) is a step change on long-horizon agentic work - stronger instruction-following, built-in self-verification, and fewer steers - reinforcing the subagent-driven law.
It is Phantom's top tier: the session and **Apex** run on it, and every agent that pins the top tier (Gaze, Archer, Hound, Sage) resolves `opus` to it.

## Commands

| Command | Route | Description |
|---------|-------|-------------|
| `/phantom:start` | Entry | Adaptive router → classify → execute appropriate route |
| `/phantom:loop` (alias `/phantom:q`) | Entry | Self-contained Jira loop - polls every ticket assigned to you in status "Ready for Implementation" (all projects), triages AC: solid → `/phantom:start` to a draft PR; weak → `/phantom:start --to-plan` + Jira comment, then waits for the human to tighten the AC |
| `/phantom:verify` | - | Power Level with auto-fix for P0/P1 |
| `/phantom:wrap` | - | Commit, push, PR, Jira transition (+ optional `--recap` HTML diff recap) |
| `/phantom:close` | - | Post-merge closeout - Jira→Done, finalize+archive session, cleanup branch/worktree, final cost |
| `/phantom:greploop` | - | Drive a PR to a perfect Greptile review (auto-invoked by wrap) |
| `/phantom:fix` | - | Triage failures, assign scoped repairs (loop ceiling owned by `hooks/loop-controller.js`) |
| `/phantom:pause` | - | Save session state + emit a portable handoff packet (`handoff.md`) for cold/cross-session continuation |
| `/phantom:resume` | - | Restore session from saved state |
| `/phantom:hound` | - | Forensic investigation with HTML report |
| `/phantom:review` | - | Trigger Gaze quality gate |
| `/phantom:visual` | - | Trigger Lens visual inspection |
| `/phantom:visualflow` | - | Visual flow pass for net-new UI (auto-recommended, user-gated) |
| `/phantom:scout` | - | Background research agents |
| `/phantom:recruit` | - | Spawn specialist agent (role focus) |
| `/phantom:grill` | - | Quiz yourself on the diff before shipping |
| `/phantom:contract` | - | Create contract (feature/api/testing/ui/fix) |
| `/phantom:brainstorm` | - | Diverge/converge approaches for ambiguous scope (usually auto-invoked by start) |
| `/phantom:wire` | - | Map dependency topology → execution waves (auto/optional after plan) |
| `/phantom:execute` | - | Execute a saved plan |
| `/phantom:learn` | - | Capture a learning mid-session |
| `/phantom:evolve` | - | Scan learnings, propose promotions |
| `/phantom:health` | - | Diagnose knowledge layer |
| `/phantom:eval` | - | Evaluate shadows performance |
| `/phantom:validate` | - | Validate plan/output/session |
| `/phantom:sessions` | - | List all sessions with status |
| `/phantom:status` | - | Current task board |

## Independence

**Zero external plugin dependencies.** Previously depended on superpowers (14 skills), feature-dev, and code-sweep plugins. All have been:
- Superpowers: disabled, all 6 references replaced with own implementations
- Feature-dev: disabled, reference removed from gaze.md
- Code-sweep: absorbed into `agents/sweep.md` (plugin still enabled as backup, can be disabled)

## Configuration

### Config File

Optional and layered, created lazily - a fresh install needs no setup step.
Two JSON files, per-repo winning over global:

- `<data>/repos/<repo>/config.json` - per-repo
- `<data>/config.json` - global default

Resolution order, first hit wins: explicit override, per-repo, global, detect,
unset. Every resolved value carries provenance, so you can see why a setting
has its value; an unset key reports unset with the layers it searched, never
a fabricated default.

CLI: `node scripts/phantom-config.js get|set|list`, with `--global` on `set`
and `--json` throughout.

Current keys: `tracker.provider` (`jira`|`linear`|`github`|`file`|`none`),
`tracker.ready_signal`, `tracker.label`, `tracker.chosen`, `tracker.chosen_at`,
`jira.auto_transition`, `review.external` (`greptile`|`none`), `spend.ceiling_usd`.

### Environment Variables

The rest of optional behavior is controlled by environment variables. The
user-relevant ones:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PHANTOM_DATA` | `~/.phantom` | Root for all mutable state (sessions, learnings) |
| `PHANTOM_REPO` | git-root basename | Override the repo name used for state partitioning |
| `PHANTOM_ROUTING_NUDGE` | `1` (on) | Prompt-time routing reminder; set `0` to silence |
| `PHANTOM_ROUTING_ENFORCE` | `0` (off) | When `1`, hard-block implementation edits outside a phantom session |
| `PHANTOM_ADHOC` | unset | Set `1` for logged ad-hoc edits when routing enforcement is on |
| `PHANTOM_PROTECTED_BRANCHES` | `main,master` | Branches Phantom refuses to commit to directly |
| `PHANTOM_GREPTILE_TONE` | `neutral` | Tone for greploop's in-thread review replies |
| `PHANTOM_SPEND_CEILING_USD` | `5` | Unattended-run spend ceiling in USD (`scripts/run-guard.js`); binds only unattended runs - an interactive session is never capped because the watching human is the ceiling |
| `PHANTOM_STUCK_REPEAT_LIMIT` | `2` | Unattended-run stuck detection: same-failure-class repeats that halt the run |
| `PHANTOM_FIX_LOOP_CEILING` / `PHANTOM_GREPLOOP_GATE_MAX` / `PHANTOM_VISUAL_LOOP_CEILING` | - | Loop ceilings for fix / greploop / visual loops |

Many more internal vars exist (eval, migration, learning-decay tuning) - grep `PHANTOM_` across `hooks/` and `reference/` for the full set.

## Install

Install the same canonical directory without modifying it. Project-scoped
examples:

```bash
# Shared Agent Skills discovery convention
mkdir -p .agents/skills
cp -R /path/to/research-phantom-skills/skills/phantom .agents/skills/phantom
```

Common project discovery locations are:

| Host | Project path |
|---|---|
| Claude Code | `.claude/skills/phantom/` |
| Codex | `.agents/skills/phantom/` |
| Gemini CLI | `.agents/skills/phantom/` |

The copied `phantom` directory and every file inside it, including the canonical
`manifest.json`, remain byte-identical. The manifest versions the bundle and
its portable contracts without depending on a host-specific plugin manifest.
Use each host's user-level skills directory instead when you want Phantom in
every project.

Validate the source artifact with `npm run validate:skill`. The repository test
suite also copies it into three disposable discovery layouts, compares recursive
SHA-256 digests, exercises semantic model resolution, and runs the full portable
state lifecycle.

The continuous-integration gate also runs the pinned Agent Skills reference
validator. Authenticated live-model conformance is intentionally kept off
untrusted pull-request runners: run it from an isolated trusted environment with
the same skill bytes, a disposable workspace and home directory, and ephemeral
credentials. The copied skill includes the same validated preset registry used
locally; the runner may supply an optional external override when needed.

### Native compatibility plugin

The native plugin ships both `.codex-plugin/plugin.json` and the legacy-compatible
`.claude-plugin` marketplace. It exposes every public workflow under `skills/`
for Codex while retaining Claude Code command, agent, and hook integrations.

In Codex, open the plugin browser and install Phantom from the repository
marketplace:

```bash
git clone git@github.com:Cloudzero/research-phantom-skills.git
cd research-phantom-skills
codex
# Then, inside Codex:
/plugins
```

Select the repository marketplace, open `phantom`, and choose **Install**. Codex
recognizes the repository's legacy-compatible `.claude-plugin/marketplace.json`
and installs the native `.codex-plugin/plugin.json` bundle from the repository
root.

For Claude Code, install it from the self-hosted marketplace in this repo:

```
/plugin marketplace add Cloudzero/research-phantom-skills
/plugin install phantom@phantom
```

Codex loads the plugin's bundled skills; Claude Code discovers its commands,
agents, and hooks directly. Phantom creates mutable state and per-repository
learnings lazily on first use. No setup command or symlink is required, and
the config file is optional and created lazily on first `set`. Optional
behavior is controlled by environment variables and the optional config file
(see **Configuration** above).

After a new remote version is published, Codex users should pull the marketplace
checkout, open `/plugins`, uninstall and reinstall `phantom`, then start a new
task or CLI session so the new cached version and skills are loaded:

```bash
git pull --ff-only
```

Claude Code users can run `/plugin update phantom`.

Prerequisites: Codex CLI or the Codex desktop app for Codex installation;
Claude Code CLI for Claude installation; and git for either flow. Recommended:
gh CLI and Atlassian MCP. Optional: phantom-ai MCP, Slack MCP, and
code-review-graph MCP.

### Upgrading from a pre-plugin install

If you previously used the retired manual install, remove its exact
`~/.claude/commands/phantom` and `~/.claude/agents/phantom` entries so Claude
Code cannot discover a stale copy alongside the plugin. The old flow may also
have registered these five Phantom hooks in `~/.claude/settings.json`; remove
only those entries because `hooks/hooks.json` now owns them:

- `memory-writer.js`
- `apex-subagent-driven-law.sh`
- `memory-reader.js`
- `memory-consolidator.js`
- `context-compact-guide.sh`

Back up `settings.json` before editing and preserve every non-Phantom hook. If
you need data from an old `~/.claude/team`, `~/.claude/phantom`, or
`~/.claude/phantom-data` directory, the optional `scripts/migrate-data.js`
utility copies its data whitelist into `PHANTOM_DATA` (or `~/.phantom` when
unset) without modifying the source. Pre-existing destination entries always
win; otherwise legacy collisions use `phantom-data`, then `phantom`, then
`team` priority. The migrator reconstructs only a valid portable active-session
pointer whose session and workspace identity still match, and reports rather
than copying stale or unsupported root markers.

## Author

Subash Karki
