#!/usr/bin/env npx tsx
// =============================================================================
// Straw Hat Board — Legacy Session Migration
// Author: Subash Karki
//
// One-time migration: reads old SessionState JSON files from
// repos/{repo}/state/sessions/ and generates synthetic TaskEvents
// in events/{repo}/task-events.ndjson.
//
// Run: cd ~/.claude/team/board-app && npx tsx server/migrate-legacy.ts
// =============================================================================

import { readdirSync, readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const TEAM_ROOT = join(homedir(), '.claude', 'team')
const REPOS_DIR = join(TEAM_ROOT, 'repos')
const EVENTS_DIR = join(TEAM_ROOT, 'events')

interface LegacyTask {
  name: string
  assignee?: string
  status?: string
}

interface LegacyPhase {
  id?: number
  name: string
  status?: string
  tasks?: LegacyTask[]
}

interface LegacySession {
  ticket?: string
  title?: string
  branch?: string
  status?: string
  createdAt?: string
  updatedAt?: string
  phases?: LegacyPhase[]
  crew?: Array<string | { name: string }>
}

const readJson = (path: string): LegacySession | null => {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

let totalEvents = 0
let totalSessions = 0

const repos = (() => {
  try {
    return readdirSync(REPOS_DIR).filter(d => !d.startsWith('.'))
  } catch {
    return []
  }
})()

for (const repo of repos) {
  const sessDir = join(REPOS_DIR, repo, 'state', 'sessions')
  if (!existsSync(sessDir)) continue

  const files = readdirSync(sessDir).filter(f => f.endsWith('.json'))
  if (files.length === 0) continue

  const eventsDir = join(EVENTS_DIR, repo)
  if (!existsSync(eventsDir)) mkdirSync(eventsDir, { recursive: true })

  const eventsFile = join(eventsDir, 'task-events.ndjson')
  const lines: string[] = []

  for (const file of files) {
    const session = readJson(join(sessDir, file))
    if (!session) continue

    const ticket = session.ticket || file.replace('.json', '')
    const createdAt = session.createdAt || new Date().toISOString()
    const updatedAt = session.updatedAt || createdAt

    // SESSION:start marker
    lines.push(JSON.stringify({
      ts: createdAt,
      tool: 'TaskCreate',
      input: {
        subject: `[Luffy] SESSION:start "${ticket}${session.title ? ` — ${session.title}` : ''}"`,
        description: `Legacy migration from ${file}`,
      },
      result: `Created task legacy-${ticket}-start`,
      _synthetic: true,
    }))

    // Generate events from phases/tasks
    const phases = Array.isArray(session.phases) ? session.phases : []
    let taskIndex = 0

    for (const phase of phases) {
      const tasks = Array.isArray(phase.tasks) ? phase.tasks : []
      for (const task of tasks) {
        taskIndex++
        const taskId = `legacy-${ticket}-${taskIndex}`
        const crew = task.assignee || null
        const subject = crew ? `[${crew}] ${task.name}` : task.name

        // TaskCreate
        lines.push(JSON.stringify({
          ts: createdAt,
          tool: 'TaskCreate',
          input: { subject, description: `Phase: ${phase.name}` },
          result: `Created task ${taskId}`,
          _synthetic: true,
        }))

        // TaskUpdate if not pending
        const status = task.status
        if (status === 'complete' || status === 'completed' || status === 'done') {
          lines.push(JSON.stringify({
            ts: updatedAt,
            tool: 'TaskUpdate',
            input: { taskId, status: 'completed' },
            result: `Updated task ${taskId}`,
            _synthetic: true,
          }))
        } else if (status === 'in_progress') {
          lines.push(JSON.stringify({
            ts: updatedAt,
            tool: 'TaskUpdate',
            input: { taskId, status: 'in_progress' },
            result: `Updated task ${taskId}`,
            _synthetic: true,
          }))
        } else if (status === 'skipped') {
          lines.push(JSON.stringify({
            ts: updatedAt,
            tool: 'TaskUpdate',
            input: { taskId, status: 'cancelled' },
            result: `Updated task ${taskId}`,
            _synthetic: true,
          }))
        }
      }
    }

    // SESSION:wrap marker if completed
    if (session.status === 'completed' || session.status === 'complete' || session.status === 'done') {
      lines.push(JSON.stringify({
        ts: updatedAt,
        tool: 'TaskCreate',
        input: { subject: `[Luffy] SESSION:wrap` },
        result: `Created task legacy-${ticket}-wrap`,
        _synthetic: true,
      }))
    }

    totalSessions++
  }

  if (lines.length > 0) {
    appendFileSync(eventsFile, lines.join('\n') + '\n')
    totalEvents += lines.length
    console.log(`  ${repo}: ${files.length} sessions → ${lines.length} events`)
  }
}

console.log(`\nMigration complete: ${totalSessions} sessions → ${totalEvents} events across ${repos.length} repos`)
