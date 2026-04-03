// =============================================================================
// Straw Hat Board — Event Store
// Author: Subash Karki
//
// NDJSON reader with mtime-based cache. Reads TaskEvent lines from
// ~/.claude/team/events/{repo}/task-events.ndjson and returns parsed events.
// =============================================================================

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const EVENTS_DIR = join(homedir(), '.claude', 'team', 'events')

const eventFilePath = (repo: string) =>
  join(EVENTS_DIR, repo, 'task-events.ndjson')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskEvent {
  ts: string
  tool: 'TaskCreate' | 'TaskUpdate'
  input: {
    subject?: string
    description?: string
    taskId?: string
    status?: string
  }
  result: string | null
  _synthetic?: boolean
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  mtimeMs: number
  events: TaskEvent[]
}

const cache = new Map<string, CacheEntry>()

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load all TaskEvents for a repo from its NDJSON file.
 * Results are cached by file mtime — only re-parsed when the file changes.
 */
export const loadEvents = async (repo: string): Promise<TaskEvent[]> => {
  const filePath = eventFilePath(repo)

  let mtimeMs: number
  try {
    const s = await stat(filePath)
    mtimeMs = s.mtimeMs
  } catch {
    // File doesn't exist yet — return empty
    return []
  }

  const cached = cache.get(repo)
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.events
  }

  const raw = await readFile(filePath, 'utf-8')
  const events = parseNdjson(raw)

  cache.set(repo, { mtimeMs, events })
  return events
}

/**
 * Load only events since a given ISO timestamp.
 */
export const loadEventsSince = async (
  repo: string,
  since: string,
): Promise<TaskEvent[]> => {
  const all = await loadEvents(repo)
  const threshold = new Date(since).getTime()
  return all.filter((evt) => new Date(evt.ts).getTime() > threshold)
}

/**
 * Get the current mtime of the event file (for polling).
 * Returns 0 if the file does not exist.
 */
export const getEventFileMtime = async (repo: string): Promise<number> => {
  try {
    const s = await stat(eventFilePath(repo))
    return s.mtimeMs
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

const parseNdjson = (raw: string): TaskEvent[] => {
  const events: TaskEvent[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (isTaskEvent(parsed)) {
        events.push(parsed)
      }
    } catch {
      // Skip malformed lines
    }
  }
  return events
}

const isTaskEvent = (obj: unknown): obj is TaskEvent => {
  if (typeof obj !== 'object' || obj === null) return false
  const o = obj as Record<string, unknown>
  return (
    typeof o.ts === 'string' &&
    (o.tool === 'TaskCreate' || o.tool === 'TaskUpdate') &&
    typeof o.input === 'object' &&
    o.input !== null
  )
}
