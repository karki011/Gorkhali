// =============================================================================
// Straw Hat Board — StatsBar (Session task count badges)
// Author: Subash Karki
//
// Horizontal flex layout of four stat badges showing task counts
// by status category. Uses pirate-themed labels.
// =============================================================================

import type { SessionStats } from '../types.ts'

// ---------------------------------------------------------------------------
// Stat badge config
// ---------------------------------------------------------------------------

interface StatDef {
  key: keyof Omit<SessionStats, 'total'>
  label: string
  icon: string
  color: string
  bg: string
}

const STAT_DEFS: StatDef[] = [
  { key: 'inProgress', label: 'Sailing',   icon: '⛵', color: 'var(--orange)', bg: 'var(--orange-subtle)' },
  { key: 'pending',    label: 'Anchored',  icon: '⚓', color: 'var(--accent)', bg: 'rgba(88,166,255,0.12)' },
  { key: 'completed',  label: 'Conquered', icon: '🏴', color: 'var(--green)',  bg: 'var(--green-subtle)' },
  { key: 'cancelled',  label: 'Abandoned', icon: '💀', color: 'var(--muted)',  bg: 'var(--red-subtle)' },
]

// ---------------------------------------------------------------------------
// StatsBar
// ---------------------------------------------------------------------------

export const StatsBar = ({ stats }: { stats: SessionStats }) => (
  <div
    style={{
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap',
    }}
  >
    {/* Total badge — stacked */}
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px 14px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--card)',
        border: '1px solid var(--border)',
        minWidth: 60,
      }}
    >
      <span
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: 'var(--text)',
          lineHeight: 1.2,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {stats.total}
      </span>
      <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}>Total</span>
    </div>

    {/* Per-status badges — stacked */}
    {STAT_DEFS.map(({ key, label, icon, color, bg }) => {
      const count = stats[key]
      if (count === 0) return null

      return (
        <div
          key={key}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px 14px',
            borderRadius: 'var(--radius-sm)',
            background: bg,
            boxShadow: `inset 0 0 0 1px ${color}18`,
            minWidth: 60,
          }}
        >
          <span
            style={{
              fontSize: 20,
              fontWeight: 700,
              color,
              lineHeight: 1.2,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {count}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color,
              opacity: 0.8,
              display: 'flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <span style={{ fontSize: 12 }}>{icon}</span>
            {label}
          </span>
        </div>
      )
    })}
  </div>
)
