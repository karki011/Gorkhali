// =============================================================================
// Phantom Works Board — Materializer
// Author: Subash Karki
//
// Pure function: TaskEvent[] -> MaterializedSession[]
//
// Replays an NDJSON event log to produce materialized views of sessions,
// tasks, crew activity, and stats. No side effects, no I/O.
// =============================================================================

import type { TaskEvent } from './event-store'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MaterializedTask {
  id: string
  subject: string
  crew: string | null
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
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
// Constants
// ---------------------------------------------------------------------------

/** Temporal gap (ms) that triggers a new session when no explicit marker */
const SESSION_GAP_MS = 30 * 60 * 1000

/** Regex to extract task ID from TaskCreate result strings */
const TASK_ID_PATTERNS = [
  /task\s+(?:#?\s*)?(\S+)/i,
  /created\s+(\S+)/i,
  /id[:\s]+(\S+)/i,
]

/** Regex to parse [CrewName] prefix from subjects */
const CREW_PREFIX_RE = /^\[([^\]]+)\]\s*(.+)$/

/** Session marker patterns in subjects */
const SESSION_START_RE = /^\[([^\]]+)\]\s*SESSION:start(?:\s+"?(.+?)"?)?$/i
const SESSION_PAUSE_RE = /^\[([^\]]+)\]\s*SESSION:pause/i
const SESSION_WRAP_RE = /^\[([^\]]+)\]\s*SESSION:wrap/i

/** Extract ticket from session start label (e.g., "CP-39617 -- description") */
const TICKET_RE = /^([A-Z]+-\d+)/

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Materialize a flat event log into structured sessions.
 */
export const materialize = (
  events: TaskEvent[],
  repo: string,
): MaterializedSession[] => {
  if (events.length === 0) return []

  // Pre-compute global create counter — Claude assigns IDs sequentially
  // across the entire session, not per-bucket
  let globalIdx = 0
  const globalCreateIds = new Map<TaskEvent, string>()
  for (const evt of events) {
    if (evt.tool === 'TaskCreate') {
      globalIdx++
      globalCreateIds.set(evt, extractTaskId(evt.result) ?? String(globalIdx))
    }
  }

  const sessionBuckets = splitIntoSessions(events)
  return sessionBuckets
    .map((bucket, idx) => buildSession(bucket, repo, idx, globalCreateIds))
    .filter((s) => s.tasks.length > 0)
}

// ---------------------------------------------------------------------------
// Session splitting
// ---------------------------------------------------------------------------

interface SessionBucket {
  events: TaskEvent[]
  marker: 'start' | 'gap' | 'first'
  markerSubject?: string
}

const splitIntoSessions = (events: TaskEvent[]): SessionBucket[] => {
  const buckets: SessionBucket[] = []
  let current: SessionBucket | null = null

  for (let i = 0; i < events.length; i++) {
    const evt = events[i]
    const subject = evt.input.subject ?? ''

    // Check for session markers
    const startMatch = subject.match(SESSION_START_RE)
    const isPause = SESSION_PAUSE_RE.test(subject)
    const isWrap = SESSION_WRAP_RE.test(subject)

    if (startMatch) {
      // Explicit session start — always opens a new session
      if (current) buckets.push(current)
      current = {
        events: [evt],
        marker: 'start',
        markerSubject: startMatch[2]?.trim() || undefined,
      }
      continue
    }

    if (isPause || isWrap) {
      // Pause/wrap closes the current session
      if (current) {
        current.events.push(evt)
        buckets.push(current)
        current = null
      }
      continue
    }

    // Temporal gap detection — but same branch = same session
    if (current) {
      const prevTs = new Date(
        current.events[current.events.length - 1].ts,
      ).getTime()
      const curTs = new Date(evt.ts).getTime()
      if (curTs - prevTs > SESSION_GAP_MS) {
        // Check if same branch — if so, don't split
        const prevBranch = (current.events[current.events.length - 1] as Record<string, unknown>).branch as string | undefined
        const curBranch = (evt as Record<string, unknown>).branch as string | undefined
        const sameBranch = prevBranch && curBranch && prevBranch === curBranch
        if (!sameBranch) {
          buckets.push(current)
          current = { events: [evt], marker: 'gap' }
          continue
        }
      }
    }

    // First event ever
    if (!current) {
      current = { events: [evt], marker: 'first' }
      continue
    }

    current.events.push(evt)
  }

  if (current && current.events.length > 0) {
    buckets.push(current)
  }

  return buckets
}

// ---------------------------------------------------------------------------
// Session building
// ---------------------------------------------------------------------------

const buildSession = (
  bucket: SessionBucket,
  repo: string,
  idx: number,
  globalCreateIds: Map<TaskEvent, string>,
): MaterializedSession => {
  const { events, markerSubject } = bucket
  const startedAt = events[0].ts
  const lastActivityAt = events[events.length - 1].ts
  const sessionId = `session-${idx}-${startedAt.replace(/[^0-9]/g, '').slice(0, 14)}`

  // Extract ticket and clean label from session marker
  let ticket: string | null = null
  let label: string | null = null
  if (markerSubject) {
    const ticketMatch = markerSubject.match(TICKET_RE)
    if (ticketMatch) {
      ticket = ticketMatch[1]
    }
    // Clean label: strip ticket, leading dashes/quotes/spaces
    let cleaned = markerSubject
      .replace(TICKET_RE, '')
      .replace(/^[\s"—-]+|[\s"—-]+$/g, '')
      .trim()
    if (cleaned.length > 0) label = cleaned
  }

  // Try to extract ticket from branch if not found in markers
  if (!ticket) {
    for (const evt of events) {
      if ((evt as Record<string, unknown>).branch) {
        const branchTicket = ((evt as Record<string, unknown>).branch as string).match(TICKET_RE)
        if (branchTicket) { ticket = branchTicket[1]; break }
      }
    }
  }

  // Build tasks by replaying creates + updates
  const tasks = buildTasks(events, globalCreateIds)

  // Try to extract label from first task description if no marker label
  if (!label && tasks.length > 0) {
    const firstDesc = tasks[0].description
    if (firstDesc) {
      label = firstDesc.replace(/^Phase\s*\d+[:\s]*/i, '').trim().slice(0, 80) || null
    }
    if (!label) {
      label = tasks[0].subject.slice(0, 80) || null
    }
  }

  // Collect unique crew names
  const crewSet = new Set<string>()
  for (const task of tasks) {
    if (task.crew) crewSet.add(task.crew)
  }

  // Also scan events for crew names in case some tasks have no crew prefix
  for (const evt of events) {
    const crewMatch = evt.input.subject?.match(CREW_PREFIX_RE)
    if (crewMatch) crewSet.add(crewMatch[1])
  }

  const stats = computeStats(tasks)

  return {
    sessionId,
    repo,
    ticket,
    label,
    startedAt,
    lastActivityAt,
    tasks,
    crewActive: Array.from(crewSet).sort(),
    stats,
  }
}

// ---------------------------------------------------------------------------
// Task building
// ---------------------------------------------------------------------------

const buildTasks = (events: TaskEvent[], globalCreateIds: Map<TaskEvent, string>): MaterializedTask[] => {
  const taskMap = new Map<string, MaterializedTask>()

  for (const evt of events) {
    if (evt.tool === 'TaskCreate') {
      const subject = evt.input.subject ?? ''
      // Skip session markers
      const stripped = subject.replace(CREW_PREFIX_RE, '').trim()
      if (/^SESSION:(start|pause|wrap)/i.test(stripped)) continue

      // Use the globally-computed ID for this create event
      const id = globalCreateIds.get(evt) ?? `unknown`
      const { crew, cleanSubject } = parseCrew(subject)

      taskMap.set(id, {
        id,
        subject: cleanSubject,
        crew,
        description: evt.input.description ?? '',
        status: 'pending',
        createdAt: evt.ts,
        updatedAt: evt.ts,
      })
    } else if (evt.tool === 'TaskUpdate') {
      const taskId = evt.input.taskId
      if (!taskId) continue

      const existing = taskMap.get(taskId)
      if (existing) {
        // Apply update
        if (evt.input.status) {
          existing.status = normalizeStatus(evt.input.status)
        }
        if (evt.input.subject) {
          const { crew, cleanSubject } = parseCrew(evt.input.subject)
          existing.subject = cleanSubject
          if (crew) existing.crew = crew
        }
        if (evt.input.description) {
          existing.description = evt.input.description
        }
        existing.updatedAt = evt.ts
      } else {
        // Orphan update — create a task from the update info
        const { crew, cleanSubject } = parseCrew(evt.input.subject ?? '')
        taskMap.set(taskId, {
          id: taskId,
          subject: cleanSubject || `Task ${taskId}`,
          crew,
          description: evt.input.description ?? '',
          status: normalizeStatus(evt.input.status ?? 'pending'),
          createdAt: evt.ts,
          updatedAt: evt.ts,
        })
      }
    }
  }

  return Array.from(taskMap.values())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const extractTaskId = (result: string | null): string | null => {
  if (!result) return null
  for (const pattern of TASK_ID_PATTERNS) {
    const match = result.match(pattern)
    if (match) return match[1]
  }
  return null
}

const parseCrew = (
  subject: string,
): { crew: string | null; cleanSubject: string } => {
  const match = subject.match(CREW_PREFIX_RE)
  if (match) {
    return { crew: match[1], cleanSubject: match[2] }
  }
  return { crew: null, cleanSubject: subject }
}

const normalizeStatus = (
  raw: string,
): 'pending' | 'in_progress' | 'completed' | 'cancelled' => {
  const lower = raw.toLowerCase().replace(/[\s-]/g, '_')
  if (lower === 'completed' || lower === 'complete' || lower === 'done')
    return 'completed'
  if (
    lower === 'in_progress' ||
    lower === 'inprogress' ||
    lower === 'active' ||
    lower === 'started'
  )
    return 'in_progress'
  if (lower === 'cancelled' || lower === 'canceled') return 'cancelled'
  return 'pending'
}

const computeStats = (tasks: MaterializedTask[]): SessionStats => {
  const stats: SessionStats = {
    total: tasks.length,
    pending: 0,
    inProgress: 0,
    completed: 0,
    cancelled: 0,
  }
  for (const t of tasks) {
    switch (t.status) {
      case 'pending':
        stats.pending++
        break
      case 'in_progress':
        stats.inProgress++
        break
      case 'completed':
        stats.completed++
        break
      case 'cancelled':
        stats.cancelled++
        break
    }
  }
  return stats
}
