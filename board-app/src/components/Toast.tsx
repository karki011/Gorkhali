// =============================================================================
// Toast notification system
// Author: Subash Karki
// =============================================================================

import { useState, useCallback, useRef, createContext, useContext } from 'react'
import { motion, AnimatePresence } from 'motion/react'

export interface ToastItem {
  id: number
  message: string
  type: 'info' | 'success' | 'warning'
  action?: { label: string; onClick: () => void }
}

interface ToastContextValue {
  toast: (message: string, type?: ToastItem['type'], action?: ToastItem['action']) => void
}

const ToastCtx = createContext<ToastContextValue>({ toast: () => {} })
export const useToast = () => useContext(ToastCtx)

const TOAST_COLORS = {
  info:    { bg: 'var(--accent)',  subtle: 'rgba(88,166,255,0.15)' },
  success: { bg: 'var(--green)',   subtle: 'var(--green-subtle)' },
  warning: { bg: 'var(--orange)',  subtle: 'var(--orange-subtle)' },
}

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const idRef = useRef(0)

  const toast = useCallback((message: string, type: ToastItem['type'] = 'info', action?: ToastItem['action']) => {
    const id = ++idRef.current
    setToasts(prev => [...prev, { id, message, type, action }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}

      {/* Toast container — bottom-right */}
      <div
        style={{
          position: 'fixed',
          top: 80,
          right: 20,
          zIndex: 300,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          maxWidth: 400,
        }}
      >
        <AnimatePresence>
          {toasts.map(t => {
            const colors = TOAST_COLORS[t.type]
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, x: 60, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 60, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                style={{
                  background: 'var(--card)',
                  border: `1px solid ${colors.bg}44`,
                  borderLeft: `4px solid ${colors.bg}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 16px',
                  boxShadow: 'var(--shadow-lg)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  cursor: t.action ? 'pointer' : 'default',
                }}
                onClick={() => {
                  if (t.action) t.action.onClick()
                  dismiss(t.id)
                }}
              >
                {/* Icon */}
                <span style={{ fontSize: 18, flexShrink: 0 }}>
                  {t.type === 'success' ? '✅' : t.type === 'warning' ? '⛵' : 'ℹ️'}
                </span>

                {/* Message */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4 }}>
                    {t.message}
                  </div>
                  {t.action && (
                    <div style={{ fontSize: 12, color: colors.bg, fontWeight: 600, marginTop: 2 }}>
                      {t.action.label} →
                    </div>
                  )}
                </div>

                {/* Dismiss */}
                <button
                  onClick={(e) => { e.stopPropagation(); dismiss(t.id) }}
                  style={{
                    background: 'none', border: 'none', color: 'var(--muted)',
                    cursor: 'pointer', fontSize: 16, padding: 4, flexShrink: 0,
                  }}
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}
