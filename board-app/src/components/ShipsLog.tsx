// =============================================================================
// Straw Hat Board — Ship's Log (Accordion session cards + crew dashboard)
// Author: Subash Karki
//
// Main 2-panel view. Left panel shows sessions as accordion cards — each card
// has a header with ticket/label/stats, and expands to show task rows inside.
// Right panel shows CrewDashboard with current session stats.
// =============================================================================

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useBoardContext } from '../App.tsx'
import { useTaskEvents } from '../hooks/useTaskEvents.ts'
import { useMaterializedSessions } from '../hooks/useSessionMaterializer.ts'
import { CrewDashboard } from './CrewDashboard.tsx'
import { StatusBadge } from './StatusBadge.tsx'
import { CREW } from '../data/crew.ts'
import type { MaterializedSession, MaterializedTask } from '../types.ts'

// ---------------------------------------------------------------------------
// Relative time
// ---------------------------------------------------------------------------

const relativeTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const formatDuration = (start: string, end: string): string => {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 0) return ''
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d`
}

// ---------------------------------------------------------------------------
// Task Row (compact row inside accordion card)
// ---------------------------------------------------------------------------

const TaskRow = ({ task }: { task: MaterializedTask }) => {
  const [hovered, setHovered] = useState(false)
  const crew = task.crew ? (CREW[task.crew] ?? CREW[task.crew.charAt(0).toUpperCase() + task.crew.slice(1)]) : null
  const isActive = task.status === 'in_progress'
  const isDimmed = task.status === 'completed' || task.status === 'cancelled'

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 14px',
        borderLeft: `3px solid ${isActive ? 'var(--orange)' : crew?.color ? crew.color.replace(/0\.\d+\)/, '0.5)') : 'transparent'}`,
        background: hovered ? 'var(--bg)' : 'transparent',
        opacity: isDimmed ? 0.65 : 1,
        transition: 'background 120ms ease-out, opacity 120ms ease-out',
        position: 'relative',
      }}
    >
      {/* Active pulse */}
      {isActive && (
        <motion.div
          animate={{ opacity: [0, 0.06, 0] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          style={{ position: 'absolute', inset: 0, background: 'var(--orange)', pointerEvents: 'none' }}
        />
      )}

      {/* Crew avatar */}
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: crew?.color ?? 'var(--bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          flexShrink: 0,
        }}
        title={crew?.name ?? task.crew ?? undefined}
      >
        {crew?.emoji ?? '🤖'}
      </div>

      {/* Crew name */}
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', minWidth: 60, flexShrink: 0 }}>
        {crew?.name ?? task.crew ?? 'Claude'}
      </span>

      {/* Task subject */}
      <span
        style={{
          fontSize: 13,
          color: isDimmed ? 'var(--muted)' : 'var(--text)',
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textDecoration: task.status === 'cancelled' ? 'line-through' : 'none',
        }}
      >
        {task.subject}
      </span>

      {/* Status badge */}
      <div style={{ flexShrink: 0 }}>
        <StatusBadge status={task.status} />
      </div>

      {/* Time */}
      <span
        style={{
          fontSize: 12,
          color: 'var(--muted)',
          flexShrink: 0,
          fontVariantNumeric: 'tabular-nums',
          minWidth: 48,
          textAlign: 'right',
        }}
      >
        {relativeTime(task.updatedAt)}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Session Accordion Card
// ---------------------------------------------------------------------------

interface SessionCardProps {
  session: MaterializedSession
  defaultExpanded: boolean
}

const SessionCard = ({ session, defaultExpanded }: SessionCardProps) => {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const { stats } = session
  const hasActive = stats.inProgress > 0
  const duration = formatDuration(session.startedAt, session.lastActivityAt)

  const label = session.label ?? (session.ticket ? '' : `Session ${session.sessionId}`)

  // Sort: active first, then by updatedAt desc
  const sortedTasks = useMemo(() => {
    // Sort priority: 1) Sailing first, 2) crew tasks before anonymous, 3) pending before completed, 4) newest first
    const statusOrder: Record<string, number> = { in_progress: 0, pending: 1, completed: 2, cancelled: 3 }
    return [...session.tasks].sort((a, b) => {
      // Active tasks always first
      const sa = statusOrder[a.status] ?? 9
      const sb = statusOrder[b.status] ?? 9
      if (sa !== sb) return sa - sb
      // Within same status: crew tasks before anonymous
      const aCrew = a.crew ? 0 : 1
      const bCrew = b.crew ? 0 : 1
      if (aCrew !== bCrew) return aCrew - bCrew
      // Within same group: newest first
      return b.updatedAt.localeCompare(a.updatedAt)
    })
  }, [session.tasks])

  return (
    <div
      style={{
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${hasActive ? 'var(--orange)' : 'var(--border)'}`,
        background: 'var(--card)',
        overflow: 'hidden',
        transition: 'border-color 200ms ease-out',
      }}
    >
      {/* Card Header — clickable but text selectable */}
      <div
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded((v) => !v) } }}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          transition: 'background 150ms ease-out',
          userSelect: 'text',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        {/* Chevron */}
        <motion.span
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}
        >
          ▶
        </motion.span>

        {/* Active indicator */}
        {hasActive && (
          <motion.div
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: 'var(--orange)',
              flexShrink: 0,
            }}
          />
        )}

        {/* Ticket badge */}
        {session.ticket && (
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--orange)',
              fontFamily: "'Fira Code', monospace",
              flexShrink: 0,
            }}
          >
            {session.ticket}
          </span>
        )}

        {/* Label */}
        {label && (
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text)',
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textAlign: 'left',
            }}
          >
            {label}
          </span>
        )}

        {!label && <div style={{ flex: 1 }} />}

        {/* Stats pills */}
        <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
          {stats.inProgress > 0 && (
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--orange)', background: 'var(--orange-subtle)', padding: '1px 6px', borderRadius: 8, fontVariantNumeric: 'tabular-nums' }}>
              {stats.inProgress} active
            </span>
          )}
          {stats.completed > 0 && (
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)', background: 'var(--green-subtle)', padding: '1px 6px', borderRadius: 8, fontVariantNumeric: 'tabular-nums' }}>
              {stats.completed} done
            </span>
          )}
          {stats.pending > 0 && (
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--blue)', background: 'var(--blue-subtle)', padding: '1px 6px', borderRadius: 8, fontVariantNumeric: 'tabular-nums' }}>
              {stats.pending} pending
            </span>
          )}
          <span style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
            {stats.total}
          </span>
        </div>

        {/* Duration */}
        {duration && (
          <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            {duration}
          </span>
        )}
      </div>

      {/* Card Body — task rows */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div
              style={{
                borderTop: '1px solid var(--border)',
                paddingTop: 4,
                paddingBottom: 4,
              }}
            >
              {sortedTasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
              {sortedTasks.length === 0 && (
                <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>
                  No crew tasks in this session
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading / Empty / Error states
// ---------------------------------------------------------------------------

const LoadingSkeleton = () => (
  <div style={{ display: 'flex', gap: 16, padding: 24, height: 600 }}>
    <div style={{ flex: 7, background: 'var(--card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', animation: 'shipslog-pulse 1.5s ease-in-out infinite' }} />
    <div style={{ flex: 3, background: 'var(--card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', animation: 'shipslog-pulse 1.5s ease-in-out infinite', animationDelay: '0.2s' }} />
    <style>{`@keyframes shipslog-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>
  </div>
)

const EmptyState = () => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 64, gap: 16 }}>
    <div style={{ fontSize: 48, opacity: 0.5 }}>📜</div>
    <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--muted)' }}>No entries in the Ship's Log</div>
    <div style={{ fontSize: 14, color: 'var(--muted)', background: 'var(--card)', padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontFamily: "'Fira Code', monospace" }}>
      Run <span style={{ color: 'var(--orange)', fontWeight: 600 }}>/team:start</span> to begin a voyage.
    </div>
  </div>
)

const ErrorState = ({ message }: { message: string }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 48, gap: 12 }}>
    <div style={{ fontSize: 36 }}>⚠</div>
    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--red)' }}>Failed to load ship's log</div>
    <div style={{ fontSize: 14, color: 'var(--muted)' }}>{message}</div>
  </div>
)

// ---------------------------------------------------------------------------
// Ship's Log (exported)
// ---------------------------------------------------------------------------

export const ShipsLog = () => {
  const { repo } = useBoardContext()
  const { events, loading, error, connected } = useTaskEvents(repo)
  const sessions = useMaterializedSessions(events)

  // Filters
  const [showCaptainTasks, setShowCaptainTasks] = useState(false)
  type StatusFilter = 'all' | 'in_progress' | 'pending' | 'completed' | 'cancelled'
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // Compute global stats across all sessions (before filtering)
  const globalStats = useMemo(() => {
    const all = sessions.flatMap((s) => s.tasks)
    return {
      total: all.length,
      inProgress: all.filter((t) => t.status === 'in_progress').length,
      pending: all.filter((t) => t.status === 'pending').length,
      completed: all.filter((t) => t.status === 'completed').length,
      cancelled: all.filter((t) => t.status === 'cancelled').length,
    }
  }, [sessions])

  const filteredSessions = useMemo(() => {
    return sessions
      .map((session) => {
        let filtered = session.tasks
        // Captain filter
        if (!showCaptainTasks) {
          filtered = filtered.filter((t) => t.crew?.toLowerCase() !== 'luffy')
        }
        // Status filter
        if (statusFilter !== 'all') {
          filtered = filtered.filter((t) => t.status === statusFilter)
        }
        return {
          ...session,
          tasks: filtered,
          stats: {
            total: filtered.length,
            inProgress: filtered.filter((t) => t.status === 'in_progress').length,
            pending: filtered.filter((t) => t.status === 'pending').length,
            completed: filtered.filter((t) => t.status === 'completed').length,
            cancelled: filtered.filter((t) => t.status === 'cancelled').length,
          },
        }
      })
      .filter((s) => s.tasks.length > 0)
  }, [sessions, showCaptainTasks, statusFilter])

  if (loading) return <LoadingSkeleton />
  if (error) return <ErrorState message={error} />
  if (sessions.length === 0) return <EmptyState />

  return (
    <div style={{ display: 'flex', gap: 16, padding: 24, minHeight: 'calc(100vh - 160px)', alignItems: 'flex-start' }}>
      {/* Left panel — Session accordion cards (70%) */}
      <div style={{ flex: 7, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        {/* Filter bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}>
          {/* Status filter tabs */}
          <div style={{ display: 'flex', gap: 2, background: 'var(--card)', borderRadius: 20, padding: 2, border: '1px solid var(--border)' }}>
            {([
              { key: 'all' as StatusFilter, label: 'All', icon: '📜', count: globalStats.total, color: 'var(--text)' },
              { key: 'in_progress' as StatusFilter, label: 'Sailing', icon: '⛵', count: globalStats.inProgress, color: 'var(--orange)' },
              { key: 'pending' as StatusFilter, label: 'Anchored', icon: '⚓', count: globalStats.pending, color: 'var(--blue)' },
              { key: 'completed' as StatusFilter, label: 'Conquered', icon: '🏴', count: globalStats.completed, color: 'var(--green)' },
              { key: 'cancelled' as StatusFilter, label: 'Abandoned', icon: '💀', count: globalStats.cancelled, color: 'var(--red)' },
            ]).filter((f) => f.key === 'all' || f.count > 0).map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 10px',
                  borderRadius: 18,
                  border: 'none',
                  background: statusFilter === f.key ? 'var(--bg)' : 'transparent',
                  color: statusFilter === f.key ? f.color : 'var(--muted)',
                  fontSize: 13,
                  fontWeight: statusFilter === f.key ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 150ms ease-out',
                  boxShadow: statusFilter === f.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                <span style={{ fontSize: 13 }}>{f.icon}</span>
                {f.label}
                <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, opacity: 0.7 }}>{f.count}</span>
              </button>
            ))}
          </div>

          {/* Captain toggle */}
          <button
            onClick={() => setShowCaptainTasks((v) => !v)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              borderRadius: 20,
              border: '1px solid var(--border)',
              background: showCaptainTasks ? 'var(--orange-subtle)' : 'transparent',
              color: showCaptainTasks ? 'var(--orange)' : 'var(--muted)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 150ms ease-out',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 14 }}>👒</span>
            {showCaptainTasks ? 'Hide' : 'Show'} captain
          </button>
        </div>

        {/* Session cards */}
        {filteredSessions.map((session, i) => (
          <SessionCard key={session.sessionId} session={session} defaultExpanded={i === 0} />
        ))}
      </div>

      {/* Right panel — Crew Dashboard (30%) */}
      <div style={{ flex: 3, position: 'sticky', top: 120, minWidth: 280 }}>
        <CrewDashboard session={filteredSessions[0] ?? null} connected={connected} />
      </div>
    </div>
  )
}
