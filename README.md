# Team Skill

Multi-agent engineering crew for Claude Code. Plans, implements, verifies, and ships — any repo, any stack.

## Install (30 seconds)

**Option 1 — One-liner:**
```bash
git clone git@github.com:Cloudzero/research-phantom-skills.git ~/.claude/team && ~/.claude/team/setup.sh
```

**Option 2 — Install script** (handles SSH/HTTPS fallback, existing installs, updates):
```bash
# Save install.sh from the repo, then:
chmod +x install.sh && ./install.sh
```

**Update existing install:**
```bash
cd ~/.claude/team && git pull && ./setup.sh
```

### What setup.sh does

1. Creates symlink `~/.claude/commands/team` → skill commands
2. Initializes per-user directories (sessions, events, learnings)
3. Asks config questions (Jira project, Slack channel, model preference)
4. Auto-detects MCP integrations (Atlassian, phantom-ai, Slack)
5. Installs agent spawn validator hook (keeps context window clean)
6. Writes `config.yaml` with your settings
7. Checks prerequisites (Claude Code CLI, gh CLI)

### Prerequisites

- **Required**: Claude Code CLI, git
- **Recommended**: gh CLI (for PR features), Atlassian MCP (for Jira)
- **Optional**: phantom-ai MCP (graph intelligence), Slack MCP (notifications)

## Usage

```bash
/team:start "CP-41171"              # Jira ticket → plan → implement → verify → PR
/team:start "fix the auth bug"      # Free text → same pipeline
/team:verify                        # Run quality gate on current work
/team:pause                         # Save state, step away
/team:resume                        # Pick up where you left off
/team:wrap                          # Full shutdown with learnings
```

Or just describe what you want — Claude auto-triggers the team skill:
```
"implement CP-41171"    → team:start
"fix this bug"          → team:start
"check if it works"     → team:verify
"I'm done"              → team:wrap
```

## What It Does

1. **Pulls Jira ticket** context automatically (if Atlassian MCP configured)
2. **Plans** with Devil's Advocate adversarial challenge + GOAP precondition/effect modeling (CREW tasks)
3. **Three-tier model routing** — Bypass (no agent) → Haiku (routine) → Sonnet (standard) → Opus (complex)
4. **Auto-CREW trigger** — hard checklist (4+ files, cross-layer, security, schema) replaces narrative judgment
5. **SendMessage pipeline** — Spark → Sentinel → Prism hand off directly, no Cortex polling
6. **Mandatory verification**: Sentinel → Simplify → Code Review → Prism (scored 0-10) + witness marker check
7. **Witness regression markers** — fix code registered in `witness-fixes.json`, verified every build
8. **Scored learnings** — patterns decay (`[v:N q:0.X u:date]`), auto-prune stale, auto-promote validated
9. **Testgaps scan** at wrap — flags source changes without test updates
10. **Smart PR**: draft PR for backend, branch-only for UI (verify visually first)
11. **`claude -p` headless** + `--fork-session` for cheap parallel exploration

## The Pipeline

```
  /team:start "CP-41171"
  ━━━━━━━━━━━━━━━━━━━━━
       │
  Phase A: Context       Jira pull, scored learnings, graph intelligence
       │
  Phase B: Planning      Intent → Auto-CREW checklist → tier classification
       │                 GOAP preconditions (CREW only)
       │                 Devil's Advocate challenge
       │
  Phase C: Contracts     Agent assignments locked
       │
  Phase D: Execution     Tiered dispatch (bypass/haiku/sonnet/opus)
       │                 SendMessage pipeline (Spark→Sentinel→Prism)
       │                 Cortex intent alignment check
       │                 Sentinel verify + witness marker check
       │                 Simplify → Code Review → Prism (0-10)
       │                 Fix loop (max 3, same-class → re-plan)
       │
  Phase E: Wrap          Testgaps scan + scope creep detection
       │                 Scored learnings update (prune/promote)
       │                 Draft PR or branch push + Jira update
       │
  ╭───────────────────╮
  │ SESSION WRAPPED  ✓│
  ╰───────────────────╯
```

## 12 Iron Laws

Non-negotiable constraints Claude cannot rationalize past:

1. **Feature branch** — never commit to main/develop
2. **Verification mandatory** — no "done" without Sentinel evidence
3. **Anti-repetition** — `[failed]` blocks approach, `[validated:5+]` auto-applies
4. **Devil's Advocate** — every plan challenged before execution
5. **Simplify always runs** — after verification, simplify changed files, re-verify if changed
6. **Intent check** — Cortex reviews diff against intent (tests passing ≠ problem solved)
7. **Smart PR** — UI = branch only, no UI = draft PR
8. **Jira auto-transition** — auto-move to "Reviewing" after push
9. **Learnings** — every session reads AND writes to learnings
10. **Auto-CREW trigger** — 4+ files, cross-layer, security, schema → CREW. Checklist, not judgment.
11. **No patchwork fixes** — reproduce → trace → confirm root cause. Same class twice → re-plan.
12. **Parallel agents** — 2+ independent files → parallel. No sequential when parallelizable.

## Works With Any Repo

| Stack | Detected Via | Verify Commands |
|-------|-------------|-----------------|
| Node/pnpm | `pnpm-lock.yaml` | `pnpm check && pnpm build` |
| Node/yarn | `yarn.lock` | `yarn lint && yarn build` |
| Go | `go.mod` | `go vet && go build && go test` |
| Python | `pyproject.toml` | `ruff check && pytest` |
| Rust | `Cargo.toml` | `cargo clippy && cargo build` |
| Terraform | `*.tf` | `terraform fmt && terraform validate` |

If your repo has `CLAUDE.md` with verify commands, those take priority.

## Crew

| Agent | Default Model | Role |
|-------|---------------|------|
| Cortex | opus | Orchestrator — plans, decomposes, coordinates |
| Spark | haiku/sonnet/opus | Implementation — tier-routed by task complexity |
| Sentinel | sonnet | Verification — repo-aware lint/build/test + witness markers |
| Prism | opus | Quality gate — code review (single rubric, scored 0-10) |
| Oracle | opus | On-demand guidance for stuck agents (<100 words) |
| Devil's Advocate | opus | Adversarial plan reviewer |
| Lens | sonnet | Visual — Figma extraction + browser verification (agent-browser preferred, Playwright fallback) |

### Model Routing

| Tier | Model | When |
|------|-------|------|
| Bypass | No agent | Mechanical: rename, import, typo |
| Haiku | haiku | Routine: single-file, docs, config |
| Sonnet | sonnet | Standard: features, multi-file, tests |
| Opus | opus | Complex: architecture, quality gates |

Say "use opus" or "use sonnet" at session start to override all tiers. All models are 4.6 only — 4.7 is too slow.

## Optional Integrations

| Integration | What It Adds | How to Get |
|-------------|-------------|------------|
| Atlassian MCP | Jira ticket auto-pull + status transitions | `claude mcp add atlassian` |
| phantom-ai MCP | Blast radius, strategy selection, learning loop | Install Phantom OS |
| Slack MCP | Notifications on completion | `claude mcp add slack` |
| code-review-graph | Structural impact analysis | `setup.sh` detects |
| agent-browser | Fast visual verification (replaces Playwright for Lens) | `npm i -g agent-browser` |

All optional — skill works fine without any of them.

## Configuration

After `setup.sh`, edit `~/.claude/team/config.yaml`:

```yaml
jira:
  project: CP              # Your Jira project key
models:
  spark: sonnet            # or haiku for speed
preferences:
  auto_draft_pr: true      # Draft PR for non-UI work
```

See `config.yaml.example` for all options.

## How It Learns

The skill gets better over time — automatically, no manual action needed:

- **User corrections** (immediate): highest signal, recorded inline when user corrects approach
- **After verification**: records what approach worked with `[proposed]` tag
- **Fix loop failures**: records what failed and what fixed it as `[failed]` corrections
- **After wrap**: validates/promotes patterns (`[validated:5+]` auto-promoted to global)

Anti-repetition scans learnings before every task — `[failed]` patterns block, `[validated:5+]` auto-apply.

Learnings are per-user and gitignored — your corrections won't affect teammates.

## Author

Subash Karki
