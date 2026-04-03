// =============================================================================
// Straw Hat Board — EventCard (Task card in the timeline)
// Author: Subash Karki
//
// A single task card showing crew emoji, task description, pirate status
// badge, and relative timestamp. Active tasks pulse, completed dim.
// =============================================================================

import { useState } from 'react'
import { motion } from 'motion/react'
import { CREW } from '../data/crew.ts'
import { StatusBadge } from './StatusBadge.tsx'
import type { MaterializedTask } from '../types.ts'

// ---------------------------------------------------------------------------
// Relative time formatter
// ---------------------------------------------------------------------------

const formatRelativeTime = (isoString: string): string => {
  const now = Date.now()
  const then = new Date(isoString).getTime()
  const diffMs = now - then

  if (diffMs < 0) return 'just now'

  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ---------------------------------------------------------------------------
// Crew resolver
// ---------------------------------------------------------------------------

const resolveCrewMember = (name: string | null) => {
  if (!name) return null
  const member = CREW[name] ?? CREW[name.charAt(0).toUpperCase() + name.slice(1)]
  return member ?? null
}

// ---------------------------------------------------------------------------
// EventCard
// ---------------------------------------------------------------------------

export const EventCard = ({ task }: { task: MaterializedTask }) => {
  const [hovered, setHovered] = useState(false)
  const crew = resolveCrewMember(task.crew)
  const isActive = task.status === 'in_progress'
  const isCompleted = task.status === 'completed'
  const isCancelled = task.status === 'cancelled'
  const isDimmed = isCompleted || isCancelled

  // Resolve crew color for left border accent — stronger opacity for visibility
  const crewBorderColor = isActive
    ? 'var(--orange)'
    : crew?.color
      ? crew.color.replace(/0\.\d+\)/, '0.7)')
      : 'var(--border)'

  // Filter out "Phase:" descriptions — legacy migration artifacts
  const showDescription =
    task.description &&
    !task.description.startsWith('Phase:')

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        gap: 12,
        padding: '8px 12px',
        borderRadius: 'var(--radius-md)',
        background: hovered ? 'var(--card-hover, var(--card))' : 'var(--card)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${crewBorderColor}`,
        opacity: isDimmed ? 0.6 : 1,
        transition: 'background 150ms ease-out, border-color 150ms ease-out, opacity 150ms ease-out, box-shadow 150ms ease-out',
        cursor: 'default',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: hovered && !isDimmed ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
      }}
    >
      {/* Pulse overlay for active tasks */}
      {isActive && (
        <motion.div
          animate={{ opacity: [0, 0.08, 0] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--orange)',
            pointerEvents: 'none',
            borderRadius: 'inherit',
          }}
        />
      )}

      {/* Crew avatar */}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: crew?.color ?? 'var(--bg)',
          border: `1px solid ${crew ? 'transparent' : 'var(--border)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 15,
          flexShrink: 0,
          marginTop: 1,
        }}
        title={crew?.name ?? task.crew ?? undefined}
      >
        {crew?.emoji ?? '🤖'}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Crew name + timestamp row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 3,
          }}
        >
          <span style={{ fontSize: 14, color: crew ? 'var(--text)' : 'var(--muted)' }}>
            <span style={{ fontWeight: 600 }}>
              {crew?.name ?? task.crew ?? 'Claude'}
            </span>
            {crew && (
              <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 6, fontSize: 13 }}>
                {crew.role}
              </span>
            )}
          </span>
          <span
            style={{
              fontSize: 13,
              color: 'var(--muted)',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatRelativeTime(task.updatedAt)}
          </span>
        </div>

        {/* Task subject + status badge row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 14,
              color: isDimmed ? 'var(--muted)' : 'var(--text)',
              lineHeight: 1.5,
              textDecoration: isCancelled ? 'line-through' : 'none',
              flex: 1,
              minWidth: 0,
            }}
          >
            {task.subject}
          </div>
          <div style={{ flexShrink: 0, marginTop: 1 }}>
            <StatusBadge status={task.status} />
          </div>
        </div>

        {/* Description (truncated) — skip "Phase:" legacy artifacts */}
        {showDescription && (
          <div
            style={{
              fontSize: 13,
              color: 'var(--muted)',
              lineHeight: 1.4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: 2,
            }}
          >
            {task.description}
          </div>
        )}
      </div>
    </motion.div>
  )
}
