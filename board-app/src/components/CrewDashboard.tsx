// =============================================================================
// Straw Hat Board — CrewDashboard (Right panel stats + active crew)
// Author: Subash Karki
//
// Shows connection status, StatsBar, active crew members with their
// current tasks, and session info (ticket, duration, last activity).
// =============================================================================

import { motion } from 'motion/react'
import { CREW } from '../data/crew.ts'
import { StatsBar } from './StatsBar.tsx'
import type { MaterializedSession, MaterializedTask } from '../types.ts'

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

const formatDuration = (startIso: string): string => {
  const start = new Date(startIso).getTime()
  const now = Date.now()
  const diffMs = now - start

  if (diffMs < 0) return '0m'

  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`

  const days = Math.floor(hours / 24)
  return `${days}d`
}

// ---------------------------------------------------------------------------
// Crew resolver
// ---------------------------------------------------------------------------

const resolveCrewMember = (name: string) => {
  return CREW[name] ?? CREW[name.charAt(0).toUpperCase() + name.slice(1)] ?? null
}

// ---------------------------------------------------------------------------
// Connection indicator
// ---------------------------------------------------------------------------

const ConnectionStatus = ({ connected }: { connected: boolean }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 12px',
      borderRadius: 'var(--radius-sm)',
      background: connected ? 'var(--green-subtle)' : 'var(--red-subtle)',
      border: `1px solid ${connected ? 'var(--green)' : 'var(--red)'}22`,
      fontSize: 14,
      fontWeight: 500,
      color: connected ? 'var(--green)' : 'var(--red)',
    }}
  >
    <motion.span
      animate={connected ? { opacity: [1, 0.3, 1] } : undefined}
      transition={connected ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : undefined}
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: connected ? 'var(--green)' : 'var(--red)',
        flexShrink: 0,
      }}
    />
    {connected ? 'Live Connection' : 'Disconnected'}
  </div>
)

// ---------------------------------------------------------------------------
// Active crew card
// ---------------------------------------------------------------------------

const ActiveCrewCard = ({ crewName, tasks }: { crewName: string; tasks: MaterializedTask[] }) => {
  const member = resolveCrewMember(crewName)
  const activeTasks = tasks.filter(
    (t) => t.crew === crewName && t.status === 'in_progress',
  )

  if (activeTasks.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      style={{
        display: 'flex',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 'var(--radius-sm)',
        background: member?.color ?? 'var(--card)',
        border: '1px solid var(--border)',
        transition: 'background 150ms ease-out',
      }}
    >
      {/* Avatar + pulse dot */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <span style={{ fontSize: 20 }}>{member?.emoji ?? '🤖'}</span>
        <motion.span
          animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            position: 'absolute',
            top: -2,
            right: -4,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--green)',
            border: '2px solid var(--card)',
          }}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
          {member?.name ?? crewName}
        </div>
        {activeTasks.map((task) => (
          <div
            key={task.id}
            style={{
              fontSize: 13,
              color: 'var(--text-secondary)',
              lineHeight: 1.4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {task.subject}
          </div>
        ))}
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Empty dashboard
// ---------------------------------------------------------------------------

const EmptyDashboard = ({ connected }: { connected: boolean }) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      padding: 20,
    }}
  >
    <ConnectionStatus connected={connected} />
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        gap: 12,
      }}
    >
      <span style={{ fontSize: 36, opacity: 0.5 }}>🏴‍☠️</span>
      <span style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 500 }}>
        No active session
      </span>
      <span style={{ fontSize: 13, color: 'var(--muted)' }}>
        Waiting for crew to set sail...
      </span>
    </div>
  </div>
)

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

const SectionHeader = ({ icon, label }: { icon: string; label: string }) => (
  <div
    style={{
      fontSize: 13,
      fontWeight: 700,
      color: 'var(--muted)',
      textTransform: 'uppercase',
      letterSpacing: 1,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      marginTop: 4,
      paddingTop: 12,
      borderTop: '1px solid var(--border)',
    }}
  >
    <span style={{ fontSize: 14 }}>{icon}</span>
    {label}
  </div>
)

// ---------------------------------------------------------------------------
// CrewDashboard
// ---------------------------------------------------------------------------

interface CrewDashboardProps {
  session: MaterializedSession | null
  connected: boolean
}

export const CrewDashboard = ({ session, connected }: CrewDashboardProps) => {
  if (!session) return <EmptyDashboard connected={connected} />

  const activeCrewNames = session.crewActive.filter((name) =>
    session.tasks.some((t) => t.crew === name && t.status === 'in_progress'),
  )

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: 16,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        height: '100%',
        overflowY: 'auto',
      }}
    >
      {/* Connection status */}
      <ConnectionStatus connected={connected} />

      {/* Stats */}
      <StatsBar stats={session.stats} />

      {/* Active crew — only when tasks are sailing */}
      {activeCrewNames.length > 0 ? (
        <>
          <SectionHeader icon="👥" label="Active Crew" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activeCrewNames.map((name) => (
              <ActiveCrewCard key={name} crewName={name} tasks={session.tasks} />
            ))}
          </div>

          {/* Session info — only show when actively sailing */}
          <SectionHeader icon="📋" label="Session Info" />
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              fontSize: 14,
              color: 'var(--text-secondary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {session.ticket && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--muted)', fontSize: 14 }}>Ticket</span>
                <span
                  style={{
                    fontWeight: 600,
                    color: 'var(--accent)',
                    fontFamily: "'Fira Code', monospace",
                    fontSize: 14,
                  }}
                >
                  {session.ticket}
                </span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--muted)', fontSize: 14 }}>Duration</span>
              <span style={{ fontWeight: 600 }}>
                {session.startedAt ? formatDuration(session.startedAt) : '—'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--muted)', fontSize: 14 }}>Last Activity</span>
              <span style={{ fontWeight: 600 }}>
                {session.lastActivityAt ? formatRelativeTime(session.lastActivityAt) : '—'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--muted)', fontSize: 14 }}>Crew Members</span>
              <span style={{ fontWeight: 600 }}>{session.crewActive.length}</span>
            </div>
          </div>
        </>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 32,
            gap: 10,
          }}
        >
          <span style={{ fontSize: 36, opacity: 0.5 }}>💤</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--muted)' }}>
            Crew at rest
          </span>
          <span style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.5 }}>
            No active tasks. Run <code style={{ color: 'var(--orange)', fontFamily: "'Fira Code', monospace" }}>/team:start</code> to begin.
          </span>
        </div>
      )}
    </div>
  )
}
