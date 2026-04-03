// =============================================================================
// Straw Hat Board — Main App Shell
// Author: Subash Karki
//
// Header with branding + theme toggle, 5-tab navigation with Motion page
// transitions. Ship's Log (event-sourced timeline) is the default view.
// =============================================================================

import { useState, useEffect, createContext, useContext } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTheme, type Theme } from './hooks/useTheme.ts'
import { useRepos } from './hooks/useApi.ts'
import { useTaskEvents } from './hooks/useTaskEvents.ts'
import { useMaterializedSessions } from './hooks/useSessionMaterializer.ts'
import { ToastProvider } from './components/Toast.tsx'
import { Dropdown } from './components/Dropdown.tsx'
import { ShipsLog } from './components/ShipsLog.tsx'
import { FlowSimulator } from './components/FlowSimulator.tsx'
import { CrewRoster } from './components/CrewRoster.tsx'
import { CaptainsLog } from './components/CaptainsLog.tsx'
import { NavigatorNotes } from './components/NavigatorNotes.tsx'
import { Changelog } from './components/Changelog.tsx'
import { SkillsOverview } from './components/SkillsOverview.tsx'

// ---------------------------------------------------------------------------
// Repo context (shared across all tabs)
// ---------------------------------------------------------------------------

interface BoardContext {
  repo: string
  setRepo: (repo: string) => void
}

const BoardCtx = createContext<BoardContext>({
  repo: 'feature-web-apps',
  setRepo: () => {},
})

export const useBoardContext = () => useContext(BoardCtx)

// ---------------------------------------------------------------------------
// Tab configuration
// ---------------------------------------------------------------------------

const tabs = [
  { id: 'log',      label: "Ship's Log",        icon: '📜' },
  { id: 'flow',     label: 'Crew Flow',         icon: '🌊' },
  { id: 'roster',   label: 'Crew Roster',       icon: '👥' },
  { id: 'story',    label: "Captain's Log",     icon: '📖' },
  { id: 'notes',     label: "Navigator's Notes", icon: '🧭' },
  { id: 'changelog', label: 'Changelog',         icon: '📋' },
  { id: 'skills',    label: 'Skills',            icon: '⚡' },
] as const

type TabId = (typeof tabs)[number]['id']

// ---------------------------------------------------------------------------
// Theme toggle icons
// ---------------------------------------------------------------------------

const THEME_ICONS: Record<Theme, string> = {
  dark: '🌙',
  light: '☀',
  pirate: '🏴\u200D☠',
}

// ---------------------------------------------------------------------------
// Tab content resolver
// ---------------------------------------------------------------------------

const TabContent = ({ id }: { id: TabId }) => {
  switch (id) {
    case 'log':     return <ShipsLog />
    case 'flow':    return <FlowSimulator />
    case 'roster':  return <CrewRoster />
    case 'story':   return <CaptainsLog />
    case 'notes':     return <NavigatorNotes />
    case 'changelog': return <Changelog />
    case 'skills':    return <SkillsOverview />
  }
}

// ---------------------------------------------------------------------------
// App Shell
// ---------------------------------------------------------------------------

export const App = () => (
  <ToastProvider>
    <AppInner />
  </ToastProvider>
)

const AppInner = () => {
  const [activeTab, setActiveTab] = useState<TabId>('log')
  const { theme, toggleTheme } = useTheme()
  const [repo, setRepo] = useState(() => {
    return localStorage.getItem('sh-board-repo') || 'feature-web-apps'
  })
  const { repos } = useRepos()
  const { events, connected } = useTaskEvents(repo)
  const sessions = useMaterializedSessions(events)

  const activeSessions = sessions.filter(s => s.stats.inProgress > 0).length
  const totalSessions = sessions.length

  useEffect(() => {
    localStorage.setItem('sh-board-repo', repo)
  }, [repo])

  const repoOptions = repos.map(r => ({ value: r, label: r }))

  return (
    <BoardCtx.Provider value={{ repo, setRepo }}>
    <div style={{ minHeight: '100vh' }}>
      {/* ================================================================= */}
      {/* Sticky Header + Tabs                                              */}
      {/* ================================================================= */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'var(--bg)',
          borderBottom: '1px solid var(--border)',
          marginLeft: -16,
          marginRight: -16,
          paddingLeft: 16,
          paddingRight: 16,
        }}
      >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 0',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        {/* Branding */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 28 }}>🏴‍☠️</span>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', lineHeight: 1.2 }}>
              Straw Hat Board
            </h1>
            <p style={{ fontSize: 14, color: 'var(--muted)' }}>
              v3.0 — Event-Sourced Ship's Log
            </p>
          </div>
          {/* Consistent header badge cluster */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginLeft: 4,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 13,
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: 10,
                background: connected ? 'var(--green-subtle)' : 'var(--red-subtle)',
                color: connected ? 'var(--green)' : 'var(--red)',
                letterSpacing: 0.5,
                boxShadow: `inset 0 0 0 1px ${connected ? 'var(--green)' : 'var(--red)'}20`,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: connected ? 'var(--green)' : 'var(--red)',
                }}
              />
              {connected ? 'LIVE' : 'OFFLINE'}
            </span>
            {activeSessions > 0 ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 13,
                  fontWeight: 700,
                  padding: '3px 10px',
                  borderRadius: 10,
                  background: 'var(--orange-subtle)',
                  color: 'var(--orange)',
                  letterSpacing: 0.5,
                  boxShadow: 'inset 0 0 0 1px var(--orange)20',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                ⛵ {activeSessions} sailing
              </span>
            ) : (
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '3px 10px',
                  borderRadius: 10,
                  background: 'var(--card)',
                  color: 'var(--muted)',
                  boxShadow: 'inset 0 0 0 1px var(--border)',
                }}
              >
                idle
              </span>
            )}
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--muted)',
                padding: '3px 10px',
                borderRadius: 10,
                background: 'var(--card)',
                boxShadow: 'inset 0 0 0 1px var(--border)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {totalSessions} voyages
            </span>
          </div>
        </div>

        {/* Repo selector + Theme toggle */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <Dropdown
            label="Repo"
            options={repoOptions}
            value={repo}
            onChange={(v) => setRepo(v)}
            aria-label="Select repository"
            maxWidth={350}
            minWidth={350}
          />

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            title={`Current: ${theme}. Click to cycle.`}
            aria-label={`Switch theme. Currently ${theme}.`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 40,
              height: 40,
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--card)',
              cursor: 'pointer',
              fontSize: 20,
              transition: 'all 200ms ease',
            }}
          >
            {THEME_ICONS[theme]}
          </button>
        </div>
      </header>

      {/* ================================================================= */}
      {/* Tab Bar                                                           */}
      {/* ================================================================= */}
      <nav
        role="tablist"
        aria-label="Main navigation"
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid var(--border)',
          overflowX: 'auto',
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {tabs.map(tab => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              id={`tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '12px 18px',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--orange)' : '2px solid transparent',
                background: 'transparent',
                color: isActive ? 'var(--orange)' : 'var(--muted)',
                fontSize: 14,
                fontWeight: isActive ? 700 : 500,
                cursor: 'pointer',
                transition: 'all 200ms ease',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 15 }}>{tab.icon}</span>
              {tab.label}
            </button>
          )
        })}
      </nav>

      {/* Hide scrollbar for tab nav */}
      <style>{`
        nav[role="tablist"]::-webkit-scrollbar { display: none; }
      `}</style>
      </div>{/* end sticky wrapper */}

      {/* ================================================================= */}
      {/* Tab Content with Transitions                                      */}
      {/* ================================================================= */}
      <main>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            id={`panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`tab-${activeTab}`}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
          >
            <TabContent id={activeTab} />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
    </BoardCtx.Provider>
  )
}
