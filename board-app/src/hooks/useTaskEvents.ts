// =============================================================================
// Straw Hat Board — Task Events Hook (Event-Sourced)
// Author: Subash Karki
//
// Core data hook that replaces useSessionState. Fetches initial events from
// /api/events?repo=X, then subscribes to SSE for real-time task-event messages.
// =============================================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import type { TaskEvent } from '../types.ts'

interface TaskEventsResult {
  events: TaskEvent[]
  loading: boolean
  error: string | null
  connected: boolean
}

export const useTaskEvents = (repo?: string): TaskEventsResult => {
  const [events, setEvents] = useState<TaskEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  // -------------------------------------------------------------------------
  // Initial fetch: GET /api/events?repo=X
  // -------------------------------------------------------------------------

  const fetchEvents = useCallback(async (repoName?: string) => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      if (repoName) params.set('repo', repoName)
      const qs = params.toString()
      const url = qs ? `/api/events?${qs}` : '/api/events'

      const response = await fetch(url)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const json = (await response.json()) as TaskEvent[]
      setEvents(json)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch events'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  // -------------------------------------------------------------------------
  // SSE subscription: listen for task-event + heartbeat
  // -------------------------------------------------------------------------

  useEffect(() => {
    // Fetch initial events
    fetchEvents(repo)

    // Open SSE connection
    const eventSource = new EventSource('/events')
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      setConnected(true)
    }

    eventSource.onerror = () => {
      setConnected(false)
    }

    // Append new task events in real-time
    eventSource.addEventListener('task-event', (event: MessageEvent) => {
      try {
        const incoming = JSON.parse(event.data as string) as TaskEvent
        setEvents((prev) => [...prev, incoming])
      } catch {
        // Malformed SSE data — skip silently
      }
    })

    // Heartbeat keeps connection alive — track connected state
    eventSource.addEventListener('heartbeat', () => {
      setConnected(true)
    })

    return () => {
      eventSource.close()
      eventSourceRef.current = null
      setConnected(false)
    }
  }, [repo, fetchEvents])

  return { events, loading, error, connected }
}
