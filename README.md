# Straw Hat Agents

Multi-agent engineering crew for Claude Code. Pirate-themed AI pair programming with specialized roles, real-time board dashboard, and event-sourced task tracking.

## Structure

```
agents/          # Agent personas — Luffy, Nami, Franky, Zoro, etc.
commands/        # /team:* skill commands — start, execute, fix, verify, wrap
hooks/           # Claude Code hooks — event logger for board
board-app/       # Live dashboard (React + Hono) — Ship's Log
story/           # Captain's Log — anime-style session chronicles
scripts/         # Utility scripts
```

## Quick Start

```bash
# Start the board
cd board-app && pnpm install && pnpm dev:all
# Open http://localhost:3848

# In Claude Code, run:
/team:start "Your task description"
```

## Architecture

- **Event-sourced board** — 50-line append-only hook captures TaskCreate/TaskUpdate as NDJSON. Board materializes sessions on-the-fly. Zero translation, zero sync drift.
- **Agent personas** — Each crew member has a `.md` file defining their role, personality, and owned scope.
- **Skill commands** — `/team:start`, `/team:pause`, `/team:wrap` etc. orchestrate the crew lifecycle.
- **Learnings system** — Domain-based knowledge files (ui.md, data.md, auth.md, etc.) with lazy loading.

## Author

Subash Karki
