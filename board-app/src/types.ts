// =============================================================================
// Straw Hat Board — Types
// Author: Subash Karki
// =============================================================================

// ---------------------------------------------------------------------------
// Raw event from NDJSON
// ---------------------------------------------------------------------------

export interface TaskEvent {
  ts: string
  tool: 'TaskCreate' | 'TaskUpdate'
  input: {
    subject?: string
    description?: string
    taskId?: string
    status?: TaskStatus
  }
  result: string | null
  branch?: string | null
  _synthetic?: boolean
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

// ---------------------------------------------------------------------------
// Materialized (derived from events)
// ---------------------------------------------------------------------------

export interface MaterializedTask {
  id: string
  subject: string
  crew: string | null
  description: string
  status: TaskStatus
  createdAt: string
  updatedAt: string
}

export interface SessionStats {
  total: number
  pending: number
  inProgress: number
  completed: number
  cancelled: number
}

export interface MaterializedSession {
  sessionId: string
  repo: string
  ticket: string | null
  label: string | null
  startedAt: string
  lastActivityAt: string
  tasks: MaterializedTask[]
  crewActive: string[]
  stats: SessionStats
}

// ---------------------------------------------------------------------------
// Story from /api/story
// ---------------------------------------------------------------------------

export interface StoryChapter {
  title: string
  file: string
  content: string
}

export interface StoryData {
  chapters: StoryChapter[]
  index: string
}

// ---------------------------------------------------------------------------
// Learnings from /api/learnings
// ---------------------------------------------------------------------------

export interface LearningsData {
  [domain: string]: string // domain filename -> content
}

// ---------------------------------------------------------------------------
// Decisions from /api/decisions
// ---------------------------------------------------------------------------

export interface DecisionsData {
  content: string
}

// ---------------------------------------------------------------------------
// Contracts from /api/contracts
// ---------------------------------------------------------------------------

export interface ContractsData {
  [type: string]: string
}

// ---------------------------------------------------------------------------
// Arsenal from /api/arsenal
// ---------------------------------------------------------------------------

export interface ArsenalData {
  hooks: Array<{ event: string; matcher: string; command: string }>
  skills: {
    project: Array<{ name: string; path: string }>
    global: Array<{ name: string; path: string }>
    plugins: Array<{ name: string; source: string }>
  }
  agents: {
    core: Array<{ name: string; role: string; emoji: string; model: string }>
    allies: Array<{ name: string; role: string; emoji: string }>
    marines: Array<{ name: string; role: string; emoji: string }>
  }
  plugins: Array<{ name: string; marketplace: string; enabled: boolean }>
  memory: {
    entries: number
    summary: string
  }
  config: {
    model: string | null
    permissions: string | null
    effortLevel: string | null
    teammateMode: string | null
    mcpServers: string[]
  }
}
