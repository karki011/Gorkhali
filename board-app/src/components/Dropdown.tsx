// =============================================================================
// Custom Dropdown — Replaces native <select> with themed, animated dropdown
// Author: Subash Karki
// =============================================================================

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'

export interface DropdownOption {
  value: string
  label: string
  sublabel?: string
}

interface DropdownProps {
  options: DropdownOption[]
  value: string
  onChange: (value: string) => void
  label?: string
  placeholder?: string
  'aria-label'?: string
  maxWidth?: number
  minWidth?: number
}

export const Dropdown = ({
  options,
  value,
  onChange,
  label,
  placeholder = 'Select...',
  'aria-label': ariaLabel,
  maxWidth = 220,
  minWidth = 140,
}: DropdownProps) => {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selected = options.find(o => o.value === value)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {label && (
        <span style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--muted)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}>
          {label}
        </span>
      )}

      {/* Trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={ariaLabel || label}
        aria-expanded={open}
        aria-haspopup="listbox"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '6px 10px',
          borderRadius: 'var(--radius-sm)',
          border: `1px solid ${open ? 'var(--orange)' : 'var(--border)'}`,
          background: 'var(--card)',
          color: 'var(--text)',
          fontSize: 14,
          fontFamily: "'Fira Code', monospace",
          cursor: 'pointer',
          outline: 'none',
          transition: 'all 200ms ease',
          maxWidth,
          minWidth,
          textAlign: 'left',
        }}
      >
        <span style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          color: selected ? 'var(--text)' : 'var(--muted)',
        }}>
          {selected?.label || placeholder}
        </span>
        <motion.svg
          width="12" height="12" viewBox="0 0 24 24"
          fill="none" stroke="var(--muted)" strokeWidth="2"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          style={{ flexShrink: 0 }}
        >
          <path d="M6 9l6 6 6-6" />
        </motion.svg>
      </button>

      {/* Menu */}
      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: 4,
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              boxShadow: 'var(--shadow-lg)',
              zIndex: 100,
              listStyle: 'none',
              padding: 4,
              maxHeight: 240,
              overflowY: 'auto',
              minWidth,
              maxWidth: maxWidth + 40,
            }}
          >
            {options.map(opt => {
              const isSelected = opt.value === value
              return (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => { onChange(opt.value); setOpen(false) }}
                  style={{
                    padding: '7px 10px',
                    borderRadius: 6,
                    fontSize: 14,
                    fontFamily: "'Fira Code', monospace",
                    cursor: 'pointer',
                    background: isSelected ? 'var(--orange-subtle)' : 'transparent',
                    color: isSelected ? 'var(--orange)' : 'var(--text)',
                    fontWeight: isSelected ? 600 : 400,
                    transition: 'all 150ms ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--card-hover)'
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = isSelected ? 'var(--orange-subtle)' : 'transparent'
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {opt.label}
                  </span>
                  {opt.sublabel && (
                    <span style={{ fontSize: 14, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {opt.sublabel}
                    </span>
                  )}
                </li>
              )
            })}
            {options.length === 0 && (
              <li style={{ padding: '8px 10px', fontSize: 14, color: 'var(--muted)', textAlign: 'center' }}>
                No options
              </li>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}
