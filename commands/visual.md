---
name: team:visual
description: Trigger Lens visual inspection on current task
argument-hint: "[/route1 /route2 ...] [--backend agent-browser|playwright]"
---

> Load `_shared.md` + `_shared-crew.md` before executing.

# /team:visual $ARGUMENTS

Trigger Lens's visual inspection on the current task.

1. Determine target routes:
   - If routes provided as args, use those
   - Otherwise, infer from session state (routes touched by current task)
2. Verify dev server is running at `http://localhost:8080`
3. **Detect browser backend:**
   - If `--backend` flag provided, use that
   - Otherwise: run `which agent-browser` — if found, use `agent-browser`; else fall back to Playwright MCP
   - Log detection: `TaskCreate({ subject: '[Lens] Browser backend: {agent-browser|playwright}' })`
4. **Auth setup** (agent-browser only, if target requires login):
   - Check if `lens-qa` session exists: `agent-browser session list 2>/dev/null | grep lens-qa`
   - If session exists → reuse (daemon persists auth state)
   - If no session → check for auth state file at `sessions/{TICKET}/auth-state.json`
     - If found → `agent-browser state load sessions/{TICKET}/auth-state.json`
     - If not found → warn Cortex that manual login may be needed
5. Spawn **Lens** (model: sonnet) with:
   - Target routes
   - Browser backend to use (`agent-browser` or `playwright`)
   - Session name: `lens-qa` (for agent-browser)
   - Task description (what was supposed to be built)
   - Figma specs (if Lens (design extraction mode) provided them)
   - `run_in_background: true`, `mode: "bypassPermissions"`
6. Lens navigates, screenshots, analyzes, and reports
7. If issues found -> visual fix loop (agent-browser: same daemon session, no re-auth)
8. Update `visualVerification` block in session JSON
