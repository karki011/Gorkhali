// =============================================================================
// Phantom Works Board — Crew Roster (Bento Card Grid + Detail Popover)
// Author: Subash Karki
// =============================================================================

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { CREW, CREW_DETAILS, type CrewMember } from '../data/crew.ts'

// ---------------------------------------------------------------------------
// Type badge config
// ---------------------------------------------------------------------------

const TYPE_CONFIG: Record<CrewMember['type'], { label: string; bg: string; color: string; border: string; dashed: boolean }> = {
  coordinator: { label: 'Coordinator', bg: 'var(--orange-subtle)', color: 'var(--orange)', border: 'var(--orange)', dashed: false },
  core:        { label: 'Core Crew',   bg: 'rgba(88,166,255,0.12)', color: 'var(--accent)', border: 'var(--accent)', dashed: false },
  marine:      { label: 'Marine',      bg: 'var(--purple-subtle)', color: 'var(--purple)', border: 'var(--purple)', dashed: false },
  ally:        { label: 'Grand Fleet', bg: 'transparent', color: 'var(--muted)', border: 'var(--muted)', dashed: true },
}

const MODEL_COLORS: Record<string, string> = {
  opus: 'var(--orange)',
  sonnet: 'var(--accent)',
  haiku: 'var(--green)',
}

const GROUP_ORDER: { type: CrewMember['type']; title: string }[] = [
  { type: 'coordinator', title: 'Coordinator' },
  { type: 'core', title: 'Core Crew' },
  { type: 'marine', title: 'Marines' },
  { type: 'ally', title: 'Grand Fleet Allies' },
]

// ---------------------------------------------------------------------------
// Detail Popover
// ---------------------------------------------------------------------------

const DetailPopover = ({ member, onClose, anchorRect }: { member: CrewMember; onClose: () => void; anchorRect: DOMRect | null }) => {
  const ref = useRef<HTMLDivElement>(null)
  const detail = CREW_DETAILS[member.name]
  const config = TYPE_CONFIG[member.type]

  // Position next to trigger card
  const popoverStyle: React.CSSProperties = anchorRect ? {
    position: 'fixed',
    top: Math.min(anchorRect.top, window.innerHeight - 420),
    left: Math.min(anchorRect.right + 12, window.innerWidth - 440),
    zIndex: 200,
  } : {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: 200,
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyHandler) }
  }, [onClose])

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.9, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 10 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      style={{
        ...popoverStyle,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-lg)',
        padding: 28,
        maxWidth: 420,
        width: 400,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <div style={{
          fontSize: 42,
          width: 64,
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          background: member.color,
          border: '2px solid var(--border)',
          flexShrink: 0,
        }}>
          {member.emoji}
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{member.name}</div>
          <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 2 }}>{member.role}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <span style={{
              fontSize: 14, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
              background: config.bg, color: config.color,
              border: `1px ${config.dashed ? 'dashed' : 'solid'} ${config.border}33`,
            }}>
              {config.label}
            </span>
            {detail && (
              <span style={{
                fontSize: 14, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                background: 'var(--bg)', color: MODEL_COLORS[detail.model] ?? 'var(--muted)',
                border: '1px solid var(--border)',
                fontFamily: "'Fira Code', monospace",
              }}>
                {detail.model}
              </span>
            )}
          </div>
        </div>
      </div>

      {detail && (
        <>
          {/* Description */}
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 14 }}>
            {detail.desc}
          </p>

          {/* Owns */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Owns
            </div>
            <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.5 }}>
              {detail.owns}
            </div>
          </div>

          {/* Skills */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Skills
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {detail.skills.split(',').map(s => (
                <span key={s.trim()} style={{
                  fontSize: 13, padding: '2px 8px', borderRadius: 6,
                  background: 'var(--bg)', color: 'var(--accent)',
                  border: '1px solid var(--border)',
                  fontFamily: "'Fira Code', monospace",
                }}>
                  {s.trim()}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: 12, right: 12,
          width: 28, height: 28, borderRadius: '50%',
          border: '1px solid var(--border)', background: 'var(--bg)',
          color: 'var(--muted)', fontSize: 14, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 150ms',
        }}
        aria-label="Close"
      >
        ×
      </button>
    </motion.div>
  )
}

// Backdrop
const Backdrop = ({ onClick }: { onClick: () => void }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    onClick={onClick}
    style={{
      position: 'fixed', inset: 0, zIndex: 199,
      background: 'rgba(0,0,0,0.5)',
      backdropFilter: 'blur(2px)',
    }}
  />
)

// ---------------------------------------------------------------------------
// Crew Card
// ---------------------------------------------------------------------------

const CrewCard = ({ member, index, onClick }: { member: CrewMember; index: number; onClick: (e: React.MouseEvent) => void }) => {
  const detail = CREW_DETAILS[member.name]
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.04, duration: 0.3, ease: 'easeOut' }}
      whileHover={{ scale: 1.02, boxShadow: '0 8px 24px rgba(0,0,0,0.3)', borderColor: 'var(--orange)' }}
      onClick={onClick}
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 8,
        cursor: 'pointer',
        transition: 'all 200ms ease',
      }}
    >
      <div style={{ fontSize: 36, marginBottom: 2 }}>{member.emoji}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{member.name}</div>
      <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.4, maxWidth: 150 }}>
        {member.role}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{
          fontSize: 14, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
          background: TYPE_CONFIG[member.type].bg, color: TYPE_CONFIG[member.type].color,
          border: `1px ${TYPE_CONFIG[member.type].dashed ? 'dashed' : 'solid'} ${TYPE_CONFIG[member.type].border}33`,
        }}>
          {TYPE_CONFIG[member.type].label}
        </span>
        {detail && (
          <span style={{
            fontSize: 12, fontWeight: 600, padding: '2px 7px', borderRadius: 8,
            background: 'var(--bg)', color: MODEL_COLORS[detail.model] ?? 'var(--muted)',
            border: '1px solid var(--border)',
            fontFamily: "'Fira Code', monospace",
          }}>
            {detail.model}
          </span>
        )}
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Crew Roster (exported)
// ---------------------------------------------------------------------------

export const CrewRoster = () => {
  const [selected, setSelected] = useState<CrewMember | null>(null)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const crewEntries = Object.entries(CREW)
  let globalIndex = 0

  return (
    <div style={{ padding: 24 }}>
      {GROUP_ORDER.map(group => {
        const members = crewEntries.filter(([, m]) => m.type === group.type)
        if (members.length === 0) return null

        return (
          <div key={group.type} style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <h3 style={{
                fontSize: 14, fontWeight: 700,
                color: TYPE_CONFIG[group.type].color,
                textTransform: 'uppercase', letterSpacing: 1,
              }}>
                {group.title}
              </h3>
              <span style={{
                fontSize: 13, fontWeight: 600, color: 'var(--muted)',
                background: 'var(--bg)', padding: '1px 6px', borderRadius: 8,
              }}>
                {members.length}
              </span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 16,
            }}>
              {members.map(([key, member]) => {
                const idx = globalIndex++
                return (
                  <CrewCard
                    key={key}
                    member={member}
                    index={idx}
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      setAnchorRect(rect)
                      setSelected(member)
                    }}
                  />
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Detail popover */}
      <AnimatePresence>
        {selected && (
          <>
            <Backdrop onClick={() => setSelected(null)} />
            <DetailPopover member={selected} onClose={() => setSelected(null)} anchorRect={anchorRect} />
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
