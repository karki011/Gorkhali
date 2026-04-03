// =============================================================================
// Straw Hat Board — Captain's Log (Story Chapters)
// Author: Subash Karki
//
// Split-panel layout: chapter list on the left, rendered content on the right.
// Chapters loaded from the /api/story endpoint via useStory().
// =============================================================================

import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import Markdown from 'react-markdown'
import { useStory } from '../hooks/useApi.ts'

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
    <div style={{ fontSize: 48, opacity: 0.5 }}>📖</div>
    <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--muted)' }}>
      No tales have been written yet...
    </div>
    <div style={{ fontSize: 14, color: 'var(--muted)' }}>
      Completed sessions will have their stories archived here.
    </div>
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
      padding: 48,
      gap: 12,
    }}
  >
    <div style={{ fontSize: 36 }}>⚠</div>
    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--red)' }}>
      Failed to load the Captain's Log
    </div>
    <div style={{ fontSize: 14, color: 'var(--muted)' }}>{message}</div>
  </div>
)

// ---------------------------------------------------------------------------
// Content styles for rendered markdown-like content
// ---------------------------------------------------------------------------

const contentStyles = `
  .chapter-content h1, .chapter-content h2, .chapter-content h3 {
    color: var(--text);
    margin-top: 20px;
    margin-bottom: 8px;
  }
  .chapter-content h1 { font-size: 20px; font-weight: 800; }
  .chapter-content h2 { font-size: 16px; font-weight: 700; }
  .chapter-content h3 { font-size: 14px; font-weight: 600; }
  .chapter-content p {
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.7;
    margin-bottom: 12px;
  }
  .chapter-content ul, .chapter-content ol {
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.7;
    padding-left: 20px;
    margin-bottom: 12px;
  }
  .chapter-content code {
    font-family: 'Fira Code', monospace;
    font-size: 12px;
    background: var(--bg);
    padding: 2px 6px;
    border-radius: 4px;
    color: var(--orange);
  }
  .chapter-content pre {
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
  .chapter-content pre code {
    background: none;
    padding: 0;
  }
  .chapter-content strong { color: var(--text); }
  .chapter-content a {
    color: var(--accent);
    text-decoration: none;
  }
  .chapter-content a:hover {
    text-decoration: underline;
  }
  .chapter-content blockquote {
    border-left: 3px solid var(--orange);
    padding-left: 14px;
    margin: 12px 0;
    color: var(--muted);
    font-style: italic;
  }
  .chapter-content hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 20px 0;
  }
`

// ---------------------------------------------------------------------------
// Captain's Log (exported)
// ---------------------------------------------------------------------------

export const CaptainsLog = () => {
  const { story, loading, error } = useStory()
  const [activeIndex, setActiveIndex] = useState(0)

  if (loading) return <LoadingSkeleton />
  if (error) return <ErrorState message={error} />
  if (!story || !story.chapters || story.chapters.length === 0) return <EmptyState />

  const chapters = story.chapters
  const active = chapters[activeIndex] ?? chapters[0]

  return (
    <div style={{ display: 'flex', gap: 16, padding: 24, minHeight: 480 }}>
      <style>{contentStyles}</style>

      {/* Left sidebar — chapter list */}
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
        aria-label="Chapter navigation"
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
          Chapters ({chapters.length})
        </div>

        {chapters.map((chapter, i) => (
          <motion.button
            key={chapter.file ?? i}
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
              fontSize: 14,
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
            {chapter.title}
          </motion.button>
        ))}
      </nav>

      {/* Right panel — chapter content */}
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
                marginBottom: 4,
              }}
            >
              {active.title}
            </h2>
            {active.file && (
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--muted)',
                  fontFamily: "'Fira Code', monospace",
                  marginBottom: 16,
                }}
              >
                {active.file}
              </div>
            )}
            <div
              style={{
                borderTop: '1px solid var(--border)',
                paddingTop: 16,
              }}
              className="chapter-content"
            >
              <Markdown>{active.content}</Markdown>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
