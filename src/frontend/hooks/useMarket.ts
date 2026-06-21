import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addMarketWatchlistSymbols,
  analyzeMarketNarrative,
  fetchMarketOverview,
  removeMarketWatchlistSymbol,
  runMarketReport,
} from '../api.js'
import type { MarketNarrative, MarketOverview, MarketReport } from '../types.js'

export function useMarket(active: boolean) {
  const [overview, setOverview] = useState<MarketOverview | null>(null)
  const [analyzedNarratives, setAnalyzedNarratives] = useState<MarketNarrative[]>([])
  const [reports, setReports] = useState<MarketReport[]>([])
  const [loading, setLoading] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const next = await fetchMarketOverview()
      setOverview(next)
      setError(null)
      return next
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setError(message)
      throw error
    } finally {
      setLoading(false)
    }
  }, [])

  const addSymbols = useCallback(async (symbols: string[]) => {
    setMutating(true)
    try {
      await addMarketWatchlistSymbols(symbols)
      const next = await fetchMarketOverview()
      setOverview(next)
      setError(null)
      return next.watchlist
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setError(message)
      throw error
    } finally {
      setMutating(false)
    }
  }, [])

  const removeSymbol = useCallback(async (symbol: string) => {
    setMutating(true)
    try {
      await removeMarketWatchlistSymbol(symbol)
      const next = await fetchMarketOverview()
      setOverview(next)
      setError(null)
      return next.watchlist
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setError(message)
      throw error
    } finally {
      setMutating(false)
    }
  }, [])

  const analyzeNarrative = useCallback(async (content: string) => {
    setMutating(true)
    try {
      const narrative = await analyzeMarketNarrative(content)
      setAnalyzedNarratives((prev) => [narrative, ...prev.filter((item) => item.id !== narrative.id)])
      setError(null)
      return narrative
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setError(message)
      throw error
    } finally {
      setMutating(false)
    }
  }, [])

  const runReport = useCallback(async (kind: MarketReport['kind']) => {
    setMutating(true)
    try {
      const report = await runMarketReport(kind)
      setReports((prev) => [report, ...prev.filter((item) => item.id !== report.id)].slice(0, 12))
      setError(null)
      return report
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setError(message)
      throw error
    } finally {
      setMutating(false)
    }
  }, [])

  const narratives = useMemo(() => {
    const existingIds = new Set(analyzedNarratives.map((item) => item.id))
    return [
      ...analyzedNarratives,
      ...(overview?.narratives || []).filter((item) => !existingIds.has(item.id)),
    ]
  }, [analyzedNarratives, overview?.narratives])

  useEffect(() => {
    if (!active) {
      return
    }
    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [active, refresh])

  return {
    overview,
    narratives,
    reports,
    loading,
    mutating,
    error,
    refresh,
    addSymbols,
    removeSymbol,
    analyzeNarrative,
    runReport,
  }
}
