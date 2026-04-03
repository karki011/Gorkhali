// =============================================================================
// Straw Hat Board — Arsenal Dashboard (Pro Max Edition)
// Author: Subash Karki
//
// Shows the user's full Claude Code setup: hooks, skills, plugins,
// agents (crew), memory, and configuration. Data from /api/arsenal,
// crew details from client-side crew.ts.
// =============================================================================

import { useState, useMemo } from 'react'
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
  padding: '24px',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
}

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  fontSize: 15,
  fontWeight: 700,
  color: 'var(--text)',
}

const countBadgeStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--muted)',
  background: 'var(--bg)',
  padding: '2px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  fontVariantNumeric: 'tabular-nums',
}

const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: 14,
  fontWeight: 600,
  padding: '6px 14px',
  borderRadius: 12,
  fontFamily: "'Fira Code', monospace",
  letterSpacing: 0.3,
  transition: 'all 150ms ease',
  cursor: 'pointer',
}

const monoStyle: React.CSSProperties = {
  fontFamily: "'Fira Code', monospace",
  fontSize: 13,
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
  marginBottom: 8,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

// ---------------------------------------------------------------------------
// Event color map for hooks
// ---------------------------------------------------------------------------

const EVENT_COLORS: Record<string, { color: string; bg: string }> = {
  PreToolUse:        { color: 'var(--accent)',  bg: 'rgba(88,166,255,0.12)' },
  PostToolUse:       { color: 'var(--orange)',  bg: 'var(--orange-subtle)' },
  SessionStart:      { color: 'var(--green)',   bg: 'var(--green-subtle)' },
  Stop:              { color: 'var(--red)',     bg: 'var(--red-subtle)' },
  PreCompact:        { color: 'var(--purple)',  bg: 'var(--purple-subtle)' },
  UserPromptSubmit:  { color: 'var(--accent)',  bg: 'rgba(88,166,255,0.12)' },
  Notification:      { color: 'var(--muted)',   bg: 'var(--card)' },
  PermissionRequest: { color: 'var(--muted)',   bg: 'var(--card)' },
}

const getEventColor = (event: string) =>
  EVENT_COLORS[event] ?? { color: 'var(--muted)', bg: 'var(--card)' }

// ---------------------------------------------------------------------------
// Model badge colors
// ---------------------------------------------------------------------------

const MODEL_COLORS: Record<string, string> = {
  opus: 'var(--orange)',
  sonnet: 'var(--accent)',
  haiku: 'var(--green)',
}

// ---------------------------------------------------------------------------
// Default-expanded hook event types
// ---------------------------------------------------------------------------

const DEFAULT_EXPANDED_EVENTS = new Set(['PostToolUse', 'PreToolUse'])

// ---------------------------------------------------------------------------
// Summary Bar — key counts at a glance
// ---------------------------------------------------------------------------

const SummaryBar = ({
  hookCount,
  skillCount,
  crewCount,
  pluginCount,
  mcpCount,
}: {
  hookCount: number
  skillCount: number
  crewCount: number
  pluginCount: number
  mcpCount: number
}) => {
  const items = [
    { icon: '\u26A1', label: 'Hooks', count: hookCount },
    { icon: '\uD83D\uDDE1\uFE0F', label: 'Skills', count: skillCount },
    { icon: '\uD83D\uDC65', label: 'Crew', count: crewCount },
    { icon: '\uD83D\uDD0C', label: 'Plugins', count: pluginCount },
    { icon: '\uD83C\uDF10', label: 'MCP Servers', count: mcpCount },
  ]

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        padding: '14px 20px',
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      {items.map(({ icon, label, count }) => (
        <div
          key={label}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 14px',
            borderRadius: 8,
            background: 'var(--bg)',
            border: '1px solid var(--border)',
          }}
        >
          <span style={{ fontSize: 14 }}>{icon}</span>
          <span
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: 'var(--text)',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
            }}
          >
            {count}
          </span>
          <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>{label}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Hooks — collapsible groups by event type
// ---------------------------------------------------------------------------

const HooksSection = ({ hooks }: { hooks: ArsenalData['hooks'] }) => {
  const grouped = useMemo(
    () =>
      hooks.reduce<Record<string, typeof hooks>>((acc, h) => {
        ;(acc[h.event] ??= []).push(h)
        return acc
      }, {}),
    [hooks],
  )

  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(
    () => new Set(Object.keys(grouped).filter((e) => DEFAULT_EXPANDED_EVENTS.has(e))),
  )

  const toggleEvent = (event: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev)
      if (next.has(event)) next.delete(event)
      else next.add(event)
      return next
    })
  }

  return (
    <div style={cardStyle}>
      <div style={sectionHeaderStyle}>
        <span>{'\u26A1'}</span>
        <span>Active Hooks</span>
        <span style={countBadgeStyle}>{hooks.length}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {Object.entries(grouped).map(([event, items]) => {
          const ec = getEventColor(event)
          const isExpanded = expandedEvents.has(event)

          return (
            <div key={event}>
              {/* Clickable event group header */}
              <button
                onClick={() => toggleEvent(event)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '8px 12px',
                  background: ec.bg,
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'all 150ms ease',
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    color: ec.color,
                    transition: 'transform 150ms ease',
                    transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    display: 'inline-block',
                  }}
                >
                  {'\u25B6'}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: ec.color,
                    textTransform: 'uppercase',
                    letterSpacing: 0.6,
                  }}
                >
                  {event}
                </span>
                <span
                  style={{
                    ...countBadgeStyle,
                    fontSize: 11,
                    padding: '1px 7px',
                    color: ec.color,
                    background: 'transparent',
                    border: `1px solid ${ec.color}44`,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {items.length}
                </span>
              </button>

              {/* Collapsible hook rows */}
              {isExpanded && (
                <div style={{ marginTop: 2, marginLeft: 4, borderLeft: `2px solid ${ec.color}33`, paddingLeft: 12 }}>
                  {items.map((hook, i) => (
                    <div
                      key={`${event}-${i}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '7px 8px',
                        background: i % 2 === 0 ? 'transparent' : 'var(--bg)',
                        borderRadius: 6,
                      }}
                    >
                      {hook.matcher && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            fontSize: 12,
                            fontWeight: 600,
                            padding: '3px 10px',
                            borderRadius: 6,
                            fontFamily: "'Fira Code', monospace",
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
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const truncateCommand = (cmd: string): string => {
  const short = cmd
    .replace(/\/Users\/[^/]+/g, '~')
    .replace(/\/home\/[^/]+/g, '~')
  return short.length > 90 ? `${short.slice(0, 87)}\u2026` : short
}

// ---------------------------------------------------------------------------
// Section: Skills — larger chips with colored accent borders
// ---------------------------------------------------------------------------

const SkillsSection = ({ skills }: { skills: ArsenalData['skills'] }) => {
  const totalCount = skills.project.length + skills.global.length + skills.plugins.length

  const sortedProject = useMemo(
    () => [...skills.project].sort((a, b) => a.name.localeCompare(b.name)),
    [skills.project],
  )
  const sortedGlobal = useMemo(
    () => [...skills.global].sort((a, b) => a.name.localeCompare(b.name)),
    [skills.global],
  )
  const sortedPlugins = useMemo(
    () => [...skills.plugins].sort((a, b) => a.name.localeCompare(b.name)),
    [skills.plugins],
  )

  const sections = [
    { label: 'Project Skills', items: sortedProject, color: 'var(--orange)', bg: 'var(--orange-subtle)', key: 'name' as const },
    { label: 'Team Commands', items: sortedGlobal, color: 'var(--accent)', bg: 'rgba(88,166,255,0.12)', key: 'name' as const },
    { label: 'Plugin Skills', items: sortedPlugins, color: 'var(--purple)', bg: 'var(--purple-subtle)', key: 'name' as const },
  ]

  return (
    <div style={cardStyle}>
      <div style={sectionHeaderStyle}>
        <span>{'\uD83D\uDDE1\uFE0F'}</span>
        <span>Skills Arsenal</span>
        <span style={countBadgeStyle}>{totalCount}</span>
      </div>

      {sections.map(({ label, items, color, bg }) => {
        if (items.length === 0) return null
        return (
          <div
            key={label}
            style={{
              borderLeft: `3px solid ${color}`,
              paddingLeft: 16,
            }}
          >
            <div style={subSectionLabel}>
              {label}
              <span style={{ ...countBadgeStyle, fontSize: 11, padding: '1px 7px' }}>{items.length}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {items.map((s) => (
                <SkillPill
                  key={s.name}
                  name={s.name}
                  detail={'path' in s ? (s as { path: string }).path : ('source' in s ? (s as { source: string }).source : '')}
                  color={color}
                  bg={bg}
                />
              ))}
            </div>
          </div>
        )
      })}

      {totalCount === 0 && (
        <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>No skills found</div>
      )}
    </div>
  )
}

const SkillPill = ({ name, detail, color, bg }: { name: string; detail: string; color: string; bg: string }) => {
  const [hovered, setHovered] = useState(false)

  return (
    <span
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...pillStyle,
        background: hovered ? color : bg,
        color: hovered ? '#fff' : color,
        border: `1px solid ${color}33`,
      }}
      title={detail}
    >
      {name}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Section: Crew Registry — compact summary table
// ---------------------------------------------------------------------------

const GROUP_ORDER: { type: CrewMember['type']; title: string; accent: string }[] = [
  { type: 'coordinator', title: 'Coordinator', accent: 'var(--orange)' },
  { type: 'core', title: 'Core Crew', accent: 'var(--accent)' },
  { type: 'marine', title: 'Marines', accent: 'var(--green)' },
  { type: 'ally', title: 'Grand Fleet Allies', accent: 'var(--purple)' },
]

const CrewSection = () => {
  const crewEntries = Object.values(CREW)
  const totalCount = crewEntries.length

  return (
    <div style={cardStyle}>
      <div style={sectionHeaderStyle}>
        <span>{'\uD83D\uDC65'}</span>
        <span>Crew Registry</span>
        <span style={countBadgeStyle}>{totalCount}</span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: 0,
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {GROUP_ORDER.map(({ type, title, accent }) => {
          const members = crewEntries.filter((m) => m.type === type)
          if (members.length === 0) return null

          return (
            <div key={type}>
              {/* Group divider */}
              <div
                style={{
                  padding: '6px 14px',
                  background: 'var(--bg)',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: accent,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--muted)',
                    textTransform: 'uppercase',
                    letterSpacing: 0.8,
                  }}
                >
                  {title}
                </span>
                <span
                  style={{
                    ...countBadgeStyle,
                    fontSize: 10,
                    padding: '0px 6px',
                    border: 'none',
                    background: 'transparent',
                  }}
                >
                  {members.length}
                </span>
              </div>

              {/* Crew rows */}
              {members.map((member, i) => {
                const detail = CREW_DETAILS[member.name]
                const model = detail?.model ?? 'sonnet'
                const modelColor = MODEL_COLORS[model] ?? 'var(--muted)'

                return (
                  <div
                    key={member.name}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '32px 120px 1fr auto',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 14px',
                      background: i % 2 === 0 ? 'transparent' : 'var(--bg)',
                      borderBottom: '1px solid var(--border)',
                      transition: 'background 150ms ease',
                    }}
                  >
                    <span style={{ fontSize: 16, textAlign: 'center' }}>{member.emoji}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                      {member.name}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        color: 'var(--muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {member.role}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: `${modelColor}20`,
                        color: modelColor,
                        letterSpacing: 0.5,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {model}
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Plugins — colored pills grouped by marketplace
// ---------------------------------------------------------------------------

const PluginsSection = ({ plugins }: { plugins: ArsenalData['plugins'] }) => {
  const enabledPlugins = plugins.filter((p) => p.enabled)

  const MARKETPLACE_COLORS: Record<string, { color: string; bg: string }> = {
    official: { color: 'var(--green)', bg: 'var(--green-subtle)' },
    community: { color: 'var(--accent)', bg: 'rgba(88,166,255,0.12)' },
  }
  const defaultMPColor = { color: 'var(--purple)', bg: 'var(--purple-subtle)' }

  const grouped = useMemo(() => {
    const map: Record<string, typeof enabledPlugins> = {}
    for (const p of enabledPlugins) {
      ;(map[p.marketplace] ??= []).push(p)
    }
    return map
  }, [enabledPlugins])

  return (
    <div style={cardStyle}>
      <div style={sectionHeaderStyle}>
        <span>{'\uD83D\uDD0C'}</span>
        <span>Installed Plugins</span>
        <span style={countBadgeStyle}>{enabledPlugins.length}</span>
      </div>

      {Object.entries(grouped).map(([marketplace, items]) => {
        const mc = MARKETPLACE_COLORS[marketplace] ?? defaultMPColor
        return (
          <div key={marketplace}>
            <div style={subSectionLabel}>
              @{marketplace}
              <span style={{ ...countBadgeStyle, fontSize: 11, padding: '1px 7px' }}>{items.length}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {items.map((plugin) => (
                <span
                  key={`${plugin.name}@${plugin.marketplace}`}
                  style={{
                    ...pillStyle,
                    background: mc.bg,
                    color: mc.color,
                    border: `1px solid ${mc.color}33`,
                    cursor: 'default',
                  }}
                >
                  {plugin.name}
                </span>
              ))}
            </div>
          </div>
        )
      })}

      {enabledPlugins.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>No plugins installed</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Memory — parsed markdown headers with entry counts
// ---------------------------------------------------------------------------

interface MemoryHeading {
  title: string
  level: number
  lineCount: number
}

const parseMemoryHeadings = (summary: string): MemoryHeading[] => {
  const lines = summary.split('\n')
  const headings: MemoryHeading[] = []

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,4})\s+(.+)/)
    if (match) {
      // Count lines until next heading or end
      let count = 0
      for (let j = i + 1; j < lines.length; j++) {
        if (/^#{1,4}\s/.test(lines[j])) break
        if (lines[j].trim()) count++
      }
      headings.push({
        title: match[2].trim(),
        level: match[1].length,
        lineCount: count,
      })
    }
  }
  return headings
}

const HEADING_COLORS: Record<number, string> = {
  1: 'var(--orange)',
  2: 'var(--accent)',
  3: 'var(--green)',
  4: 'var(--muted)',
}

const MemorySection = ({ memory }: { memory: ArsenalData['memory'] }) => {
  const [expanded, setExpanded] = useState(false)

  const headings = useMemo(
    () => (memory.summary ? parseMemoryHeadings(memory.summary) : []),
    [memory.summary],
  )

  return (
    <div style={cardStyle}>
      <div style={sectionHeaderStyle}>
        <span>{'\uD83E\uDDE0'}</span>
        <span>Claude's Memory</span>
        <span style={countBadgeStyle}>{memory.entries} sections</span>
      </div>

      {memory.summary ? (
        <>
          {/* Structured heading view */}
          {!expanded && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                background: 'var(--bg)',
                borderRadius: 8,
                border: '1px solid var(--border)',
                padding: '12px 16px',
              }}
            >
              {headings.map((h, i) => {
                const color = HEADING_COLORS[h.level] ?? 'var(--muted)'
                return (
                  <div
                    key={`${h.title}-${i}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '4px 0',
                      paddingLeft: (h.level - 1) * 16,
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: color,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontSize: h.level <= 2 ? 14 : 13,
                        fontWeight: h.level <= 2 ? 700 : 500,
                        color: h.level <= 2 ? 'var(--text)' : 'var(--muted)',
                        flex: 1,
                      }}
                    >
                      {h.title}
                    </span>
                    {h.lineCount > 0 && (
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--muted)',
                          fontVariantNumeric: 'tabular-nums',
                          fontWeight: 500,
                        }}
                      >
                        {h.lineCount} {h.lineCount === 1 ? 'entry' : 'entries'}
                      </span>
                    )}
                  </div>
                )
              })}
              {headings.length === 0 && (
                <span style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>
                  No markdown headings found
                </span>
              )}
            </div>
          )}

          {/* Raw markdown view */}
          {expanded && (
            <pre
              style={{
                fontSize: 13,
                color: 'var(--text)',
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: 'var(--bg)',
                padding: 16,
                borderRadius: 8,
                border: '1px solid var(--border)',
                maxHeight: 400,
                overflow: 'auto',
              }}
            >
              {memory.summary}
            </pre>
          )}

          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              alignSelf: 'flex-start',
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '5px 14px',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--accent)',
              cursor: 'pointer',
              transition: 'all 150ms ease',
            }}
          >
            {expanded ? 'Show structured view' : 'Show raw markdown'}
          </button>
        </>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>No memory file found for this repo</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Config — prominent MCP servers, larger value cards
// ---------------------------------------------------------------------------

const ConfigSection = ({ config }: { config: ArsenalData['config'] }) => {
  const entries: Array<{ label: string; value: string | null; icon: string }> = [
    { label: 'Model', value: config.model, icon: '\uD83E\uDD16' },
    { label: 'Permissions', value: config.permissions, icon: '\uD83D\uDD12' },
    { label: 'Effort Level', value: config.effortLevel, icon: '\uD83D\uDCAA' },
    { label: 'Teammate Mode', value: config.teammateMode, icon: '\uD83E\uDD1D' },
  ]

  return (
    <div style={cardStyle}>
      <div style={sectionHeaderStyle}>
        <span>{'\u2699\uFE0F'}</span>
        <span>Configuration</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {entries.map(({ label, value, icon }) => (
          <div
            key={label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 16px',
              background: 'var(--bg)',
              borderRadius: 10,
              border: '1px solid var(--border)',
              transition: 'border-color 150ms ease',
            }}
          >
            <span style={{ fontSize: 22 }}>{icon}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--muted)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                {label}
              </span>
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: value ? 'var(--text)' : 'var(--muted)',
                }}
              >
                {value ?? 'Not set'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* MCP Servers — prominent */}
      {config.mcpServers.length > 0 && (
        <div
          style={{
            borderLeft: '3px solid var(--accent)',
            paddingLeft: 16,
          }}
        >
          <div style={subSectionLabel}>
            <span>{'\uD83C\uDF10'}</span>
            MCP Servers
            <span style={countBadgeStyle}>{config.mcpServers.length}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {config.mcpServers.map((server) => (
              <span
                key={server}
                style={{
                  ...pillStyle,
                  background: 'rgba(88,166,255,0.12)',
                  color: 'var(--accent)',
                  border: '1px solid var(--accent)33',
                  cursor: 'default',
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
  <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
    {/* Summary bar skeleton */}
    <div
      style={{
        height: 52,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        animation: 'pulse 1.5s ease-in-out infinite',
      }}
    />
    {/* Section skeletons */}
    {Array.from({ length: 4 }).map((_, i) => (
      <div
        key={i}
        style={{
          ...cardStyle,
          height: i === 2 ? 260 : 180,
          animation: 'pulse 1.5s ease-in-out infinite',
        }}
      />
    ))}
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

  const skillCount =
    arsenal.skills.project.length +
    arsenal.skills.global.length +
    arsenal.skills.plugins.length

  const enabledPluginCount = arsenal.plugins.filter((p) => p.enabled).length

  return (
    <div style={{ padding: 24 }}>
      {/* Page header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        style={{ marginBottom: 20 }}
      >
        <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>
          Arsenal
        </h2>
        <p style={{ fontSize: 14, color: 'var(--muted)' }}>
          Your complete Claude Code setup — hooks, skills, crew, plugins, memory, and config
        </p>
      </motion.div>

      {/* Full-width single-column layout */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Summary bar */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.03, duration: 0.25 }}
        >
          <SummaryBar
            hookCount={arsenal.hooks.length}
            skillCount={skillCount}
            crewCount={Object.keys(CREW).length}
            pluginCount={enabledPluginCount}
            mcpCount={arsenal.config.mcpServers.length}
          />
        </motion.div>

        {/* Hooks */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06, duration: 0.25 }}
        >
          <HooksSection hooks={arsenal.hooks} />
        </motion.div>

        {/* Skills */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.09, duration: 0.25 }}
        >
          <SkillsSection skills={arsenal.skills} />
        </motion.div>

        {/* Crew */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.25 }}
        >
          <CrewSection />
        </motion.div>

        {/* Plugins */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.25 }}
        >
          <PluginsSection plugins={arsenal.plugins} />
        </motion.div>

        {/* Memory */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.25 }}
        >
          <MemorySection memory={arsenal.memory} />
        </motion.div>

        {/* Config */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.21, duration: 0.25 }}
        >
          <ConfigSection config={arsenal.config} />
        </motion.div>
      </div>
    </div>
  )
}
