# Phantom Works

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
2. **Plans** with self-scoring reflexion loop → Devil's Advocate challenge
3. **Spawns parallel agents** with self-review — each Spark critiques its own code before handoff
4. **Intent alignment checkpoints** — catches drift during multi-agent execution
5. **Mandatory verification**: Sentinel → Simplify → Code Review → Prism (scored 0-10)
6. **Quality gate loop**: Prism findings → Spark fixes → re-verify → re-score (max 2 iterations)
7. **Smart PR**: draft PR for backend, branch-only for UI (verify visually first)
8. **Self-learning**: auto-records what worked/failed, improves over sessions
9. **Always on feature branch** — never commits to main/develop

## The Pipeline

```
  ⚡ PHANTOM WORKS ⚡           /team:start "CP-41171"
  ━━━━━━━━━━━━━━━━━
       │
  Phase A: Context Loading      Jira pull, learnings, phantom graph
       │
  Phase B: Planning             Intent → plan
       │                        🔄 Plan Reflexion (score → improve → rescore)
       │                        😈 Devil's Advocate challenge
       │
  Phase C: Contracts            Agent assignments locked
       │
  Phase D: Execution            Parallel Sparks
       │                        🔄 Spark Self-Review (diff → critique → fix)
       │                        🔄 Intent Alignment Checkpoint
       │                        Sentinel → Simplify → Code Review
       │                        Prism quality gate (scored 0-10)
       │                        🔄 Quality Gate Loop (fix → re-verify → rescore)
       │
  Phase E: Completion           Draft PR or branch push + Jira update
       │
  ╭───────────────────╮
  │ MISSION COMPLETE ✓│         Auto-learning records what worked
  ╰───────────────────╯
```

## 10 Iron Laws

The skill enforces 10 non-negotiable rules that Claude cannot rationalize past:

1. **Feature branch** — never commit to main/develop
2. **Verification is mandatory** — no "done" without evidence
3. **No patchwork fixes** — root cause first, one variable at a time
4. **Parallel agents for 2+ files** — don't edit sequentially
5. **Background agents always** — keep context window clean
6. **Read repo rules first** — CLAUDE.md before any code
7. **Smart PR** — UI = branch, no UI = draft PR
8. **Anti-repetition** — check learnings before proposing approach
9. **Auto-learning writes** — every session reads AND writes
10. **Devil's Advocate on ALL plans** — no unchallenged plans

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

| Agent | Model | Role |
|-------|-------|------|
| Cortex | opus | Orchestrator — plans, decomposes, coordinates |
| Spark | sonnet | Implementation — spawned with role focus directives |
| Sentinel | sonnet | Verification — repo-aware lint/build/test |
| Prism | opus | Quality gate — code review + architecture |
| Oracle | opus | On-demand guidance for stuck agents |
| Devil's Advocate | opus | Adversarial plan reviewer — 5 challenge categories |
| Lens | sonnet | Visual — Figma extraction + Playwright |

## Optional Integrations

| Integration | What It Adds | How to Get |
|-------------|-------------|------------|
| Atlassian MCP | Jira ticket auto-pull + status transitions | `claude mcp add atlassian` |
| phantom-ai MCP | Blast radius, strategy selection, learning loop | Install Phantom OS |
| Slack MCP | Notifications on completion | `claude mcp add slack` |
| Greptile | Automated code review loop | Enable in config.yaml |

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

- **Trigger 1** (after verification pass): records what approach worked
- **Trigger 2** (after fix loop): records what failed and what fixed it
- **Trigger 3** (after wrap): validates/promotes/demotes patterns across sessions

Learnings are per-user and gitignored — your corrections won't affect teammates.

## Agentic RAG Improvements (Wave 1-3)

Inspired by the Classic → Graph → Agentic RAG evolution, Boris Cherny's CLAUDE.md workflow patterns, and the 5-layer Agent Development Kit architecture.

### Wave 1 — Learning System Upgrade
- **Trigger 0 (User Corrections):** Captures user corrections immediately as the highest-signal feedback. No waiting for verification gates — corrections are recorded inline and applied instantly.
- **Weighted Pattern Retrieval:** Anti-repetition now weights patterns by validation count: `[validated:5+]` auto-applies, `[failed]` blocks, `[proposed]` mentions only.
- **Re-plan on Repeated Failure:** Fix loop detects same failure class repeated twice and escalates to full re-plan instead of stacking patches.

### Wave 2 — Self-Evaluation & Elegance
- **Self-Evaluation Gate:** After tests pass, Cortex reviews the diff against contract intent (ALIGNED/DRIFT/WRONG). Catches "tests pass but wrong solution."
- **Elegance Pause:** Before quality review, checks for unnecessary complexity — single-consumer abstractions, pass-through wrappers, deletable code.
- **Diff-Against-Main:** Scope creep detection before PR creation. Flags files changed outside contract scope.
- **Iron Laws #12-13:** Self-evaluation and elegance checks as mandatory constraints.

### Wave 3 — Multi-Source Intelligence
- **MCP Discovery:** Phase A probes available MCP servers (phantom-ai, code-review-graph, context-mode, claude-flow, atlassian) and sets capability flags for downstream phases.
- **Semantic Anti-Repetition:** 3-layer retrieval — keyword match (always), phantom semantic match (if available), AgentDB vector search (if available). Graceful degradation to keyword-only.
- **Memory Layer Sync:** Validated patterns and corrections written to Claude's auto-memory during wrap, persisting across sessions without full team skill load.
- **Smart Learnings Loading:** Domain-based conditional loading instead of loading all learnings files every session.
- **Cross-MCP Execution:** code-review-graph for structural impact analysis, context-mode for context window protection, claude-flow for cross-session memory.

### MCP Integrations

| MCP Server | Feature | Detected by |
|---|---|---|
| phantom-ai | Graph intelligence, blast radius, strategy routing | `setup.sh` |
| code-review-graph | Structural code analysis, impact radius, affected flows | `setup.sh` |
| context-mode | Context window protection, large output indexing | `setup.sh` |
| claude-flow | Cross-session memory, vector search, coordination | `setup.sh` |
| atlassian | Jira ticket context, auto-transition | `setup.sh` |
| slack | Notifications, standup generation | `setup.sh` |

Run `setup.sh` after pulling to detect newly available MCP servers.

## Author

Subash Karki
