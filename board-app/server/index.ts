// =============================================================================
// Phantom Works Board — Hono API Server (Event-Sourced)
// Author: Subash Karki
//
// Event-sourced backend that reads directly from NDJSON event logs.
// Replaces the old SessionState JSON system entirely.
// =============================================================================

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import { readFile, readdir } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'

import { loadEvents, loadEventsSince, getEventFileMtime } from './event-store'
import { materialize } from './materializer'
import { loadArsenal } from './arsenal'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const TEAM_ROOT = join(homedir(), '.claude', 'team')
const REPOS_DIR = join(TEAM_ROOT, 'repos')
const EVENTS_DIR = join(TEAM_ROOT, 'events')
const STORY_DIR = join(TEAM_ROOT, 'story')

const resolveRepoName = (): string => {
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    if (gitRoot) return basename(gitRoot)
  } catch {
    /* not a git repo */
  }
  return basename(process.cwd()) || '_default'
}

const DEFAULT_REPO = resolveRepoName()

const repoDir = (repo: string) => join(REPOS_DIR, repo)
const learningsDir = (repo: string) => join(repoDir(repo), 'learnings')
const decisionsDir = (repo: string) => join(repoDir(repo), 'decisions')
const sessionsDir = (repo: string) => join(repoDir(repo), 'sessions')

// Ensure dirs exist
for (const dir of [
  STORY_DIR,
  EVENTS_DIR,
  repoDir(DEFAULT_REPO),
  learningsDir(DEFAULT_REPO),
  decisionsDir(DEFAULT_REPO),
  sessionsDir(DEFAULT_REPO),
]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const readText = async (path: string): Promise<string> => {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return ''
  }
}

const getRepo = (c: { req: { query: (key: string) => string | undefined } }) =>
  c.req.query('repo') || DEFAULT_REPO

// ---------------------------------------------------------------------------
// SSE Broadcast
// ---------------------------------------------------------------------------

type SSEClient = {
  send: (event: string, data: string) => void
  close: () => void
}
const sseClients = new Set<SSEClient>()

const broadcast = (event: string, data: unknown) => {
  const payload = JSON.stringify(data)
  for (const client of sseClients) {
    try {
      client.send(event, payload)
    } catch {
      sseClients.delete(client)
    }
  }
}

// ---------------------------------------------------------------------------
// NDJSON Polling — mtime-based change detection
// ---------------------------------------------------------------------------

/** Track mtime + line count per repo for incremental event broadcasting */
const repoPollers = new Map<
  string,
  { lastMtime: number; lastLineCount: number }
>()

const pollEventsForRepo = async (repo: string) => {
  const mtime = await getEventFileMtime(repo)
  const state = repoPollers.get(repo) ?? { lastMtime: 0, lastLineCount: 0 }

  if (mtime === 0) {
    // No event file yet
    repoPollers.set(repo, state)
    return
  }

  if (mtime === state.lastMtime) return // No change

  // File changed — reload and find new events
  const events = await loadEvents(repo)
  const newEvents = events.slice(state.lastLineCount)

  // Broadcast each new event individually
  for (const evt of newEvents) {
    broadcast('task-event', evt)
  }

  // Also broadcast the latest materialized session for convenience
  if (newEvents.length > 0) {
    const sessions = materialize(events, repo)
    if (sessions.length > 0) {
      broadcast('session', sessions[sessions.length - 1])
    }
  }

  repoPollers.set(repo, { lastMtime: mtime, lastLineCount: events.length })
}

const startEventPolling = async () => {
  // Poll all known repos every 2 seconds
  const pollAll = async () => {
    try {
      // Check EVENTS_DIR for repos with event files
      const eventRepos = existsSync(EVENTS_DIR)
        ? (await readdir(EVENTS_DIR)).filter((d) => !d.startsWith('.'))
        : []

      // Also check REPOS_DIR for repos that might not have events yet
      const repoList = existsSync(REPOS_DIR)
        ? (await readdir(REPOS_DIR)).filter((d) => !d.startsWith('.'))
        : []

      const allRepos = new Set([...eventRepos, ...repoList])

      for (const repo of allRepos) {
        await pollEventsForRepo(repo)
      }
    } catch {
      /* ignore polling errors */
    }
  }

  // Capture initial state without broadcasting
  await pollAll()

  setInterval(pollAll, 2000)
}

// ---------------------------------------------------------------------------
// Data loaders (non-task endpoints — preserved)
// ---------------------------------------------------------------------------

const loadLearnings = async (repo: string): Promise<Record<string, string>> => {
  const dir = learningsDir(repo)
  const result: Record<string, string> = {}
  try {
    const files = await readdir(dir)
    for (const f of files) {
      if (!f.endsWith('.md')) continue
      if (f === 'INDEX.md') continue
      const name = f.replace('.md', '')
      result[name] = await readText(join(dir, f))
    }
  } catch {
    /* no learnings dir */
  }
  return result
}

const loadDecisions = async (repo: string) => ({
  content: await readText(join(decisionsDir(repo), 'global.md')),
})

const loadStory = async () => {
  const index = await readText(join(STORY_DIR, 'index.md'))
  const chapters: { title: string; file: string; content: string }[] = []
  try {
    const files = (await readdir(STORY_DIR))
      .filter((f) => f.startsWith('chapter-') && f.endsWith('.md'))
      .sort()
    for (const f of files) {
      const content = await readText(join(STORY_DIR, f))
      const titleMatch = content.match(/^#\s+(.+)/m)
      chapters.push({ title: titleMatch?.[1] || f, file: f, content })
    }
  } catch {
    /* no chapters */
  }
  return { index, chapters }
}

const loadRepos = async () => {
  try {
    const dirs = await readdir(REPOS_DIR)
    return dirs.filter((d) => !d.startsWith('.'))
  } catch {
    return []
  }
}

const loadContracts = async (repo: string, ticket?: string) => {
  if (!ticket) {
    // Try to detect from most recent session's ticket
    const events = await loadEvents(repo)
    const sessions = materialize(events, repo)
    if (sessions.length > 0) {
      ticket = sessions[sessions.length - 1].ticket ?? undefined
    }
  }
  if (!ticket) return {}
  const contractDir = join(sessionsDir(repo), ticket, 'contracts')
  try {
    const files = await readdir(contractDir)
    const contracts: Record<string, string> = {}
    for (const f of files) {
      if (!f.endsWith('.md')) continue
      contracts[f.replace('.md', '')] = await readText(join(contractDir, f))
    }
    return contracts
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Hono App
// ---------------------------------------------------------------------------

const app = new Hono()

app.use('*', cors())

// --- Event-sourced endpoints ---

app.get('/api/session', async (c) => {
  const repo = getRepo(c)
  const events = await loadEvents(repo)
  const sessions = materialize(events, repo)
  if (sessions.length === 0) return c.json({})
  return c.json(sessions[sessions.length - 1])
})

app.get('/api/sessions', async (c) => {
  const repo = getRepo(c)
  const events = await loadEvents(repo)
  const sessions = materialize(events, repo)
  return c.json(sessions)
})

app.get('/api/events', async (c) => {
  const repo = getRepo(c)
  const since = c.req.query('since')
  if (since) {
    return c.json(await loadEventsSince(repo, since))
  }
  return c.json(await loadEvents(repo))
})

// --- Preserved non-task endpoints ---

app.get('/api/learnings', async (c) => {
  const repo = getRepo(c)
  return c.json(await loadLearnings(repo))
})

app.get('/api/decisions', async (c) => {
  const repo = getRepo(c)
  return c.json(await loadDecisions(repo))
})

app.get('/api/story', async (c) => c.json(await loadStory()))

app.get('/api/repos', async (c) => c.json(await loadRepos()))

app.get('/api/contracts', async (c) => {
  const repo = getRepo(c)
  const ticket = c.req.query('session')
  return c.json(await loadContracts(repo, ticket))
})

app.get('/api/changelog', async (c) => {
  const content = await readText(join(TEAM_ROOT, 'CHANGELOG.md'))
  return c.json({ content })
})

app.get('/api/arsenal', async (c) => {
  const repo = getRepo(c)
  return c.json(await loadArsenal(repo))
})

// --- SSE ---

app.get('/events', (c) => {
  return streamSSE(c, async (stream) => {
    const client: SSEClient = {
      send: (event, data) => {
        stream.writeSSE({ event, data })
      },
      close: () => {
        sseClients.delete(client)
      },
    }
    sseClients.add(client)

    // Immediate heartbeat so client knows it's connected
    stream.writeSSE({ event: 'heartbeat', data: '' })

    // Periodic heartbeat
    const heartbeat = setInterval(() => {
      try {
        stream.writeSSE({ event: 'heartbeat', data: '' })
      } catch {
        clearInterval(heartbeat)
      }
    }, 30000)

    // Keep alive until client disconnects
    stream.onAbort(() => {
      clearInterval(heartbeat)
      sseClients.delete(client)
    })

    // Block to keep stream open
    await new Promise(() => {})
  })
})

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT) || 3847

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(
    `🏴‍☠️ Phantom Works Board API running on http://localhost:${info.port}`,
  )
  console.log(`   Repo: ${DEFAULT_REPO}`)
  console.log(`   Team: ${TEAM_ROOT}`)
  console.log(`   Events: ${EVENTS_DIR}`)
})

// Start NDJSON event polling for all repos
startEventPolling().then(() => {
  console.log('   Event polling started (2s interval)')
})

export default app
