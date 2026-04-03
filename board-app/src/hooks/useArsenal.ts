// =============================================================================
// Straw Hat Board — Arsenal Data Hook
// Author: Subash Karki
// =============================================================================

import { useFetch, buildUrl } from './useApi.ts'
import type { ArsenalData } from '../types.ts'

interface ArsenalResult {
  arsenal: ArsenalData | null
  loading: boolean
  error: string | null
}

export const useArsenal = (repo?: string): ArsenalResult => {
  const { data, loading, error } = useFetch<ArsenalData | null>(
    buildUrl('/api/arsenal', repo),
    null,
  )
  return { arsenal: data, loading, error }
}
