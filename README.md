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
2. **Plans** with Devil's Advocate review — challenges assumptions, catches scope creep
3. **Spawns parallel agents** for implementation (Spark instances with role focus)
4. **Mandatory verification**: Sentinel → Simplify → Code Review → Prism quality gate
5. **Smart PR**: draft PR for backend, branch-only for UI (verify visually first)
6. **Self-learning**: auto-records what worked/failed, improves over sessions

## Works With Any Repo

| Stack | Detected Via | Verify Commands |
|-------|-------------|-----------------|
| Node/pnpm | `pnpm-lock.yaml` | `pnpm check && pnpm build` |
| Node/yarn | `yarn.lock` | `yarn lint && yarn build` |
| Go | `go.mod` | `go vet && go build && go test` |
| Python | `pyproject.toml` | `ruff check && pytest` |
| Rust | `Cargo.toml` | `cargo clippy && cargo build` |
| Terraform | `*.tf` | `terraform fmt && terraform validate` |

**Override**: If your repo has `CLAUDE.md` with verify commands, those take priority.

## Crew

| Agent | Model | Role |
|-------|-------|------|
| Cortex | opus | Orchestrator — plans, decomposes, coordinates |
| Spark | sonnet | Implementation — spawned with role focus directives |
| Sentinel | sonnet | Verification — repo-aware lint/build/test |
| Prism | opus | Quality gate — code review + architecture |
| Oracle | opus | On-demand guidance for stuck agents |
| Devil's Advocate | opus | Adversarial plan reviewer |
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

- **After verification passes**: records what approach worked
- **After fix loops**: records what failed and what fixed it
- **After each session**: validates/promotes/demotes patterns

Learnings are per-user and gitignored — your corrections won't affect teammates.

## Author

Subash Karki
