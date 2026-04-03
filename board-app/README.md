# Straw Hat Board

**Author: Subash Karki**

Live dashboard for the Straw Hat Engineering Crew. Shows task progress, crew status, and session state in real-time as agents work.

---

## Quick Start

```bash
# Install dependencies
cd ~/.claude/team/board-app && pnpm install

# Start the API server + dev UI
pnpm dev
# Board: http://localhost:5173   API: http://localhost:3847
```

---

## Architecture

```
~/.claude/team/
├── board-app/
│   ├── server/index.ts       # Hono API server (port 3847)
│   ├── src/
│   │   ├── App.tsx            # Shell: header, tabs, theme, dropdowns
│   │   ├── components/        # VoyageMap, FlowSimulator, CrewRoster, etc.
│   │   ├── hooks/useApi.ts    # Fetch + SSE real-time hooks
│   │   └── types.ts           # SessionState, Phase, Task, CrewEntry
│   └── vite.config.ts         # Proxies /api/* and /events to :3847
├── repos/
│   └── {repo}/
│       └── state/
│           ├── current.json           # { "activeTicket": "CP-XXXXX" }
│           └── sessions/
│               └── CP-XXXXX.json      # Full session state (phases, tasks, crew)
└── .task-board-mapping.json           # TaskCreate ID-to-subject mapping (auto-managed)
```

### Data Flow

```
Luffy creates tasks (TaskCreate)
        │
        ▼
┌──────────────────────────┐
│  board-sync.js hook      │  PostToolUse: TaskCreate|TaskUpdate
│  (auto-runs on every     │
│   TaskCreate/TaskUpdate)  │
└───────────┬──────────────┘
            │  Writes to session JSON
            ▼
~/.claude/team/repos/{repo}/state/sessions/CP-XXXXX.json
            │
            │  Server polls every 3s
            ▼
┌──────────────────────────┐
│  Hono API Server (:3847) │  Detects JSON change → broadcasts SSE
└───────────┬──────────────┘
            │  SSE event: "state"
            ▼
┌──────────────────────────┐
│  Board UI (:5173)        │  useSessionState() receives SSE → re-renders
└──────────────────────────┘
```

---

## Auto-Sync Hook (board-sync.js)

The board stays in sync with crew work automatically via a Claude Code **PostToolUse hook**.

### Location

```
~/.claude/hooks/board-sync.js
```

### How It Works

| Event | What Happens |
|-------|-------------|
| **TaskCreate** | Stores `task_id -> subject` mapping in `.task-board-mapping.json`. Subject uses `[CrewName] task description` convention. |
| **TaskUpdate** | Looks up task_id in mapping to get subject. Parses `[CrewName]` prefix. Finds matching task in session JSON by name + assignee. Updates task status. |

### What Gets Updated

When a crew agent calls `TaskUpdate(status: "in_progress")` or `TaskUpdate(status: "completed")`:

1. **Task status** -- The matching task in the session JSON moves to `in_progress`, `complete`, or `skipped`
2. **Phase status** -- Auto-rolls up: if all tasks in a phase are done, phase becomes `complete`; if any are active, phase becomes `in_progress`
3. **Crew member status** -- The assignee's crew entry flips to `active` (in_progress) or `standby` (complete, if no other active tasks)
4. **currentPhase** -- Pointer advances to the latest in-progress phase
5. **updatedAt** -- Timestamp refreshes so the server's poll detects the change

### Status Mapping

| Claude Code Status | Board Status |
|-------------------|-------------|
| `in_progress` | `in_progress` |
| `completed` | `complete` |
| `cancelled` | `skipped` |
| `pending` | `pending` |

### Task Subject Convention

Tasks **must** use the `[CrewName]` prefix for the hook to match them:

```
[Nami] Add button UI          → assignee: Nami, task: "Add button UI"
[Franky] Wire form state       → assignee: Franky, task: "Wire form state"
[Chopper] Run lint + build     → assignee: Chopper, task: "Run lint + build"
```

This convention is enforced by the `/team` skill when Luffy creates tasks.

### Hook Configuration

In `~/.claude/settings.json` under `hooks.PostToolUse`:

```json
{
  "matcher": "TaskCreate|TaskUpdate",
  "hooks": [
    {
      "type": "command",
      "command": "node /Users/subash.karki/.claude/hooks/board-sync.js",
      "timeout": 5
    }
  ]
}
```

### Mapping File

`~/.claude/team/.task-board-mapping.json` stores the task_id-to-subject mapping:

```json
{
  "abc-123": {
    "subject": "[Nami] Add button UI",
    "repo": "feature-web-apps",
    "ts": "2026-03-29T16:00:00Z"
  }
}
```

- Auto-created on first `TaskCreate`
- Auto-pruned: entries older than 24 hours are removed on every write
- If the file is deleted, new `TaskCreate` calls will recreate it

### Failure Mode

The hook is designed to **never break the workflow**:
- All operations wrapped in try/catch
- Exits silently on parse errors, missing files, or unmatched tasks
- 5-second timeout prevents hangs
- If session JSON doesn't exist or has no matching task, the hook is a no-op

---

## Session JSON Schema

Each session file (`repos/{repo}/state/sessions/CP-XXXXX.json`) follows this structure:

```jsonc
{
  "ticket": "CP-XXXXX",
  "branch": "feature-branch",
  "title": "Feature title",
  "status": "executing",           // executing | planned | paused | completed
  "workflow": "multi-task-story",
  "createdAt": "2026-03-29T00:00:00Z",
  "updatedAt": "2026-03-29T16:00:00Z",
  "currentPhase": 2,
  "coordinator": { "name": "Luffy", "role": "Captain", "status": "active", "emoji": "..." },
  "crew": [
    { "name": "Nami", "role": "UI Engineer", "status": "active", "emoji": "..." }
    // ...
  ],
  "phases": [
    {
      "id": 0,
      "name": "Phase name",
      "status": "complete",         // pending | in_progress | complete
      "assignees": ["Nami"],
      "tasks": [
        { "name": "Task description", "assignee": "Nami", "status": "complete" }
        // task.status: pending | in_progress | complete | skipped
      ]
    }
  ]
}
```

---

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/state?repo=X&session=Y` | Session state (defaults to active ticket) |
| `GET /api/active-sessions?repo=X` | All non-idle sessions for a repo |
| `GET /api/completed?repo=X` | Archived completed sessions |
| `GET /api/learnings?repo=X` | Patterns, corrections, habits markdown |
| `GET /api/decisions?repo=X` | Global decisions markdown |
| `GET /api/contracts?repo=X&session=Y` | Interface contracts for a session |
| `GET /api/repos` | List all repos with state |
| `GET /api/sessions?repo=X` | List session directories |
| `GET /api/story` | Story chapters markdown |
| `GET /api/changelog` | CHANGELOG.md content |
| `GET /events` | SSE stream (events: `state`, `decisions`, `active-sessions`, `heartbeat`) |

---

## UI Tabs

| Tab | Component | Description |
|-----|-----------|-------------|
| Voyage Map | `VoyageMap.tsx` | Kanban board with 4 status columns |
| Crew Flow | `FlowSimulator.tsx` | React Flow 8-stage interactive walkthrough |
| Crew Roster | `CrewRoster.tsx` | Bento grid with detail popovers |
| Captain's Log | `CaptainsLog.tsx` | Side-nav + react-markdown chapters |
| Navigator's Notes | `NavigatorNotes.tsx` | Learnings: patterns, corrections, habits |
| Past Voyages | `PastVoyages.tsx` | Completed session archive cards |
| Changelog | `Changelog.tsx` | Version history |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| API | Hono + @hono/node-server |
| UI | React 19 + TypeScript |
| Animations | Motion (framer-motion) |
| Flow diagrams | @xyflow/react |
| Markdown | react-markdown |
| Build | Vite 8 (Rolldown) |
| Real-time | Server-Sent Events (SSE) |
