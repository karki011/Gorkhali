// =============================================================================
// Straw Hat Board — StatusBadge (Pirate-themed task status pill)
// Author: Subash Karki
//
// Small colored pill showing pirate status label for task statuses.
// Uses CSS custom properties for colors with an optional pulse animation
// for active (in_progress) tasks.
// =============================================================================

import { motion } from 'motion/react'
import type { TaskStatus } from '../types.ts'

// ---------------------------------------------------------------------------
// Status configuration — pirate labels + color mapping
// ---------------------------------------------------------------------------

interface StatusConfig {
  label: string
  color: string
  bg: string
}

const STATUS_CONFIG: Record<TaskStatus, StatusConfig> = {
  in_progress: { label: 'Sailing',    color: 'var(--orange)', bg: 'var(--orange-subtle)' },
  pending:     { label: 'Anchored',   color: 'var(--accent)', bg: 'rgba(88,166,255,0.12)' },
  completed:   { label: 'Conquered',  color: 'var(--green)',  bg: 'var(--green-subtle)' },
  cancelled:   { label: 'Abandoned',  color: 'var(--muted)',  bg: 'var(--red-subtle)' },
}

// ---------------------------------------------------------------------------
// StatusBadge
// ---------------------------------------------------------------------------

export const StatusBadge = ({ status }: { status: TaskStatus }) => {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
  const isSailing = status === 'in_progress'

  return (
    <motion.span
      animate={isSailing ? { opacity: [1, 0.6, 1] } : undefined}
      transition={isSailing ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        padding: '2px 10px',
        borderRadius: 12,
        fontSize: 13,
        fontWeight: 600,
        background: config.bg,
        color: config.color,
        boxShadow: `inset 0 0 0 1px ${config.color}20`,
        whiteSpace: 'nowrap',
        letterSpacing: 0.5,
        minWidth: 72,
        textAlign: 'center' as const,
      }}
    >
      {isSailing && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: config.color,
            flexShrink: 0,
          }}
        />
      )}
      {config.label}
    </motion.span>
  )
}
