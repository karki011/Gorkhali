// =============================================================================
// Phantom Works Board — Changelog
// Author: Subash Karki
//
// Split-panel layout: version list on the left, version content on the right.
// Parses ## headings from CHANGELOG.md as version entries.
// Fetched from /api/changelog via useChangelog().
// =============================================================================

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import Markdown from 'react-markdown'
import { useChangelog } from '../hooks/useApi.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VersionEntry {
  title: string
  content: string
}

// ---------------------------------------------------------------------------
// Parse changelog into version sections (split on ## headings)
// ---------------------------------------------------------------------------

const parseVersions = (raw: string): VersionEntry[] => {
  const lines = raw.split('\n')
  const versions: VersionEntry[] = []
  let current: VersionEntry | null = null

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) versions.push(current)
      current = { title: line.replace('## ', '').trim(), content: '' }
    } else if (current) {
      current.content += line + '\n'
    }
  }
  if (current) versions.push(current)

  return versions
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
        animation: 'pulse 1.5s ease-in-out infinite',
      }}
    />
    <div
      style={{
        flex: 1,
        background: 'var(--card)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        animation: 'pulse 1.5s ease-in-out infinite',
        animationDelay: '0.2s',
      }}
    />
    <style>{`
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
    `}</style>
  </div>
)

// ---------------------------------------------------------------------------
// Error State
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
    <div style={{ fontSize: 36 }}>⚠</div>
    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--red)' }}>
      Failed to load Changelog
    </div>
    <div style={{ fontSize: 14, color: 'var(--muted)' }}>{message}</div>
  </div>
)

// ---------------------------------------------------------------------------
// Empty State
// ---------------------------------------------------------------------------

const EmptyState = () => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 64,
      gap: 16,
    }}
  >
    <div style={{ fontSize: 48, opacity: 0.5 }}>📋</div>
    <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--muted)' }}>
      No changelog entries yet...
    </div>
    <div style={{ fontSize: 14, color: 'var(--muted)' }}>
      Changes will be documented here as they ship.
    </div>
  </div>
)

// ---------------------------------------------------------------------------
// Scoped content styles
// ---------------------------------------------------------------------------

const contentStyles = `
  .changelog-content h1, .changelog-content h2, .changelog-content h3 {
    color: var(--text);
    margin-top: 24px;
    margin-bottom: 8px;
  }
  .changelog-content h1 { font-size: 22px; font-weight: 800; }
  .changelog-content h2 { font-size: 17px; font-weight: 700; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  .changelog-content h3 { font-size: 14px; font-weight: 600; }
  .changelog-content p {
    color: var(--text-secondary);
    font-size: 14px;
    line-height: 1.75;
    margin-bottom: 12px;
  }
  .changelog-content ul, .changelog-content ol {
    color: var(--text-secondary);
    font-size: 14px;
    line-height: 1.75;
    padding-left: 22px;
    margin-bottom: 12px;
  }
  .changelog-content li { margin-bottom: 4px; }
  .changelog-content code {
    font-family: 'Fira Code', monospace;
    font-size: 12px;
    background: var(--bg);
    padding: 2px 6px;
    border-radius: 4px;
    color: var(--orange);
  }
  .changelog-content pre {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 14px;
    overflow-x: auto;
    margin-bottom: 12px;
    font-family: 'Fira Code', monospace;
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.6;
  }
  .changelog-content pre code {
    background: none;
    padding: 0;
  }
  .changelog-content strong { color: var(--text); }
  .changelog-content a {
    color: var(--accent);
    text-decoration: none;
  }
  .changelog-content a:hover {
    text-decoration: underline;
  }
  .changelog-content blockquote {
    border-left: 3px solid var(--orange);
    padding-left: 14px;
    margin: 12px 0;
    color: var(--muted);
    font-style: italic;
  }
  .changelog-content hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 24px 0;
  }
  .changelog-content table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 16px;
    font-size: 13px;
  }
  .changelog-content th, .changelog-content td {
    border: 1px solid var(--border);
    padding: 6px 10px;
    text-align: left;
    color: var(--text-secondary);
  }
  .changelog-content th {
    background: var(--bg);
    font-weight: 600;
    color: var(--text);
  }
`

// ---------------------------------------------------------------------------
// Changelog (exported)
// ---------------------------------------------------------------------------

export const Changelog = () => {
  const { content, loading, error } = useChangelog()
  const [activeIndex, setActiveIndex] = useState(0)

  const versions = useMemo(() => (content ? parseVersions(content) : []), [content])

  if (loading) return <LoadingSkeleton />
  if (error) return <ErrorState message={error} />
  if (!content || versions.length === 0) return <EmptyState />

  const active = versions[activeIndex] ?? versions[0]

  return (
    <div style={{ display: 'flex', gap: 16, padding: 24, minHeight: 480 }}>
      <style>{contentStyles}</style>

      {/* Left sidebar — version list */}
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
        aria-label="Version navigation"
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
          }}
        >
          Versions ({versions.length})
        </div>

        {versions.map((version, i) => (
          <motion.button
            key={version.title}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05, duration: 0.2 }}
            onClick={() => setActiveIndex(i)}
            aria-current={i === activeIndex ? 'page' : undefined}
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: i === activeIndex ? 'var(--orange-subtle)' : 'transparent',
              color: i === activeIndex ? 'var(--orange)' : 'var(--text-secondary)',
              fontSize: 13,
              fontWeight: i === activeIndex ? 600 : 400,
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 200ms ease',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              borderLeft: i === activeIndex ? '3px solid var(--orange)' : '3px solid transparent',
            }}
          >
            {version.title}
          </motion.button>
        ))}
      </nav>

      {/* Right panel — version content */}
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
            key={activeIndex}
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
              }}
            >
              {active.title}
            </h2>
            <div className="changelog-content">
              <Markdown>{active.content}</Markdown>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
