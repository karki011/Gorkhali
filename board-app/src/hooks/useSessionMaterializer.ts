// =============================================================================
// Straw Hat Board — Session Materializer (Event-Sourced)
// Author: Subash Karki
//
// Client-side materialization: folds TaskEvent[] into MaterializedSession[].
// Pure function + React hook wrapper. Mirrors server-side materializer logic.
// =============================================================================

import { useMemo } from 'react'
import type {
  TaskEvent,
  TaskStatus,
  MaterializedTask,
  MaterializedSession,
  SessionStats,
} from '../types.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_GAP_MS = 30 * 60 * 1000 // 30 minutes
const CREW_PATTERN = /^\[([^\]]+)\]/
const SESSION_START_PATTERN = /^SESSION:start/i
const SESSION_END_PATTERN = /^SESSION:(pause|wrap)/i
const TASK_ID_PATTERN = /(?:task[_\s-]?id[:\s]*|created\s+task\s+)([a-zA-Z0-9_-]+)/i

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const extractTaskId = (event: TaskEvent): string | null => {
  // TaskUpdate always has taskId in input
  if (event.tool === 'TaskUpdate' && event.input.taskId) {
    return event.input.taskId
  }

  // TaskCreate: extract ID from result string
  if (event.tool === 'TaskCreate' && event.result) {
    const match = event.result.match(TASK_ID_PATTERN)
    if (match) return match[1]

    // Fallback: if result looks like a bare ID
    const trimmed = event.result.trim()
    if (/^[a-zA-Z0-9_-]+$/.test(trimmed) && trimmed.length < 64) {
      return trimmed
    }
  }

  return null
}

const extractCrew = (subject: string): string | null => {
  const match = subject.match(CREW_PATTERN)
  return match ? match[1] : null
}

const isSessionStart = (subject: string): boolean => {
  const stripped = subject.replace(CREW_PATTERN, '').trim()
  return SESSION_START_PATTERN.test(stripped)
}

const isSessionEnd = (subject: string): boolean => {
  const stripped = subject.replace(CREW_PATTERN, '').trim()
  return SESSION_END_PATTERN.test(stripped)
}

const isSessionMarker = (subject: string): boolean =>
  isSessionStart(subject) || isSessionEnd(subject)

const computeStats = (tasks: MaterializedTask[]): SessionStats => {
  const stats: SessionStats = {
    total: tasks.length,
    pending: 0,
    inProgress: 0,
    completed: 0,
    cancelled: 0,
  }

  for (const task of tasks) {
    switch (task.status) {
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

// ---------------------------------------------------------------------------
// Extract ticket/label from session-start marker events
// ---------------------------------------------------------------------------

const extractTicket = (subject: string): string | null => {
  // Match patterns like "CP-12345" or "JIRA-123"
  const match = subject.match(/\b([A-Z]+-\d+)\b/)
  return match ? match[1] : null
}

const extractLabel = (subject: string): string | null => {
  // Strip [Crew] prefix, SESSION:start/wrap markers, ticket, and quotes
  let cleaned = subject.replace(CREW_PATTERN, '').trim()
  cleaned = cleaned.replace(/^SESSION:(start|pause|wrap)\s*/i, '').trim()
  cleaned = cleaned.replace(/^"(.*)"$/, '$1').trim() // remove wrapping quotes
  cleaned = cleaned.replace(/\b[A-Z]+-\d+\b/, '').trim() // remove ticket
  cleaned = cleaned.replace(/^[\s:—-]+|[\s:—-]+$/g, '').trim()
  return cleaned.length > 0 ? cleaned : null
}

// ---------------------------------------------------------------------------
// Core materializer — pure function
// ---------------------------------------------------------------------------

export const materializeSessions = (events: TaskEvent[]): MaterializedSession[] => {
  if (events.length === 0) return []

  // Step 1: Sort events by timestamp
  const sorted = [...events].sort((a, b) => a.ts.localeCompare(b.ts))

  // Step 2: Split into session boundaries
  // Key rule: same branch = same session (don't split on temporal gaps)
  const sessionBuckets: TaskEvent[][] = []
  let currentBucket: TaskEvent[] = []
  let lastTimestamp: number | null = null
  let currentBranch: string | null = null

  const getBranch = (evt: TaskEvent): string | null =>
    (evt as Record<string, unknown>).branch as string | null ?? null

  for (const event of sorted) {
    const eventTime = new Date(event.ts).getTime()
    const subject = event.input.subject ?? ''
    const branch = getBranch(event)

    // Track branch for the current bucket
    if (branch && !currentBranch) currentBranch = branch

    // SESSION:start — push previous bucket, start new one with this event
    if (isSessionStart(subject)) {
      if (currentBucket.length > 0) {
        sessionBuckets.push(currentBucket)
      }
      currentBucket = [event]
      currentBranch = branch
      lastTimestamp = eventTime
      continue
    }

    // SESSION:pause/wrap — add to current bucket, close it, reset
    if (isSessionEnd(subject)) {
      currentBucket.push(event)
      if (currentBucket.length > 0) {
        sessionBuckets.push(currentBucket)
      }
      currentBucket = []
      currentBranch = null
      lastTimestamp = null
      continue
    }

    // Temporal gap — BUT only split if the branch is different
    if (lastTimestamp !== null && eventTime - lastTimestamp > SESSION_GAP_MS) {
      const sameBranch = branch && currentBranch && branch === currentBranch
      if (!sameBranch) {
        if (currentBucket.length > 0) {
          sessionBuckets.push(currentBucket)
        }
        currentBucket = []
        currentBranch = branch
      }
    }

    currentBucket.push(event)
    lastTimestamp = eventTime
  }

  // Push final bucket
  if (currentBucket.length > 0) {
    sessionBuckets.push(currentBucket)
  }

  // Pre-pass: build a global TaskCreate index → ID mapping.
  // Claude assigns sequential IDs (1, 2, 3...) globally within a session,
  // NOT per session bucket. So we count ALL creates across the entire sorted
  // event array to get the correct ID for each create.
  let globalCreateIndex = 0
  const createIdByEventIndex = new Map<number, string>() // sorted event index → assigned taskId
  for (let i = 0; i < sorted.length; i++) {
    const evt = sorted[i]
    if (evt.tool === 'TaskCreate') {
      globalCreateIndex++
      const extracted = extractTaskId(evt)
      createIdByEventIndex.set(i, extracted ?? String(globalCreateIndex))
    }
  }

  // Step 3: Materialize each session bucket
  const sessions: MaterializedSession[] = sessionBuckets.map((bucket, index) => {
    const taskMap = new Map<string, MaterializedTask>()
    const crewSet = new Set<string>()
    let sessionTicket: string | null = null
    let sessionLabel: string | null = null

    for (const event of bucket) {
      const subject = event.input.subject ?? ''

      // Extract session metadata from markers
      if (isSessionMarker(subject)) {
        if (!sessionTicket) sessionTicket = extractTicket(subject)
        if (!sessionLabel) sessionLabel = extractLabel(subject)
        continue
      }

      if (event.tool === 'TaskCreate') {
        // Look up the globally-assigned ID for this create event
        const sortedIdx = sorted.indexOf(event)
        const taskId = createIdByEventIndex.get(sortedIdx) ?? `unknown-${sortedIdx}`
        const crew = extractCrew(subject)
        if (crew) crewSet.add(crew)

        taskMap.set(taskId, {
          id: taskId,
          subject: subject.replace(CREW_PATTERN, '').trim() || 'Task',
          crew,
          description: event.input.description ?? '',
          status: 'pending',
          createdAt: event.ts,
          updatedAt: event.ts,
        })
      }

      if (event.tool === 'TaskUpdate') {
        const taskId = event.input.taskId
        if (!taskId) continue

        const existing = taskMap.get(taskId)

        if (existing) {
          // Update existing task
          if (event.input.status) existing.status = event.input.status
          if (event.input.subject) {
            existing.subject = event.input.subject.replace(CREW_PATTERN, '').trim()
            const crew = extractCrew(event.input.subject)
            if (crew) {
              existing.crew = crew
              crewSet.add(crew)
            }
          }
          if (event.input.description) existing.description = event.input.description
          existing.updatedAt = event.ts
        } else {
          // Orphan update — no matching create. Still record it.
          const crew = event.input.subject ? extractCrew(event.input.subject) : null
          if (crew) crewSet.add(crew)

          taskMap.set(taskId, {
            id: taskId,
            subject: (event.input.subject ?? `Task #${taskId}`).replace(CREW_PATTERN, '').trim(),
            crew,
            description: event.input.description ?? '',
            status: event.input.status ?? ('pending' as TaskStatus),
            createdAt: event.ts,
            updatedAt: event.ts,
          })
        }
      }
    }

    // Auto-mark stale in_progress tasks (>15 min without update) as completed
    const STALE_MS = 15 * 60 * 1000 // 15 minutes
    const now = Date.now()
    const tasks = Array.from(taskMap.values()).map((t) => {
      if (t.status === 'in_progress' && now - new Date(t.updatedAt).getTime() > STALE_MS) {
        return { ...t, status: 'completed' as TaskStatus }
      }
      return t
    })
    const timestamps = bucket.map((e) => e.ts).sort()

    // Try to extract ticket from: 1) markers (already done), 2) branch name, 3) task subjects
    if (!sessionTicket) {
      // Check branch field on events
      for (const event of bucket) {
        if (event.branch) {
          const branchTicket = extractTicket(event.branch)
          if (branchTicket) { sessionTicket = branchTicket; break }
        }
      }
    }
    if (!sessionTicket) {
      for (const task of tasks) {
        const ticket = extractTicket(task.subject)
        if (ticket) { sessionTicket = ticket; break }
      }
    }

    // Try to extract label from first task's description if no marker label
    if (!sessionLabel && tasks.length > 0) {
      const firstDesc = tasks[0].description
      if (firstDesc) {
        // Strip "Phase N:" prefix
        sessionLabel = firstDesc.replace(/^Phase\s*\d+[:\s]*/i, '').trim().slice(0, 80) || null
      }
      if (!sessionLabel) {
        sessionLabel = tasks[0].subject.slice(0, 80) || null
      }
    }

    return {
      sessionId: `session-${index}`,
      repo: '',
      ticket: sessionTicket,
      label: sessionLabel,
      startedAt: timestamps[0] ?? '',
      lastActivityAt: timestamps[timestamps.length - 1] ?? '',
      tasks,
      crewActive: Array.from(crewSet).sort(),
      stats: computeStats(tasks),
    }
  })

  // Filter out empty sessions and return newest-first
  return sessions
    .filter((s) => s.tasks.length > 0)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

// ---------------------------------------------------------------------------
// React hook wrapper — memoizes materialization
// ---------------------------------------------------------------------------

export const useMaterializedSessions = (events: TaskEvent[]): MaterializedSession[] =>
  useMemo(() => materializeSessions(events), [events])
