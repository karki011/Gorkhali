---
name: team:visual
description: Trigger Lens visual inspection on current task
argument-hint: "[/route1 /route2 ...] [--backend agent-browser|playwright] [--autonomous] [--no-fix]"
---

> **Preamble Tier: T3** — loads '_shared.md' + '_shared-crew.md' + '_shared-superpowers.md' + '_shared-contracts.md'

# /team:visual $ARGUMENTS

Visual verification pipeline — runs standalone or auto-triggered by `/team:verify` for UI tasks.

## Modes

- **Standalone** (user runs `/team:visual`): interactive, shows results, asks before fixing
- **Autonomous** (`--autonomous` flag, set by verify/start): runs fix loop without user approval, max 3 iterations
- **Inspect only** (`--no-fix`): screenshot and report, no fix loop

## Execution

1. **Determine target routes:**
   - If routes provided as args → use those
   - If session state has `affectedRoutes` → use those
   - Infer from changed files: `pages/Foo.tsx` → `/foo`, `components/Settings/*` → `/settings`
   - If no routes determinable → ask user (standalone) or skip with warning (autonomous)

2. **Verify dev server:**
   - Check `localhost:8080` (or port from repo CLAUDE.md / package.json `dev` script)
   - If not running:
     - Standalone → warn user: "Start dev server first"
     - Autonomous → attempt `pnpm dev &` in background, wait 10s, retry. If still down → skip visual verification with warning

3. **Detect browser backend:**
   - If `--backend` flag provided → use that
   - Run `which agent-browser` — if found → use `agent-browser`; else → Playwright MCP
   - Log: `TaskCreate({ subject: '[Lens] Browser backend: {agent-browser|playwright}' })`

4. **Auth handling** (automatic — Lens handles this internally):
   - Lens navigates to each route, snapshots the page, and detects login walls
   - If login form found → Lens enters credentials and submits automatically
   - Credential sources (checked in order):
     a. `sessions/{TICKET}/auth-creds.json` — `{ "username": "...", "password": "..." }`
     b. Environment variables: `TEST_USERNAME` + `TEST_PASSWORD`
     c. `.env.test` or `.env.local` — keys like `USERNAME`, `EMAIL`, `PASSWORD`, `TEST_USER`
     d. Ask user once → save to `sessions/{TICKET}/auth-creds.json` for session reuse
   - agent-browser `lens-qa` session persists cookies — login happens once, all subsequent routes reuse it
   - MFA/OAuth prompts escalate to user (Lens won't loop on auth)

5. **Spawn Lens** (model: sonnet):
   - Target routes + browser backend + session name `lens-qa`
   - Task description (what was built, from contract/intent)
   - Expected behavior (from contract's acceptance criteria or Done When predicates)
   - `run_in_background: true`, `mode: "bypassPermissions"`

6. **Lens inspects:** navigate → snapshot → screenshot (3 viewports) → analyze → interact

7. **Handle results:**

   ### VISUAL PASS
   - Update `visualVerification` in session JSON: `{ status: "pass", routes: [...], backend: "...", timestamp: "..." }`
   - If standalone → show results table to user
   - If autonomous → return pass signal to verify pipeline

   ### VISUAL ISSUES FOUND

   **Standalone mode:**
   - Show issues table with screenshot evidence
   - Ask user: "Fix these visual issues? (y/n)"
   - If yes → enter fix loop
   - If no → record issues in session JSON, proceed

   **Autonomous mode:**
   - Enter fix loop immediately (no approval needed)

   ### Visual Fix Loop

   ```
   for iteration in 1..3:
     a. Lens outputs structured fix packet:
        - Issue description (specific: "Button #save is 12px from edge, should be 16px")
        - Screenshot evidence (before)
        - Element ref (@eN from accessibility tree)
        - Expected vs actual
        - Affected file (inferred from component tree)

     b. Cortex auto-dispatches Spark (UI Engineering focus):
        - Scoped to affected files only
        - Fix packet as input (NOT the full Lens report)
        - "Fix this visual issue. Do not change behavior, only appearance."

     c. Re-run Sentinel on fixed files (code must still pass)
        - If Sentinel fails → revert visual fix, mark issue as "needs manual fix"

     d. Re-spawn Lens on same routes:
        - agent-browser: same `lens-qa` session (no re-auth)
        - Playwright: fresh navigation

     e. If all issues resolved → VISUAL PASS → exit loop
     f. If same issue class persists → write correction, escalate to user
     g. If NEW issues introduced → revert, escalate

   after 3 loops:
     - Escalate to user with full screenshot history
     - Update session JSON: { status: "partial", fixed: [...], remaining: [...] }
   ```

8. **Update session state:**
   ```json
   {
     "visualVerification": {
       "status": "pass|fail|partial|skipped",
       "backend": "agent-browser|playwright",
       "routes": ["/route1", "/route2"],
       "issues": [],
       "fixLoops": 0,
       "timestamp": "ISO8601"
     }
   }
   ```
