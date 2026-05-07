// =============================================================================
// Phantom Works Board — SessionDivider (Visual separator between sessions)
// Author: Subash Karki
//
// Clickable divider between sessions showing wave emoji, ticket/label,
// time range, and task count summary. Toggles session collapse.
// =============================================================================

import { motion } from 'motion/react'
import type { MaterializedSession } from '../types.ts'

// ---------------------------------------------------------------------------
// Time formatting helpers
// ---------------------------------------------------------------------------

const formatDuration = (startIso: string, endIso: string): string => {
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime()
  const diffMs = end - start

  if (diffMs < 0) return ''

  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`

  const days = Math.floor(hours / 24)
  return `${days}d`
}

// ---------------------------------------------------------------------------
// SessionDivider
// ---------------------------------------------------------------------------

interface SessionDividerProps {
  session: MaterializedSession
  expanded: boolean
  onToggle: () => void
}

export const SessionDivider = ({ session, expanded, onToggle }: SessionDividerProps) => {
  const { stats } = session
  const duration = session.startedAt && session.lastActivityAt
    ? formatDuration(session.startedAt, session.lastActivityAt)
    : ''

  // Build a compact info string: "CP-39332 · Add Client Secret · 12 tasks · 1h ago"
  const label = session.label ?? (session.ticket ? '' : `Session ${session.sessionId}`)

  return (
    <button
      onClick={onToggle}
      aria-expanded={expanded}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 12px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        transition: 'background 150ms ease-out',
        position: 'relative',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--card)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {/* Left line */}
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />

      {/* Expand chevron */}
      <motion.span
        animate={{ rotate: expanded ? 90 : 0 }}
        transition={{ duration: 0.15 }}
        style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}
      >
        ▶
      </motion.span>

      {/* Compact session info */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexShrink: 0,
          fontSize: 13,
          color: 'var(--muted)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {session.ticket && (
          <span
            style={{
              fontWeight: 700,
              color: 'var(--accent)',
              fontFamily: "'Fira Code', monospace",
              fontSize: 13,
            }}
          >
            {session.ticket}
          </span>
        )}

        {session.ticket && label && <span style={{ opacity: 0.4 }}>·</span>}

        {label && (
          <span
            style={{
              fontWeight: 500,
              color: 'var(--text-secondary)',
              maxWidth: 200,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </span>
        )}

        <span style={{ opacity: 0.4 }}>·</span>
        <span style={{ fontWeight: 600 }}>{stats.total} tasks</span>

        {duration && (
          <>
            <span style={{ opacity: 0.4 }}>·</span>
            <span style={{ fontWeight: 500 }}>{duration}</span>
          </>
        )}
      </div>

      {/* Right line */}
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </button>
  )
}
