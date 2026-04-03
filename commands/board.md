---
name: team:board
description: Start live board server + open browser
---

> Load `_shared.md` + `_shared-board.md` before executing.

# /team:board

Start the Straw Hat Board app (Vite + React + Hono).

**Architecture:** The board is a React app (`~/.claude/team/board-app`) with a Hono API server that reads team state from `~/.claude/team/repos/`.

1. Start the Hono API server (port 3847):
   ```bash
   cd ~/.claude/team/board-app && npx tsx server/index.ts &
   ```
2. Start the Vite dev server (port 3848):
   ```bash
   cd ~/.claude/team/board-app && pnpm dev &
   ```
3. Open `http://localhost:3848`
4. Reply: "Board is live at http://localhost:3848 -- repo: {REPO_NAME}"

**Quick start (both servers):**
```bash
cd ~/.claude/team/board-app && pnpm dev:all
```
