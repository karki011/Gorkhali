// =============================================================================
// Straw Hat Board — Data Fetching Hooks (Event-Sourced)
// Author: Subash Karki
//
// Plain fetch hooks. Vite proxy forwards /api/* and /events to :3847.
// No TanStack Query — this is a lightweight standalone board app.
//
// Removed: useSessionState, useActiveSessions, useCompletedSessions, useSSE
// These are replaced by useTaskEvents + useSessionMaterializer.
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import type {
  StoryData,
  LearningsData,
  DecisionsData,
  ContractsData,
} from '../types.ts'

// ---------------------------------------------------------------------------
// URL builder — appends ?repo= and &session= query params
// ---------------------------------------------------------------------------

const buildUrl = (path: string, repo?: string, session?: string | null): string => {
  const params = new URLSearchParams()
  if (repo) params.set('repo', repo)
  if (session) params.set('session', session)
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

// ---------------------------------------------------------------------------
// Generic fetch hook
// ---------------------------------------------------------------------------

interface FetchResult<T> {
  data: T
  loading: boolean
  error: string | null
  refetch: () => void
}

const useFetch = <T>(url: string, initialValue: T): FetchResult<T> => {
  const [data, setData] = useState<T>(initialValue)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(url)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const json = (await response.json()) as T
      setData(json)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown fetch error'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [url])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, loading, error, refetch: fetchData }
}

// ---------------------------------------------------------------------------
// Story
// ---------------------------------------------------------------------------

interface StoryResult {
  story: StoryData | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export const useStory = (): StoryResult => {
  const { data, loading, error, refetch } = useFetch<StoryData | null>('/api/story', null)
  return { story: data, loading, error, refetch }
}

// ---------------------------------------------------------------------------
// Learnings — now returns Record<string, string> (domain files)
// ---------------------------------------------------------------------------

interface LearningsResult {
  learnings: LearningsData | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export const useLearnings = (repo?: string): LearningsResult => {
  const { data, loading, error, refetch } = useFetch<LearningsData | null>(buildUrl('/api/learnings', repo), null)
  return { learnings: data, loading, error, refetch }
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

interface DecisionsResult {
  decisions: DecisionsData | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export const useDecisions = (repo?: string): DecisionsResult => {
  const { data, loading, error, refetch } = useFetch<DecisionsData | null>(buildUrl('/api/decisions', repo), null)
  return { decisions: data, loading, error, refetch }
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

interface ContractsResult {
  contracts: ContractsData | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export const useContracts = (repo?: string, session?: string | null): ContractsResult => {
  const { data, loading, error, refetch } = useFetch<ContractsData | null>(buildUrl('/api/contracts', repo, session), null)
  return { contracts: data, loading, error, refetch }
}

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

interface ReposResult {
  repos: string[]
  loading: boolean
  error: string | null
}

export const useRepos = (): ReposResult => {
  const { data, loading, error } = useFetch<string[]>('/api/repos', [])
  return { repos: data, loading, error }
}

// ---------------------------------------------------------------------------
// Changelog
// ---------------------------------------------------------------------------

interface ChangelogResult {
  content: string
  loading: boolean
  error: string | null
}

export const useChangelog = (): ChangelogResult => {
  const { data, loading, error } = useFetch<{ content: string }>('/api/changelog', { content: '' })
  return { content: data.content, loading, error }
}
