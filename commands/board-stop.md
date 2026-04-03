---
name: team:board-stop
description: Stop the live board server
---

> Load `_shared.md` (core only -- no additional tiers needed).

# /team:board-stop

1. Kill Hono API: `lsof -ti:3847 | xargs kill 2>/dev/null`
2. Kill Vite dev: `lsof -ti:3848 | xargs kill 2>/dev/null`
3. Reply: "Board servers stopped."
