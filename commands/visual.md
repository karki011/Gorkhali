---
name: team:visual
description: Trigger Lens visual inspection on current task
argument-hint: "[/route1 /route2 ...]"
---

> Load `_shared.md` + `_shared-crew.md` before executing.

# /team:visual $ARGUMENTS

Trigger Lens's visual inspection on the current task.

1. Determine target routes:
   - If routes provided as args, use those
   - Otherwise, infer from session state (routes touched by current task)
2. Verify dev server is running at `http://localhost:8080`
3. Spawn **Lens** (model: sonnet) with:
   - Target routes
   - Task description (what was supposed to be built)
   - Figma specs (if Lens (design extraction mode) provided them)
   - `run_in_background: true`, `mode: "bypassPermissions"`
4. Lens navigates, screenshots, analyzes, and reports
5. If issues found -> visual fix loop (see handbook -> Visual Verify -> Fix Loop)
6. Update `visualVerification` block in session JSON
