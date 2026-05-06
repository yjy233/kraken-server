import { useCallback, useEffect, useState } from 'react'
import { fetchModelUsage } from '../api.js'
import type { ModelUsageSummary } from '../types.js'

export function useModelUsage(active: boolean) {
  const [summary, setSummary] = useState<ModelUsageSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const next = await fetchModelUsage()
      setSummary(next)
      setError(null)
      return next
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!active) {
      return
    }
    void refresh()
  }, [active, refresh])

  return {
    summary,
    loading,
    error,
    refresh,
  }
}
