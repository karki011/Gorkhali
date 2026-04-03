// =============================================================================
// Straw Hat Board — Navigator's Notes (Learnings)
// Author: Subash Karki
//
// Side-nav layout: domain list on left, rendered content on right.
// Handles Record<string, string> format where keys are domain filenames
// (ui, data, auth, testing, crew, migration, tooling) and values are
// the markdown content. Each domain is a collapsible section.
// =============================================================================

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import Markdown from 'react-markdown'
import { useLearnings } from '../hooks/useApi.ts'
import { useBoardContext } from '../App.tsx'

// ---------------------------------------------------------------------------
// Domain config — icon + color mapping for known domains
// ---------------------------------------------------------------------------

interface DomainConfig {
  icon: string
  color: string
  subtle: string
  desc: string
}

const DOMAIN_CONFIG: Record<string, DomainConfig> = {
  ui:        { icon: '🎨', color: 'var(--orange)', subtle: 'var(--orange-subtle)', desc: 'UI components & visual patterns' },
  data:      { icon: '📊', color: 'var(--accent)', subtle: 'rgba(88,166,255,0.12)', desc: 'Data fetching & state management' },
  auth:      { icon: '🔐', color: 'var(--red)',    subtle: 'var(--red-subtle)',    desc: 'Authentication & authorization' },
  testing:   { icon: '🧪', color: 'var(--green)',  subtle: 'var(--green-subtle)',  desc: 'Test patterns & utilities' },
  crew:      { icon: '👥', color: 'var(--purple)', subtle: 'var(--purple-subtle)', desc: 'Crew coordination & workflows' },
  migration: { icon: '🚀', color: 'var(--yellow)', subtle: 'var(--yellow-subtle)', desc: 'Migration strategies & gotchas' },
  tooling:   { icon: '⚙️', color: 'var(--muted)',  subtle: 'var(--card)',          desc: 'Build tools & developer experience' },
  patterns:  { icon: '🔁', color: 'var(--green)',  subtle: 'var(--green-subtle)',  desc: 'Reusable approaches that worked' },
  corrections: { icon: '⚠️', color: 'var(--red)',  subtle: 'var(--red-subtle)',    desc: 'Things that went wrong + fixes' },
  habits:    { icon: '⚡', color: 'var(--purple)', subtle: 'var(--purple-subtle)', desc: 'Confirmed workflow preferences' },
}

const DEFAULT_CONFIG: DomainConfig = {
  icon: '📝',
  color: 'var(--accent)',
  subtle: 'rgba(88,166,255,0.12)',
  desc: 'Learnings & notes',
}

const getDomainConfig = (domain: string): DomainConfig =>
  DOMAIN_CONFIG[domain] ?? DEFAULT_CONFIG

const formatDomainTitle = (domain: string): string =>
  domain.charAt(0).toUpperCase() + domain.slice(1).replace(/[-_]/g, ' ')

// ---------------------------------------------------------------------------
// Content styles
// ---------------------------------------------------------------------------

const contentStyles = `
  .notes-content h1, .notes-content h2, .notes-content h3 {
    color: var(--text);
    margin-top: 20px;
    margin-bottom: 8px;
  }
  .notes-content h1 { font-size: 18px; font-weight: 800; }
  .notes-content h2 { font-size: 15px; font-weight: 700; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  .notes-content h3 { font-size: 14px; font-weight: 600; }
  .notes-content p {
    color: var(--text-secondary);
    font-size: 14px;
    line-height: 1.7;
    margin-bottom: 12px;
  }
  .notes-content ul, .notes-content ol {
    color: var(--text-secondary);
    font-size: 14px;
    line-height: 1.7;
    padding-left: 20px;
    margin-bottom: 12px;
  }
  .notes-content li { margin-bottom: 4px; }
  .notes-content code {
    font-family: 'Fira Code', monospace;
    font-size: 13px;
    background: var(--bg);
    padding: 2px 6px;
    border-radius: 4px;
    color: var(--orange);
  }
  .notes-content pre {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 14px;
    overflow-x: auto;
    margin-bottom: 12px;
    font-family: 'Fira Code', monospace;
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.6;
  }
  .notes-content pre code { background: none; padding: 0; }
  .notes-content strong { color: var(--text); }
  .notes-content a { color: var(--accent); text-decoration: none; }
  .notes-content a:hover { text-decoration: underline; }
  .notes-content blockquote {
    border-left: 3px solid var(--orange);
    padding-left: 14px;
    margin: 12px 0;
    color: var(--muted);
    font-style: italic;
  }
  .notes-content hr { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
`

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

const LoadingSkeleton = () => (
  <div style={{ display: 'flex', gap: 16, padding: 24, height: 480 }}>
    <div style={{ width: 240, background: 'var(--card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', animation: 'pulse 1.5s ease-in-out infinite' }} />
    <div style={{ flex: 1, background: 'var(--card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', animation: 'pulse 1.5s ease-in-out infinite', animationDelay: '0.2s' }} />
    <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>
  </div>
)

const EmptyState = () => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 64, gap: 16 }}>
    <div style={{ fontSize: 48, opacity: 0.5 }}>🧭</div>
    <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--muted)' }}>No navigator's notes yet</div>
    <div style={{ fontSize: 14, color: 'var(--muted)' }}>Learnings from completed sessions will appear here.</div>
  </div>
)

const ErrorState = ({ message }: { message: string }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 48, gap: 12 }}>
    <div style={{ fontSize: 36 }}>⚠</div>
    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--red)' }}>Failed to load learnings</div>
    <div style={{ fontSize: 14, color: 'var(--muted)' }}>{message}</div>
  </div>
)

// ---------------------------------------------------------------------------
// Navigator Notes (exported)
// ---------------------------------------------------------------------------

export const NavigatorNotes = () => {
  const { repo } = useBoardContext()
  const { learnings, loading, error } = useLearnings(repo)
  const [activeDomain, setActiveDomain] = useState<string | null>(null)

  // Build sorted domain list from learnings data
  const domains = useMemo(() => {
    if (!learnings) return []
    return Object.keys(learnings)
      .filter((key) => learnings[key]?.trim())
      .sort((a, b) => {
        // Known domains first, then alphabetical
        const aKnown = a in DOMAIN_CONFIG ? 0 : 1
        const bKnown = b in DOMAIN_CONFIG ? 0 : 1
        if (aKnown !== bKnown) return aKnown - bKnown
        return a.localeCompare(b)
      })
  }, [learnings])

  // Auto-select first domain
  const selectedDomain = activeDomain && domains.includes(activeDomain)
    ? activeDomain
    : domains[0] ?? null

  if (loading) return <LoadingSkeleton />
  if (error) return <ErrorState message={error} />
  if (!learnings || domains.length === 0) return <EmptyState />

  const config = selectedDomain ? getDomainConfig(selectedDomain) : DEFAULT_CONFIG
  const content = selectedDomain ? (learnings[selectedDomain] ?? '') : ''

  // Count entries per domain (## headings)
  const countEntries = (text: string) => (text.match(/^## /gm) || []).length

  return (
    <div style={{ display: 'flex', gap: 16, padding: 24, minHeight: 480 }}>
      <style>{contentStyles}</style>

      {/* Left sidebar — domain list */}
      <nav
        style={{
          width: 240,
          flexShrink: 0,
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          overflowY: 'auto',
        }}
        aria-label="Learning domains"
      >
        <div style={{
          fontSize: 14, fontWeight: 700, color: 'var(--muted)',
          textTransform: 'uppercase', letterSpacing: 1,
          padding: '4px 8px', marginBottom: 4,
        }}>
          Domains ({domains.length})
        </div>

        {domains.map((domain, i) => {
          const domainConfig = getDomainConfig(domain)
          const isActive = selectedDomain === domain
          const count = countEntries(learnings[domain] ?? '')
          return (
            <motion.button
              key={domain}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03, duration: 0.2 }}
              onClick={() => setActiveDomain(domain)}
              aria-current={isActive ? 'page' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: isActive ? domainConfig.subtle : 'transparent',
                color: isActive ? domainConfig.color : 'var(--text-secondary)',
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 200ms ease',
                borderLeft: isActive ? `3px solid ${domainConfig.color}` : '3px solid transparent',
              }}
            >
              <span style={{ fontSize: 16 }}>{domainConfig.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {formatDomainTitle(domain)}
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {domainConfig.desc}
                </div>
              </div>
              {count > 0 && (
                <span style={{
                  fontSize: 13, fontWeight: 600, color: 'var(--muted)',
                  background: 'var(--bg)', padding: '1px 6px', borderRadius: 8,
                  flexShrink: 0,
                }}>
                  {count}
                </span>
              )}
            </motion.button>
          )
        })}
      </nav>

      {/* Right panel — content */}
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
            key={selectedDomain}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
          >
            {/* Header */}
            {selectedDomain && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, paddingBottom: 12, borderBottom: `2px solid ${config.color}33` }}>
                  <span style={{ fontSize: 22 }}>{config.icon}</span>
                  <div>
                    <h2 style={{ fontSize: 18, fontWeight: 800, color: config.color }}>{formatDomainTitle(selectedDomain)}</h2>
                    <p style={{ fontSize: 14, color: 'var(--muted)', margin: 0 }}>{config.desc}</p>
                  </div>
                </div>

                {/* Rendered markdown content */}
                {content.trim() ? (
                  <div className="notes-content">
                    <Markdown>{content}</Markdown>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 14, fontStyle: 'italic' }}>
                    No {formatDomainTitle(selectedDomain).toLowerCase()} notes recorded yet.
                  </div>
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
