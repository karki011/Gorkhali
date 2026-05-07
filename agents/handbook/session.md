# Handbook: Session Management

## /team:pause — Smart Pause with Context Clear

When the user runs `/team:pause`:
1. `TaskCreate({ subject: "[Cortex] SESSION:pause" })` — the board-sync hook pauses the session
2. Write brief checkpoint notes to session file in `sessions/{TICKET}/`
3. After saving, run `/clear` to free Claude's context window
4. All state is persisted in team files — `/team:resume` restores everything

## Session Commands

- `/team:pause` → Smart save: SESSION:pause task → write checkpoint → clear context
- `/team:wrap` → Full shutdown + archive
- `/team:status` → Task board from `state/sessions/{TICKET}.json`
- `/team:sessions` → List ticket folders in `sessions/`
- `/team:learn "<correction>"` → Categorize by domain, append to `learnings/{domain}.md`
- `/team:board` → Start board app at http://localhost:3848
- `/team:history` → Show archive of completed work from `archive/index.md`

## /team:wrap — Full Shutdown + Archive

When the user runs `/team:wrap`, execute these steps in order:

### 1. Capture Knowledge
- Write final session file to `sessions/{TICKET}/`
- Update `decisions/index.md` with any new decisions
- Update relevant `learnings/{domain}.md` files
- Update `learnings/INDEX.md` with one-liners for new entries
- Update auto-memory

### 2. Archive Completed State
- `TaskCreate({ subject: "[Cortex] SESSION:wrap" })` — hook handles archival

### 3. Update Archive Index
- Append a row to `archive/index.md`

### 4. Clean Up
- The board-sync hook handles session cleanup and archival automatically

## Directory Structure

```
~/.claude/team/repos/{REPO_NAME}/
├── state/
│   ├── current.json              # Pointer: { "activeTicket": "CP-XXXXX" }
│   ├── sessions/                 # One JSON per active session
│   └── completed/                # Archived completed sessions
├── archive/
│   └── index.md                  # Quick-scan table of all completed work
├── decisions/
│   ├── index.md                  # Quick-scan decision table
│   └── adr/                      # Full records for complex decisions
├── sessions/
│   └── {TICKET}/                 # One folder per ticket, dated session files
├── learnings/
│   ├── INDEX.md                  # Always loaded — one-liner quick reference
│   └── ui.md, data.md, auth.md, testing.md, crew.md, migration.md, tooling.md
└── board-app/                    # Vite + React + Hono board app
```

## Project Learnings

Before starting work, check if this project has team learnings:
- `~/.claude/team/repos/{REPO_NAME}/learnings/INDEX.md` — quick reference (always read)
- `~/.claude/team/repos/{REPO_NAME}/learnings/{domain}.md` — domain-specific learnings
- Domains: `ui.md`, `data.md`, `auth.md`, `testing.md`, `crew.md`, `migration.md`, `tooling.md`

### Obsidian Vault (User's Second Brain)

The user maintains an Obsidian vault at `/Users/subash.karki/Documents/sk/`. The `Crew Team/` folder is a symlink to `~/.claude/team/repos/` — do NOT write to it separately.
Agents can search the vault for cross-project context — skip `.obsidian/` and `Crew Team/` dirs.
