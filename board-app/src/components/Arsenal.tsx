// =============================================================================
// Phantom Works Board — Arsenal Dashboard
// Author: Subash Karki
//
// Sidebar + Content layout (matching Changelog pattern).
// Left sidebar: nav items for each section (Hooks, Skills, Plugins, Memory, Config).
// Right content: selected section's content.
// Data from /api/arsenal.
// =============================================================================

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useBoardContext } from '../App.tsx'
import { useArsenal } from '../hooks/useArsenal.ts'
import type { ArsenalData } from '../types.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SectionId = 'hooks' | 'skills' | 'plugins' | 'memory' | 'config'

interface SectionDef {
  id: SectionId
  label: string
  icon: string
  count: (a: ArsenalData) => number
}

// ---------------------------------------------------------------------------
// Section definitions
// ---------------------------------------------------------------------------

const SECTIONS: SectionDef[] = [
  { id: 'hooks', label: 'Hooks', icon: '\u26A1', count: (a) => a.hooks.length },
  {
    id: 'skills',
    label: 'Skills',
    icon: '\uD83D\uDDE1\uFE0F',
    count: (a) => a.skills.project.length + a.skills.global.length + a.skills.plugins.length,
  },
  {
    id: 'plugins',
    label: 'Plugins',
    icon: '\uD83D\uDD0C',
    count: (a) => a.plugins.filter((p) => p.enabled).length,
  },
  { id: 'memory', label: 'Memory', icon: '\uD83E\uDDE0', count: (a) => a.memory.entries },
  {
    id: 'config',
    label: 'Config',
    icon: '\u2699\uFE0F',
    count: (a) => a.config.mcpServers.length + 4,
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const truncateCommand = (cmd: string): string => {
  const short = cmd.replace(/\/Users\/[^/]+/g, '~').replace(/\/home\/[^/]+/g, '~')
  return short.length > 100 ? `${short.slice(0, 97)}\u2026` : short
}

// ---------------------------------------------------------------------------
// Memory heading parser
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
      let count = 0
      for (let j = i + 1; j < lines.length; j++) {
        if (/^#{1,4}\s/.test(lines[j])) break
        if (lines[j].trim()) count++
      }
      headings.push({ title: match[2].trim(), level: match[1].length, lineCount: count })
    }
  }
  return headings
}

// ---------------------------------------------------------------------------
// Loading Skeleton
// ---------------------------------------------------------------------------

const LoadingSkeleton = () => (
  <div style={{ display: 'flex', gap: 16, padding: 24, height: 480 }}>
    <div
      style={{
        width: 280,
        background: 'var(--card)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        animation: 'arsenal-pulse 1.5s ease-in-out infinite',
      }}
    />
    <div
      style={{
        flex: 1,
        background: 'var(--card)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        animation: 'arsenal-pulse 1.5s ease-in-out infinite',
        animationDelay: '0.2s',
      }}
    />
    <style>{`
      @keyframes arsenal-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
    `}</style>
  </div>
)

// ---------------------------------------------------------------------------
// Error / Empty states
// ---------------------------------------------------------------------------

const ErrorState = ({ message }: { message: string }) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 64,
      gap: 12,
    }}
  >
    <div style={{ fontSize: 36 }}>{'\u26A0'}</div>
    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--red)' }}>
      Failed to load Arsenal
    </div>
    <div style={{ fontSize: 14, color: 'var(--muted)' }}>{message}</div>
  </div>
)

// ---------------------------------------------------------------------------
// Content: Hooks
// ---------------------------------------------------------------------------

const HooksContent = ({ hooks }: { hooks: ArsenalData['hooks'] }) => {
  const grouped = useMemo(
    () =>
      hooks.reduce<Record<string, typeof hooks>>((acc, h) => {
        ;(acc[h.event] ??= []).push(h)
        return acc
      }, {}),
    [hooks],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {Object.entries(grouped).map(([event, items]) => (
        <div key={event}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: 0.8,
              marginBottom: 10,
            }}
          >
            {event}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map((hook, i) => (
              <div
                key={`${event}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '7px 10px',
                  borderRadius: 6,
                  background: i % 2 === 0 ? 'transparent' : 'var(--bg)',
                }}
              >
                {hook.matcher && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      fontSize: 13,
                      fontWeight: 500,
                      padding: '3px 10px',
                      borderRadius: 6,
                      fontFamily: "'Fira Code', monospace",
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      border: '1px solid var(--border)',
                      flexShrink: 0,
                    }}
                  >
                    {hook.matcher}
                  </span>
                )}
                <span
                  style={{
                    fontFamily: "'Fira Code', monospace",
                    fontSize: 13,
                    color: 'var(--muted)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    flex: 1,
                  }}
                  title={hook.command}
                >
                  {truncateCommand(hook.command)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {hooks.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>
          No hooks configured
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Content: Skills
// ---------------------------------------------------------------------------

const SkillsContent = ({ skills }: { skills: ArsenalData['skills'] }) => {
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

  const groups = [
    { label: 'Project', items: sortedProject, key: 'name' as const },
    { label: 'Team Commands', items: sortedGlobal, key: 'name' as const },
    { label: 'Plugin Skills', items: sortedPlugins, key: 'name' as const },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {groups.map(({ label, items }) => {
        if (items.length === 0) return null
        return (
          <div key={label}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--muted)',
                textTransform: 'uppercase',
                letterSpacing: 0.8,
                marginBottom: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {label}
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--muted)',
                  background: 'var(--bg)',
                  padding: '1px 8px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {items.length}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {items.map((s) => (
                <span
                  key={s.name}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    fontSize: 13,
                    fontWeight: 500,
                    padding: '5px 12px',
                    borderRadius: 8,
                    fontFamily: "'Fira Code', monospace",
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    border: '1px solid var(--border)',
                    transition: 'border-color 150ms ease',
                  }}
                  title={'path' in s ? (s as { path: string }).path : ('source' in s ? (s as { source: string }).source : '')}
                >
                  {s.name}
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Content: Plugins
// ---------------------------------------------------------------------------

const PluginsContent = ({ plugins }: { plugins: ArsenalData['plugins'] }) => {
  const enabled = plugins.filter((p) => p.enabled)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {enabled.map((plugin) => (
        <div
          key={`${plugin.name}@${plugin.marketplace}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 10px',
            borderRadius: 6,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
            {plugin.name}
          </span>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>@{plugin.marketplace}</span>
        </div>
      ))}
      {enabled.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>
          No plugins installed
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Content: Memory
// ---------------------------------------------------------------------------

const MemoryContent = ({ memory }: { memory: ArsenalData['memory'] }) => {
  const [showRaw, setShowRaw] = useState(false)

  const headings = useMemo(
    () => (memory.summary ? parseMemoryHeadings(memory.summary) : []),
    [memory.summary],
  )

  if (!memory.summary) {
    return (
      <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>
        No memory file found for this repo
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!showRaw && (
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
          {headings.map((h, i) => (
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
                  background: h.level <= 2 ? 'var(--orange)' : 'var(--muted)',
                  flexShrink: 0,
                  opacity: h.level <= 2 ? 1 : 0.5,
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
                  {h.lineCount}
                </span>
              )}
            </div>
          ))}
          {headings.length === 0 && (
            <span style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>
              No markdown headings found
            </span>
          )}
        </div>
      )}

      {showRaw && (
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
            maxHeight: 500,
            overflow: 'auto',
          }}
        >
          {memory.summary}
        </pre>
      )}

      <button
        onClick={() => setShowRaw(!showRaw)}
        style={{
          alignSelf: 'flex-start',
          background: 'none',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '5px 14px',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--muted)',
          cursor: 'pointer',
          transition: 'all 150ms ease',
        }}
      >
        {showRaw ? 'Show structured view' : 'Show raw markdown'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Content: Config
// ---------------------------------------------------------------------------

const ConfigContent = ({ config }: { config: ArsenalData['config'] }) => {
  const entries: Array<{ label: string; value: string | null }> = [
    { label: 'Model', value: config.model },
    { label: 'Permissions', value: config.permissions },
    { label: 'Effort Level', value: config.effortLevel },
    { label: 'Teammate Mode', value: config.teammateMode },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Key-value rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entries.map(({ label, value }) => (
          <div
            key={label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '8px 10px',
              borderRadius: 6,
            }}
          >
            <span
              style={{
                fontSize: 13,
                color: 'var(--muted)',
                width: 120,
                flexShrink: 0,
              }}
            >
              {label}
            </span>
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: value ? 'var(--text)' : 'var(--muted)',
              }}
            >
              {value ?? 'Not set'}
            </span>
          </div>
        ))}
      </div>

      {/* MCP Servers */}
      {config.mcpServers.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: 0.8,
              marginBottom: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            MCP Servers
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--muted)',
                background: 'var(--bg)',
                padding: '1px 8px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {config.mcpServers.length}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {config.mcpServers.map((server) => (
              <div
                key={server}
                style={{
                  fontSize: 13,
                  fontFamily: "'Fira Code', monospace",
                  color: 'var(--muted)',
                  padding: '5px 10px',
                  borderRadius: 6,
                }}
              >
                {server}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section content router
// ---------------------------------------------------------------------------

const SectionContent = ({
  section,
  arsenal,
}: {
  section: SectionId
  arsenal: ArsenalData
}) => {
  switch (section) {
    case 'hooks':
      return <HooksContent hooks={arsenal.hooks} />
    case 'skills':
      return <SkillsContent skills={arsenal.skills} />
    case 'plugins':
      return <PluginsContent plugins={arsenal.plugins} />
    case 'memory':
      return <MemoryContent memory={arsenal.memory} />
    case 'config':
      return <ConfigContent config={arsenal.config} />
  }
}

// ---------------------------------------------------------------------------
// Arsenal (exported)
// ---------------------------------------------------------------------------

export const Arsenal = () => {
  const { repo } = useBoardContext()
  const { arsenal, loading, error } = useArsenal(repo)
  const [activeSection, setActiveSection] = useState<SectionId>('hooks')

  if (loading) return <LoadingSkeleton />
  if (error) return <ErrorState message={error} />
  if (!arsenal) return <ErrorState message="No data returned" />

  const totalCount = SECTIONS.reduce((sum, s) => sum + s.count(arsenal), 0)

  return (
    <div style={{ display: 'flex', gap: 16, padding: 24, minHeight: 480 }}>
      {/* Left sidebar — section nav */}
      <nav
        style={{
          width: 280,
          flexShrink: 0,
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 12,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
        aria-label="Arsenal navigation"
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: 1,
            padding: '4px 8px',
            marginBottom: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>Arsenal</span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--muted)',
              background: 'var(--bg)',
              padding: '1px 8px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {totalCount}
          </span>
        </div>

        {SECTIONS.map((section, i) => {
          const isActive = section.id === activeSection
          const count = section.count(arsenal)

          return (
            <motion.button
              key={section.id}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05, duration: 0.2 }}
              onClick={() => setActiveSection(section.id)}
              aria-current={isActive ? 'page' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: isActive ? 'var(--orange-subtle)' : 'transparent',
                color: isActive ? 'var(--orange)' : 'var(--text-secondary)',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 200ms ease',
                borderLeft: isActive
                  ? '3px solid var(--orange)'
                  : '3px solid transparent',
              }}
            >
              <span style={{ fontSize: 14, flexShrink: 0 }}>{section.icon}</span>
              <span style={{ flex: 1 }}>{section.label}</span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: isActive ? 'var(--orange)' : 'var(--muted)',
                  background: isActive ? 'transparent' : 'var(--bg)',
                  padding: '1px 8px',
                  borderRadius: 8,
                  border: isActive ? '1px solid var(--orange)' : '1px solid var(--border)',
                  fontVariantNumeric: 'tabular-nums',
                  opacity: isActive ? 0.8 : 1,
                }}
              >
                {count}
              </span>
            </motion.button>
          )
        })}
      </nav>

      {/* Right panel — section content */}
      <div
        style={{
          flex: 1,
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 28,
          overflowY: 'auto',
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={activeSection}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
          >
            <h2
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: 'var(--text)',
                marginBottom: 16,
                paddingBottom: 12,
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span>{SECTIONS.find((s) => s.id === activeSection)?.icon}</span>
              {SECTIONS.find((s) => s.id === activeSection)?.label}
            </h2>
            <SectionContent section={activeSection} arsenal={arsenal} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
