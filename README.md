# PHANTOM — Your Shadow Army of AI Agents

**Author: Subash Karki**

> Inspired by Solo Leveling: you're the Monarch, your AI agents are the shadow army.
> Say `/phantom:recruit` — "Arise!" — and they answer.

## What It Does

Every task is a Gate. Phantom reads the difficulty, assembles the right shadows, and clears it. After every run, the system gains EXP — learning what works, remembering what doesn't.

Trivial tasks skip planning entirely. Ambiguous tasks brainstorm first. Complex tasks get full dependency wiring. Shadows deliberate among themselves; humans approve consensus or break ties.

Zero external plugin dependencies. Fully self-contained.

## Install

Native plugin install (preferred), in Claude Code:

```bash
/plugin marketplace add Cloudzero/research-phantom-skills
/plugin install phantom@phantom
```

Fallback (legacy symlink install) from a shell:

```bash
bash <(curl -sSL https://raw.githubusercontent.com/Cloudzero/research-phantom-skills/main/install.sh) --legacy
```

Set `PHANTOM_INSTALL_DIR` to override the install location for `install.sh --legacy` (default `~/.claude/phantom`).

## Quick Start

```bash
/phantom:start CP-41606                    # router classifies → plan → execute → verify → ship
/phantom:start "the dashboard feels slow"  # ambiguous → brainstorm → plan → execute → verify
/phantom:verify                            # power level (P0/P1 fix, P2/P3 drop)
/phantom:wrap                              # commit, push, PR, Jira transition
/phantom:pause → /clear → /phantom:resume     # context management
```

## Architecture — Adaptive Cognitive Router

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

**Adaptive Routing** — AI reads the task and picks the route. Signals: scope clarity, file count, uncertainty level, risk, learnings history. See `reference/router.md`.

**Deliberative Planning** — Planner produces plan, Challenger (Rival) reviews it. If consensus → human gets a quick OK. If disagreement → human breaks the tie. Max 2 rounds.

**Brainstorm Mode** — Diverge/converge for ambiguous scope. Proposes 2-3 approaches with tradeoffs. Asks only what it can't infer from codebase context. See `reference/brainstorm.md`.

**Wiring Mode** — Novel: explicit dependency topology between plan tasks. Maps producers/consumers, assigns parallel execution waves, flags integration risk points. No other system does this. See `reference/wiring.md`.

**Core Disciplines** — 13 rules, each with a WHY explaining the failure mode it prevents. Enforced structurally via hooks and artifact schemas, not prompt ceremony.

**Power Level** — P0 (critical) + P1 (high) auto-fix. P2 (medium) + P3 (low) dropped.

**Anti-Repetition** — Scans learnings before every approach. `[failed]` entries are blocked. `[validated:5+]` entries auto-apply.

**Self-Evolution** — Tier 1: reference auto-promote. Tier 2: skill edits (user approval). Tier 3: skill spawning (user approval).

## Folder Structure

Repo root (the plugin install root). Skills/agents self-resolve it env-free (deterministic) — `PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"; [ -z "$PR" ] && { echo "phantom: plugin dir not found under ~/.claude/plugins/cache/phantom — run /plugin to install"; exit 0; }` (the empty-guard makes a fresh machine / dev clone fail readable instead of crashing on `node "/scripts/..."`) — never via `CLAUDE_PLUGIN_ROOT` (that env var is used ONLY inside `hooks/hooks.json`, where Claude Code substitutes it at hook-exec):

```
{PLUGIN_ROOT}/           # plugin root (self-resolved as above)
├── .claude-plugin/    # Plugin manifest + self-hosted marketplace
│   ├── plugin.json        # Native Claude Code plugin manifest
│   └── marketplace.json   # Marketplace entry (install source)
├── commands/          # 21 skill directives (30-150 lines each)
├── reference/         # reference files (on-demand, injected by hooks)
│   ├── router.md          # Classification algorithm, deliberation protocol
│   ├── brainstorm.md      # Diverge/converge protocol, question-asking rules
│   ├── wiring.md          # Dependency topology, wave assignments
│   ├── planning.md        # Machine-checkable criteria, anti-placeholder rules
│   ├── hound-protocol.md  # 7-step investigation with HTML reports
│   ├── _base-agent.md     # Template for spawning new agent types
│   └── ...
├── agents/            # 11 agent personas
├── bin/               # thin executable entry shims; logic lives in scripts/ (e.g., bin/phantom-preflight → scripts/preflight.js)
├── scripts/           # deterministic helpers (no LLM needed)
│   ├── validate-artifact.js   # JSON schema validation
│   ├── check-learnings-index.js
│   ├── session-health.sh
│   ├── preamble-tier.js
│   └── timing-report.js       # per-model agent timing (wall-clock by model)
├── evals/             # 30 test cases for skill triggering verification
├── hooks/             # Structural enforcement
│   ├── hooks.json         # Plugin-owned hook registrations
│   └── timing-capture.js  # records agent spawn/stop + model (PreToolUse Agent + SubagentStop)
├── templates/         # Reusable contract templates
├── install.sh         # Legacy / manual install helper
└── setup.sh           # State + config initializer (run via /phantom:setup)
```

Mutable state lives outside the plugin root, under `${PHANTOM_DATA:-~/.claude/phantom-data}`:

```
${PHANTOM_DATA:-~/.claude/phantom-data}/
├── state/             # Global (non-ticket) state: evolution-log, hook-session snapshots
├── learnings/         # Scored knowledge with decay
├── global/            # Cross-repo patterns
└── repos/             # Per-repo state
    └── {REPO_NAME}/
        ├── sessions/      # Per-ticket JSON artifacts (source of truth) — sessions/{TICKET}/
        └── learnings/     # Per-repo scored knowledge
```

## Shadows

| Agent | Model | Effort | Role |
|-------|-------|--------|------|
| Apex | inherits session model | high | Orchestrator — plans, decomposes, coordinates, runs router, routes models |
| Blade | inherits session model · sonnet (small tasks) | high | Implementation — parallel execution with ROLE FOCUS directives |
| Ward | sonnet | high | QA — lint, build, test verification |
| Gaze | opus (pinned — review tier) | high | Quality gate — power level (scored, P0-P3) |
| Sage | fable (pinned — top tier; override via config `models.sage`) | high | Advisory — guidance for stuck agents (<100 words) |
| Lens | sonnet | high | Visual verification — screenshot + diff |
| Archer | opus (pinned — review tier) | high | Cross-file review — pre-PR structural analysis |
| Rival | inherits session model | high | Plan challenger — adversarial review (no tools, forced precision) |
| Hound | inherits session model | high | Forensic investigator — 7-step protocol, HTML reports |
| Sweep | sonnet | high | Code clarity — simplify changed files post-verify |
| Base Agent | — | — | Template for spawning new agent types |

No agent pins a model except three deliberate exceptions: **Gaze** and **Archer** pin `opus` (review tier — independent benchmarks show no review-precision gain from Fable 5 at 2x cost), and **Sage** pins `fable` (top-tier advisory, reachable even from a downshifted Blade; the pin is the default; no Fable 5 entitlement? Set `models.sage: opus` in `${PHANTOM_DATA:-~/.claude/phantom-data}/config.yaml` — spawners pass it as a model override). Everyone else — including Apex — leaves model unset and inherits the session model (Fable 5 recommended). Apex tunes per spawn only to downshift (Sonnet for small, well-scoped subtasks), and **effort is uniform `high`**, inherited from the session — there is no per-spawn effort param. `haiku` is reserved for truly mechanical single-file edits. Use bare aliases only; never pin dated or prior-generation model IDs.

## Models & Effort

Phantom runs every agent at **`high`** effort. Agents leave model + effort unset, so they inherit the session effort (`high`) and the session model — run your session on **Fable 5** (`/model fable`) for best results. **Model is the per-task lever, not effort** — there is no per-spawn effort param. Apex follows the session model and drops to **Sonnet** only for small, single-concern subtasks with a tight contract ("good tasking earns Sonnet"). `haiku` stays reserved for trivial mechanical single-file edits. Gaze/Archer (opus, review tier) and Sage (fable) carry frontmatter pins. See `reference/agents.md` → Model Routing.

**Run at `/effort high`, not `ultracode`.** Ultracode lets the runtime wrap a phase in a background workflow that takes no mid-run input, which can silently bypass Phantom's approval gates. Use `high` for all gated phantom work.

Fable 5 (`claude-fable-5`, the recommended session model) is a step change on long-horizon agentic work — stronger instruction-following, built-in self-verification, and fewer steers — reinforcing the subagent-driven law. Note it is usage-credit-gated; sessions without entitlement run cleanly on Opus 4.8 since no agent except Sage hard-pins the new tier (and Sage's pin is config-overridable via `models.sage`).

## Commands

| Command | Route | Description |
|---------|-------|-------------|
| `/phantom:start` | Entry | Adaptive router → classify → execute appropriate route |
| `/phantom:verify` | — | Power Level with auto-fix for P0/P1 |
| `/phantom:wrap` | — | Commit, push, PR, Jira transition |
| `/phantom:fix` | — | Triage failures, assign scoped repairs (loop ceiling owned by `hooks/loop-controller.js`) |
| `/phantom:pause` | — | Save session state for context management |
| `/phantom:resume` | — | Restore session from saved state |
| `/phantom:hound` | — | Forensic investigation with HTML report |
| `/phantom:review` | — | Trigger Gaze quality gate |
| `/phantom:visual` | — | Trigger Lens visual inspection |
| `/phantom:scout` | — | Background research agents |
| `/phantom:recruit` | — | Spawn specialist agent (role focus) |
| `/phantom:grill` | — | Quiz yourself on the diff before shipping |
| `/phantom:contract` | — | Create contract (feature/api/testing/ui/fix) |
| `/phantom:execute` | — | Execute a saved plan |
| `/phantom:learn` | — | Capture a learning mid-session |
| `/phantom:evolve` | — | Scan learnings, propose promotions |
| `/phantom:health` | — | Diagnose knowledge layer |
| `/phantom:eval` | — | Evaluate shadows performance |
| `/phantom:validate` | — | Validate plan/output/session |
| `/phantom:sessions` | — | List all sessions with status |
| `/phantom:status` | — | Current task board |

## Independence

**Zero external plugin dependencies.** Previously depended on superpowers (14 skills), feature-dev, and code-sweep plugins. All have been:
- Superpowers: disabled, all 6 references replaced with own implementations
- Feature-dev: disabled, reference removed from gaze.md
- Code-sweep: absorbed into `agents/sweep.md` (plugin still enabled as backup, can be disabled)

## Install

Phantom is a **native Claude Code plugin**. Install it from the self-hosted marketplace in this repo — no symlinks, no `settings.json` juggling.

```
/plugin marketplace add Cloudzero/research-phantom-skills
/plugin install phantom@phantom
/phantom:setup        # one-time: inits PHANTOM_DATA dirs, learnings INDEX, config.yaml
```

The plugin install drops commands, agents, and hooks into place automatically (the manifest is `.claude-plugin/plugin.json`; hooks are registered by `hooks/hooks.json`). `/phantom:setup` then (re)initializes the `PHANTOM_DATA` dirs, the learnings `INDEX.md`, and `config.yaml` — it is safe to re-run. Update later with `/plugin update phantom`.

Prerequisites: Claude Code CLI, git. Recommended: gh CLI, Atlassian MCP. Optional: phantom-ai MCP, Slack MCP, code-review-graph MCP.

### Legacy / manual install (for development)

The original git-clone + symlink flow still works and is handy when developing Phantom itself, but the plugin install above is preferred for normal use.

```bash
git clone git@github.com:Cloudzero/research-phantom-skills.git ~/.claude/phantom
~/.claude/phantom/setup.sh
```

> **Note:** `/phantom:setup` finds `setup.sh` by self-locating from the running script (`BASH_SOURCE`) or self-resolving the install in `~/.claude/plugins/cache/phantom/phantom/*/`. A bare-terminal copy-paste with neither present will not find `setup.sh` and exits with a helpful error.

**Previously used the legacy symlink install?** That flow registered 5 Phantom hooks in `~/.claude/settings.json` with absolute paths. The plugin's `hooks/hooks.json` now owns those same hooks, so to avoid double-firing, those legacy entries must be removed:

- `memory-writer.js`
- `apex-subagent-driven-law.sh`
- `memory-reader.js`
- `memory-consolidator.js`
- `context-compact-guide.sh`

When you run `/phantom:setup` from a **plugin** install (`setup.sh` running outside `~/.claude/phantom`), it backs up `~/.claude/settings.json` and removes those legacy entries automatically — and preserves all non-phantom hook entries. Run from the legacy symlink install, it leaves them in place (they are that install's own registration). Requires `jq`; if `jq` is missing it skips and warns, and you can remove them manually.

## Author

Subash Karki
