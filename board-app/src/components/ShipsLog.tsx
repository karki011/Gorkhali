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
          fontSize: 13,
          flexShrink: 0,
        }}
        title={crew?.name ?? task.crew ?? undefined}
      >
        {crew?.emoji ?? '🤖'}
      </div>

      {/* Crew name */}
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', minWidth: 60, flexShrink: 0 }}>
        {crew?.name ?? task.crew ?? '—'}
      </span>

      {/* Task subject */}
      <span
        style={{
          fontSize: 12,
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
          fontSize: 10,
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
    return [...session.tasks].sort((a, b) => {
      if (a.status === 'in_progress' && b.status !== 'in_progress') return -1
      if (b.status === 'in_progress' && a.status !== 'in_progress') return 1
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
      {/* Card Header — clickable */}
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
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
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        {/* Chevron */}
        <motion.span
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}
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
              fontSize: 11,
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
              fontSize: 12,
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
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--orange)', background: 'var(--orange-subtle)', padding: '1px 6px', borderRadius: 8, fontVariantNumeric: 'tabular-nums' }}>
              {stats.inProgress} active
            </span>
          )}
          {stats.completed > 0 && (
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--green)', background: 'var(--green-subtle)', padding: '1px 6px', borderRadius: 8, fontVariantNumeric: 'tabular-nums' }}>
              {stats.completed} done
            </span>
          )}
          {stats.pending > 0 && (
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--blue)', background: 'var(--blue-subtle)', padding: '1px 6px', borderRadius: 8, fontVariantNumeric: 'tabular-nums' }}>
              {stats.pending} pending
            </span>
          )}
          <span style={{ fontSize: 10, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
            {stats.total}
          </span>
        </div>

        {/* Duration */}
        {duration && (
          <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            {duration}
          </span>
        )}
      </button>

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
                <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
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
    <div style={{ fontSize: 13, color: 'var(--muted)', background: 'var(--card)', padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontFamily: "'Fira Code', monospace" }}>
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

  // Filter out Luffy coordination tasks by default
  const [showCaptainTasks, setShowCaptainTasks] = useState(false)

  const filteredSessions = useMemo(() => {
    if (showCaptainTasks) return sessions

    return sessions
      .map((session) => {
        const filtered = session.tasks.filter((t) => t.crew?.toLowerCase() !== 'luffy')
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
  }, [sessions, showCaptainTasks])

  if (loading) return <LoadingSkeleton />
  if (error) return <ErrorState message={error} />
  if (sessions.length === 0) return <EmptyState />

  return (
    <div style={{ display: 'flex', gap: 16, padding: 24, minHeight: 'calc(100vh - 160px)', alignItems: 'flex-start' }}>
      {/* Left panel — Session accordion cards (70%) */}
      <div style={{ flex: 7, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        {/* Captain toggle */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
          <button
            onClick={() => setShowCaptainTasks((v) => !v)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '3px 10px',
              borderRadius: 20,
              border: '1px solid var(--border)',
              background: showCaptainTasks ? 'var(--orange-subtle)' : 'transparent',
              color: showCaptainTasks ? 'var(--orange)' : 'var(--muted)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 150ms ease-out',
            }}
          >
            <span style={{ fontSize: 13 }}>👒</span>
            {showCaptainTasks ? 'Hide' : 'Show'} captain's tasks
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
