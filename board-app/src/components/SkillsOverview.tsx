// =============================================================================
// Phantom Works Board — Skills Overview
// Author: Subash Karki
//
// Grouped card grid of all /team:* slash commands.
// Follows CrewRoster bento-card layout + motion stagger pattern.
// =============================================================================

import { motion } from 'motion/react'
import { SKILLS, type Skill } from '../data/skills.ts'

// ---------------------------------------------------------------------------
// Category config
// ---------------------------------------------------------------------------

const CATEGORY_CONFIG: Record<Skill['category'], { label: string; icon: string; color: string; bg: string }> = {
  workflow: { label: 'Workflow',  icon: '🔄', color: 'var(--accent)',  bg: 'rgba(88,166,255,0.12)' },
  quality:  { label: 'Quality',  icon: '✅', color: 'var(--green)',   bg: 'var(--green-subtle)'   },
  board:    { label: 'Board',    icon: '📊', color: 'var(--orange)',  bg: 'var(--orange-subtle)'  },
  session:  { label: 'Session',  icon: '⏱',  color: 'var(--purple)',  bg: 'var(--purple-subtle)'  },
}

const CATEGORY_ORDER: Skill['category'][] = ['workflow', 'quality', 'board', 'session']

// ---------------------------------------------------------------------------
// Skill Card
// ---------------------------------------------------------------------------

const SkillCard = ({ skill, index }: { skill: Skill; index: number }) => {
  const cfg = CATEGORY_CONFIG[skill.category]

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.04, duration: 0.25, ease: 'easeOut' }}
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* Command pill */}
      <div>
        <span
          style={{
            fontFamily: "'Fira Code', monospace",
            fontSize: 12,
            fontWeight: 700,
            padding: '3px 10px',
            borderRadius: 8,
            background: cfg.bg,
            color: cfg.color,
            border: `1px solid ${cfg.color}33`,
            letterSpacing: 0.3,
            display: 'inline-block',
          }}
        >
          {skill.command}
        </span>
      </div>

      {/* Name */}
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
        {skill.name}
      </div>

      {/* Description */}
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
        {skill.description}
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Skills Overview (exported)
// ---------------------------------------------------------------------------

export const SkillsOverview = () => {
  let globalIndex = 0

  return (
    <div style={{ padding: 24 }}>
      {/* Page header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        style={{ marginBottom: 28 }}
      >
        <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>
          Skills Overview
        </h2>
        <p style={{ fontSize: 14, color: 'var(--muted)' }}>
          All <code style={{ fontFamily: "'Fira Code', monospace", fontSize: 13, color: 'var(--orange)' }}>/team:*</code> commands at a glance — {SKILLS.length} skills total
        </p>
      </motion.div>

      {/* Category sections */}
      {CATEGORY_ORDER.map(category => {
        const skills = SKILLS.filter(s => s.category === category)
        const cfg = CATEGORY_CONFIG[category]

        return (
          <div key={category} style={{ marginBottom: 32 }}>
            {/* Section header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 16 }}>{cfg.icon}</span>
              <h3
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: cfg.color,
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                }}
              >
                {cfg.label}
              </h3>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--muted)',
                  background: 'var(--bg)',
                  padding: '1px 7px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                }}
              >
                {skills.length}
              </span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>

            {/* Card grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 14,
              }}
            >
              {skills.map(skill => {
                const idx = globalIndex++
                return <SkillCard key={skill.command} skill={skill} index={idx} />
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
