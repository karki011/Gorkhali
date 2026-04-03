// =============================================================================
// Straw Hat Board — Arsenal Dashboard
// Author: Subash Karki
//
// Shows the user's full Claude Code setup: hooks, skills, plugins,
// agents (crew), memory, and configuration. Data from /api/arsenal,
// crew details from client-side crew.ts.
// =============================================================================

import { useState } from 'react'
import { motion } from 'motion/react'
import { useBoardContext } from '../App.tsx'
import { useArsenal } from '../hooks/useArsenal.ts'
import { CREW, CREW_DETAILS, type CrewMember } from '../data/crew.ts'
import type { ArsenalData } from '../types.ts'

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const cardStyle: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: '20px 22px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
}

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text)',
}

const countBadgeStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--muted)',
  background: 'var(--bg)',
  padding: '1px 8px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  fontVariantNumeric: 'tabular-nums',
}

const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: 13,
  fontWeight: 600,
  padding: '3px 10px',
  borderRadius: 8,
  fontFamily: "'Fira Code', monospace",
  letterSpacing: 0.3,
}

const monoStyle: React.CSSProperties = {
  fontFamily: "'Fira Code', monospace",
  fontSize: 12,
  color: 'var(--muted)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const subSectionLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: 0.8,
  marginBottom: 6,
}

// ---------------------------------------------------------------------------
// Event color map for hooks
// ---------------------------------------------------------------------------

const EVENT_COLORS: Record<string, { color: string; bg: string }> = {
  PreToolUse:       { color: 'var(--accent)',  bg: 'rgba(88,166,255,0.12)' },
  PostToolUse:      { color: 'var(--orange)',  bg: 'var(--orange-subtle)' },
  SessionStart:     { color: 'var(--green)',   bg: 'var(--green-subtle)' },
  Stop:             { color: 'var(--red)',     bg: 'var(--red-subtle)' },
  PreCompact:       { color: 'var(--purple)',  bg: 'var(--purple-subtle)' },
  UserPromptSubmit: { color: 'var(--accent)',  bg: 'rgba(88,166,255,0.12)' },
  Notification:     { color: 'var(--muted)',   bg: 'var(--card)' },
  PermissionRequest:{ color: 'var(--muted)',   bg: 'var(--card)' },
}

const getEventColor = (event: string) =>
  EVENT_COLORS[event] ?? { color: 'var(--muted)', bg: 'var(--card)' }

// ---------------------------------------------------------------------------
// Model badge colors (matching CrewRoster)
// ---------------------------------------------------------------------------

const MODEL_COLORS: Record<string, string> = {
  opus: 'var(--orange)',
  sonnet: 'var(--accent)',
  haiku: 'var(--green)',
}

// ---------------------------------------------------------------------------
// Section: Hooks
// ---------------------------------------------------------------------------

const HooksSection = ({ hooks }: { hooks: ArsenalData['hooks'] }) => {
  // Group by event type
  const grouped = hooks.reduce<Record<string, typeof hooks>>((acc, h) => {
    ;(acc[h.event] ??= []).push(h)
    return acc
  }, {})

  return (
    <div style={cardStyle}>
      <div style={sectionHeaderStyle}>
        <span>&#9889;</span>
        <span>Active Hooks</span>
        <span style={countBadgeStyle}>{hooks.length}</span>
      </div>

      {Object.entries(grouped).map(([event, items]) => {
        const ec = getEventColor(event)
        return (
          <div key={event} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: ec.color, textTransform: 'uppercase', letterSpacing: 0.6 }}>
              {event}
            </div>
            {items.map((hook, i) => (
              <div
                key={`${event}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 0',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                {hook.matcher && (
                  <span
                    style={{
                      ...pillStyle,
                      background: ec.bg,
                      color: ec.color,
                      border: `1px solid ${ec.color}33`,
                      flexShrink: 0,
                    }}
                  >
                    {hook.matcher}
                  </span>
                )}
                <span
                  style={{ ...monoStyle, flex: 1 }}
                  title={hook.command}
                >
                  {truncateCommand(hook.command)}
                </span>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

const truncateCommand = (cmd: string): string => {
  // Simplify long paths
  const short = cmd
    .replace(/\/Users\/[^/]+/g, '~')
    .replace(/\/home\/[^/]+/g, '~')
  return short.length > 80 ? `${short.slice(0, 77)}...` : short
}

// ---------------------------------------------------------------------------
// Section: Skills
// ---------------------------------------------------------------------------

const SkillsSection = ({ skills }: { skills: ArsenalData['skills'] }) => {
  const totalCount = skills.project.length + skills.global.length + skills.plugins.length

  return (
    <div style={cardStyle}>
      <div style={sectionHeaderStyle}>
        <span>&#128481;&#65039;</span>
        <span>Skills Arsenal</span>
        <span style={countBadgeStyle}>{totalCount}</span>
      </div>

      {/* Project Skills */}
      {skills.project.length > 0 && (
        <div>
          <div style={subSectionLabel}>Project Skills</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {skills.project.map((s) => (
              <SkillPill key={s.name} name={s.name} detail={s.path} color="var(--orange)" bg="var(--orange-subtle)" />
            ))}
          </div>
        </div>
      )}

      {/* Global Commands */}
      {skills.global.length > 0 && (
        <div>
          <div style={subSectionLabel}>Team Commands</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {skills.global.map((s) => (
              <SkillPill key={s.name} name={s.name} detail={s.path} color="var(--accent)" bg="rgba(88,166,255,0.12)" />
            ))}
          </div>
        </div>
      )}

      {/* Plugin Skills */}
      {skills.plugins.length > 0 && (
        <div>
          <div style={subSectionLabel}>Plugin Skills</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {skills.plugins.map((s) => (
              <SkillPill key={`${s.name}-${s.source}`} name={s.name} detail={s.source} color="var(--purple)" bg="var(--purple-subtle)" />
            ))}
          </div>
        </div>
      )}

      {totalCount === 0 && (
        <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>No skills found</div>
      )}
    </div>
  )
}

const SkillPill = ({ name, detail, color, bg }: { name: string; detail: string; color: string; bg: string }) => {
  const [showDetail, setShowDetail] = useState(false)

  return (
    <span
      onClick={() => setShowDetail(!showDetail)}
      style={{
        ...pillStyle,
        background: bg,
        color,
        border: `1px solid ${color}33`,
        cursor: 'pointer',
        transition: 'all 150ms ease',
        maxWidth: showDetail ? 600 : 200,
      }}
      title={detail}
    >
      {showDetail ? `${name} — ${truncateCommand(detail)}` : name}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Section: Crew Registry (client-side from crew.ts)
// ---------------------------------------------------------------------------

const GROUP_ORDER: { type: CrewMember['type']; title: string }[] = [
  { type: 'coordinator', title: 'Coordinator' },
  { type: 'core', title: 'Core Crew' },
  { type: 'marine', title: 'Marines' },
  { type: 'ally', title: 'Grand Fleet Allies' },
]

const CrewSection = () => {
  const crewEntries = Object.values(CREW)
  const totalCount = crewEntries.length

  return (
    <div style={cardStyle}>
      <div style={sectionHeaderStyle}>
        <span>&#128101;</span>
        <span>Crew Registry</span>
        <span style={countBadgeStyle}>{totalCount}</span>
      </div>

      {GROUP_ORDER.map(({ type, title }) => {
        const members = crewEntries.filter((m) => m.type === type)
        if (members.length === 0) return null

        return (
          <div key={type}>
            <div style={subSectionLabel}>{title}</div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: type === 'ally' ? 'repeat(auto-fill, minmax(180px, 1fr))' : 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 8,
              }}
            >
              {members.map((member) => {
                const detail = CREW_DETAILS[member.name]
                const model = detail?.model ?? 'sonnet'
                const modelColor = MODEL_COLORS[model] ?? 'var(--muted)'

                if (type === 'ally' || type === 'marine') {
                  // Compact row
                  return (
                    <div
                      key={member.name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 8px',
                        borderRadius: 6,
                        background: member.color,
                        border: '1px solid var(--border)',
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{member.emoji}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{member.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {member.role}
                      </span>
                    </div>
                  )
                }

                // Full card for coordinator + core
                return (
                  <div
                    key={member.name}
                    style={{
                      background: member.color,
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 16 }}>{member.emoji}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{member.name}</span>
                      <span
                        style={{
                          marginLeft: 'auto',
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: `${modelColor}20`,
                          color: modelColor,
                          letterSpacing: 0.5,
                        }}
                      >
                        {model}
                      </span>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.4 }}>{member.role}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Plugins
// ---------------------------------------------------------------------------

const PluginsSection = ({ plugins }: { plugins: ArsenalData['plugins'] }) => {
  const enabledPlugins = plugins.filter((p) => p.enabled)

  return (
    <div style={cardStyle}>
      <div style={sectionHeaderStyle}>
        <span>&#128268;</span>
        <span>Installed Plugins</span>
        <span style={countBadgeStyle}>{enabledPlugins.length}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {enabledPlugins.map((plugin) => (
          <div
            key={`${plugin.name}@${plugin.marketplace}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 0',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span style={{ fontSize: 14 }}>&#9898;</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{plugin.name}</span>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>@{plugin.marketplace}</span>
          </div>
        ))}
      </div>

      {enabledPlugins.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>No plugins installed</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Memory
// ---------------------------------------------------------------------------

const MemorySection = ({ memory }: { memory: ArsenalData['memory'] }) => {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={cardStyle}>
      <div style={sectionHeaderStyle}>
        <span>&#129504;</span>
        <span>Claude's Memory</span>
        <span style={countBadgeStyle}>{memory.entries} sections</span>
      </div>

      {memory.summary ? (
        <>
          <pre
            style={{
              fontSize: 13,
              color: 'var(--text)',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: 'var(--bg)',
              padding: 12,
              borderRadius: 8,
              border: '1px solid var(--border)',
              maxHeight: expanded ? 'none' : 200,
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {expanded ? memory.summary : memory.summary.slice(0, 300)}
            {!expanded && memory.summary.length > 300 && '...'}
          </pre>
          {memory.summary.length > 300 && (
            <button
              onClick={() => setExpanded(!expanded)}
              style={{
                alignSelf: 'flex-start',
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--accent)',
                cursor: 'pointer',
                transition: 'all 150ms ease',
              }}
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>No memory file found for this repo</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Config
// ---------------------------------------------------------------------------

const ConfigSection = ({ config }: { config: ArsenalData['config'] }) => {
  const entries: Array<{ label: string; value: string | null; icon: string }> = [
    { label: 'Model', value: config.model, icon: '&#129302;' },
    { label: 'Permissions', value: config.permissions, icon: '&#128274;' },
    { label: 'Effort Level', value: config.effortLevel, icon: '&#128170;' },
    { label: 'Teammate Mode', value: config.teammateMode, icon: '&#129309;' },
  ]

  return (
    <div style={cardStyle}>
      <div style={sectionHeaderStyle}>
        <span>&#9881;&#65039;</span>
        <span>Configuration</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {entries.map(({ label, value, icon }) => (
          <div
            key={label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              background: 'var(--bg)',
              borderRadius: 8,
              border: '1px solid var(--border)',
            }}
          >
            <span style={{ fontSize: 16 }} dangerouslySetInnerHTML={{ __html: icon }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: value ? 'var(--text)' : 'var(--muted)' }}>
                {value ?? 'Not set'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* MCP Servers */}
      {config.mcpServers.length > 0 && (
        <div>
          <div style={subSectionLabel}>MCP Servers</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {config.mcpServers.map((server) => (
              <span
                key={server}
                style={{
                  ...pillStyle,
                  background: 'rgba(88,166,255,0.12)',
                  color: 'var(--accent)',
                  border: '1px solid var(--accent)33',
                }}
              >
                {server}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading / Error states
// ---------------------------------------------------------------------------

const LoadingState = () => (
  <div style={{ padding: 24 }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 16 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          style={{
            ...cardStyle,
            height: 200,
            background: 'var(--card)',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
      ))}
    </div>
    <style>{`
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
    `}</style>
  </div>
)

const ErrorState = ({ error }: { error: string }) => (
  <div
    style={{
      padding: 24,
      background: 'var(--red-subtle)',
      border: '1px solid var(--red)',
      borderRadius: 'var(--radius-md)',
      margin: 24,
    }}
  >
    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--red)' }}>
      Failed to load arsenal data: {error}
    </span>
  </div>
)

// ---------------------------------------------------------------------------
// Arsenal (exported)
// ---------------------------------------------------------------------------

export const Arsenal = () => {
  const { repo } = useBoardContext()
  const { arsenal, loading, error } = useArsenal(repo)

  if (loading) return <LoadingState />
  if (error) return <ErrorState error={error} />
  if (!arsenal) return <ErrorState error="No data returned" />

  return (
    <div style={{ padding: 24 }}>
      {/* Page header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        style={{ marginBottom: 24 }}
      >
        <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>
          Arsenal
        </h2>
        <p style={{ fontSize: 14, color: 'var(--muted)' }}>
          Your complete Claude Code setup — hooks, skills, crew, plugins, memory, and config
        </p>
      </motion.div>

      {/* Dashboard grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
          gap: 16,
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.25 }}
        >
          <HooksSection hooks={arsenal.hooks} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.10, duration: 0.25 }}
        >
          <SkillsSection skills={arsenal.skills} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.25 }}
          style={{ gridColumn: '1 / -1' }}
        >
          <CrewSection />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.20, duration: 0.25 }}
        >
          <PluginsSection plugins={arsenal.plugins} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.25 }}
        >
          <MemorySection memory={arsenal.memory} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.30, duration: 0.25 }}
        >
          <ConfigSection config={arsenal.config} />
        </motion.div>
      </div>
    </div>
  )
}
