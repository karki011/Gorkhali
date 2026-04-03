// =============================================================================
// Straw Hat Board — Theme Management
// Author: Subash Karki
//
// Persists to localStorage, applies via data-theme attribute on <html>.
// Dark is the default (no attribute). Light and pirate set data-theme.
// =============================================================================

import { useState, useCallback, useEffect } from 'react'

export type Theme = 'dark' | 'light' | 'pirate'

const STORAGE_KEY = 'sh-board-theme'
const CYCLE_ORDER: Theme[] = ['dark', 'light', 'pirate']

const isValidTheme = (value: unknown): value is Theme =>
  typeof value === 'string' && CYCLE_ORDER.includes(value as Theme)

const readStoredTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null && isValidTheme(stored)) {
      return stored
    }
  } catch {
    // localStorage may be blocked in some contexts
  }
  return 'dark'
}

const applyThemeToDOM = (theme: Theme): void => {
  if (theme === 'dark') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', theme)
  }
}

const persistTheme = (theme: Theme): void => {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Silently fail if storage is unavailable
  }
}

interface ThemeResult {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

export const useTheme = (): ThemeResult => {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme)

  // Apply theme to DOM on mount and whenever it changes
  useEffect(() => {
    applyThemeToDOM(theme)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    persistTheme(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const currentIndex = CYCLE_ORDER.indexOf(current)
      const nextIndex = (currentIndex + 1) % CYCLE_ORDER.length
      const next = CYCLE_ORDER[nextIndex]
      persistTheme(next)
      return next
    })
  }, [])

  return { theme, setTheme, toggleTheme }
}
