---
name: phantom:visual
description: "Use when you want to visually verify UI changes, check how the app looks in a browser, screenshot components, or compare against a design. Spawns Lens agent for browser-based visual inspection with optional autonomous fix mode. Also use when user says 'does it look right', 'screenshot this', 'visual check', 'compare to Figma', or 'check the UI'."
argument-hint: "[/route1 /route2 ...] [--backend agent-browser|playwright] [--autonomous] [--no-fix]"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
---

> **Preamble Tier: T3** — loads '_shared.md' + '_shared-shadows.md' + '_shared-discipline.md' + '_shared-contracts.md'

# /phantom:visual $ARGUMENTS

Visual verification pipeline — standalone or auto-triggered by `/phantom:verify` for UI tasks.

## Modes

- **Standalone**: interactive, shows results, asks before fixing
- **Autonomous** (`--autonomous`): fix loop without user approval, max 3 iterations
- **Inspect only** (`--no-fix`): screenshot and report, no fix loop

## Execution

1. **Determine target routes:** args > session `affectedRoutes` > infer from changed files > ask user (standalone) or skip (autonomous)

2. **Verify dev server:** Check localhost port. If not running: warn (standalone) or attempt `pnpm dev &` + 10s wait (autonomous).

3. **Detect browser backend:** `--backend` flag > `which agent-browser` > Playwright MCP fallback.

4. **Auth handling:** Automatic — Lens detects login walls and handles credentials per `reference/smart-auth.md` (credential sources, redirect-aware detection, MFA escalation). Session cookies persist across routes.

5. **Spawn Lens** (`subagent_type: "lens"`, mode: bypassPermissions): target routes + backend + `lens-qa` session + expected behavior from contract/intent. (effort = session `high`; model per `reference/agents.md` → Model Routing)

6. **State Matrix:** Before inspection, identify all parent states the changed component reacts to. Lens cycles through every parent state x feature state combination and screenshots each.

7. **Lens inspects:** navigate → snapshot → screenshot (3 viewports) → analyze → interact.

8. **Handle results:**
   - **PASS** → update `visualVerification` in session JSON, return pass signal
   - **ISSUES FOUND** → standalone: show + ask; autonomous: enter fix loop immediately

## Visual Fix Loop (max 3 iterations)

1. Lens outputs structured fix packet (issue, screenshot, element ref, expected vs actual, affected file)
2. Activate blade marker: `touch ${PHANTOM_DATA:-~/.claude/phantom-data}/.blade-editing`
3. Apex dispatches Blade (`subagent_type: "blade"`, mode: bypassPermissions; UI focus) scoped to affected files — appearance only, not behavior
4. Deactivate blade marker: `rm -f ${PHANTOM_DATA:-~/.claude/phantom-data}/.blade-editing`
5. Re-run correctness on fixed files. If fails → revert, mark "needs manual fix"
4. Re-spawn Lens on same routes
5. All resolved → PASS. Same issue persists → correction + escalate. New issues → revert + escalate.
6. After 3 loops → escalate with screenshot history, update session: `{ status: "partial" }`
