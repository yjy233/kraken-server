import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchDragonTigerBrokerTrades,
  fetchDragonTigerDailyStocks,
  fetchDragonTigerInstitutions,
  fetchDragonTigerSeats,
  fetchDragonTigerStocks,
  fetchMarketAlerts,
  fetchMarketHotStocks,
  fetchMarketSectors,
  fetchMarketTechnical,
} from '../api.js'
import type {
  DragonTigerBrokerTrade,
  DragonTigerDailyStock,
  DragonTigerInstitutionSeat,
  DragonTigerSeat,
  DragonTigerStock,
  HotStockSignal,
  HotStockSourceStatus,
  InfluencerPost,
  MarketBar,
  MarketAlert,
  MarketNarrative,
  MarketOverview,
  MarketReport,
  QuoteSnapshot,
  SectorHeat,
  TechnicalSignal,
} from '../types.js'

type MarketView = 'overview' | 'watchlist' | 'hotstocks' | 'dragontiger' | 'sectors' | 'narratives' | 'technicals' | 'alerts' | 'reports'
type TechnicalTimeframe = '1m' | '5m' | '15m' | '30m' | '60m' | '1d' | '1mo' | '1y'

interface MarketPanelProps {
  overview: MarketOverview | null
  narratives: MarketNarrative[]
  reports: MarketReport[]
  loading: boolean
  mutating: boolean
  error: string | null
  onRefresh: () => Promise<unknown>
  onAddSymbols: (symbols: string[]) => Promise<unknown>
  onRemoveSymbol: (symbol: string) => Promise<unknown>
  onAnalyzeNarrative: (content: string) => Promise<unknown>
  onRunReport: (kind: MarketReport['kind']) => Promise<unknown>
}

export const MarketPanel: React.FC<MarketPanelProps> = ({
  overview,
  narratives,
  reports,
  loading,
  mutating,
  error,
  onRefresh,
  onAddSymbols,
  onRemoveSymbol,
  onAnalyzeNarrative,
  onRunReport,
}) => {
  const [activeView, setActiveView] = useState<MarketView>('overview')
  const [symbolInput, setSymbolInput] = useState('')
  const [narrativeInput, setNarrativeInput] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const [technicalTimeframe, setTechnicalTimeframe] = useState<TechnicalTimeframe>('1d')
  const [extraTechnicals, setExtraTechnicals] = useState<Record<string, TechnicalSignal>>({})
  const [technicalLoadingKey, setTechnicalLoadingKey] = useState<string | null>(null)
  const [technicalError, setTechnicalError] = useState<{ key: string; message: string } | null>(null)
  const [dragonTigerSeats, setDragonTigerSeats] = useState<Record<string, DragonTigerSeat[]>>({})
  const [dragonTigerSeatLoadingKey, setDragonTigerSeatLoadingKey] = useState<string | null>(null)
  const [dragonTigerSeatError, setDragonTigerSeatError] = useState<string | null>(null)
  const [dragonTigerStocks, setDragonTigerStocks] = useState<DragonTigerStock[]>([])
  const [dragonTigerStocksLoading, setDragonTigerStocksLoading] = useState(false)
  const [dragonTigerStocksError, setDragonTigerStocksError] = useState<string | null>(null)
  const [dragonTigerDailyStocks, setDragonTigerDailyStocks] = useState<DragonTigerDailyStock[]>([])
  const [dragonTigerDailyStocksLoading, setDragonTigerDailyStocksLoading] = useState(false)
  const [dragonTigerDailyStocksError, setDragonTigerDailyStocksError] = useState<string | null>(null)
  const [dragonTigerBrokerTrades, setDragonTigerBrokerTrades] = useState<Record<string, DragonTigerBrokerTrade[]>>({})
  const [dragonTigerBrokerTradeLoadingKey, setDragonTigerBrokerTradeLoadingKey] = useState<string | null>(null)
  const [dragonTigerBrokerTradeError, setDragonTigerBrokerTradeError] = useState<string | null>(null)
  const [dragonTigerInstitutions, setDragonTigerInstitutions] = useState<DragonTigerInstitutionSeat[]>([])
  const [dragonTigerInstitutionsLoading, setDragonTigerInstitutionsLoading] = useState(false)
  const [dragonTigerInstitutionsError, setDragonTigerInstitutionsError] = useState<string | null>(null)
  const [extraSectors, setExtraSectors] = useState<SectorHeat[]>([])
  const [sectorsLoading, setSectorsLoading] = useState(false)
  const [sectorsError, setSectorsError] = useState<string | null>(null)
  const [extraAlerts, setExtraAlerts] = useState<MarketAlert[]>([])
  const [alertsLoading, setAlertsLoading] = useState(false)
  const [alertsError, setAlertsError] = useState<string | null>(null)
  const [extraHotStocks, setExtraHotStocks] = useState<MarketOverview['hotStocks']>([])
  const [extraHotStockQuotes, setExtraHotStockQuotes] = useState<QuoteSnapshot[]>([])
  const [extraHotStockStatus, setExtraHotStockStatus] = useState<HotStockSourceStatus | null>(null)
  const [hotStocksLoading, setHotStocksLoading] = useState(false)
  const [hotStocksError, setHotStocksError] = useState<string | null>(null)

  const marketQuotes = useMemo(() => {
    return mergeQuotes(overview?.quotes || [], overview?.hotStockQuotes || [], extraHotStockQuotes)
  }, [extraHotStockQuotes, overview?.hotStockQuotes, overview?.quotes])

  const quotesBySymbol = useMemo(() => {
    return new Map(marketQuotes.map((quote) => [quote.symbol, quote]))
  }, [marketQuotes])

  const technicalsBySymbol = useMemo(() => {
    const items = new Map<string, TechnicalSignal>()
    for (const technical of Object.values(extraTechnicals)) {
      items.set(buildTechnicalKey(technical.symbol, technical.timeframe as TechnicalTimeframe), technical)
    }
    for (const technical of overview?.technicals || []) {
      items.set(buildTechnicalKey(technical.symbol, technical.timeframe as TechnicalTimeframe), technical)
    }
    return items
  }, [extraTechnicals, overview?.technicals])

  const effectiveSectors = extraSectors.length > 0 ? extraSectors : (overview?.sectors || [])
  const effectiveAlerts = extraAlerts.length > 0 ? extraAlerts : (overview?.alerts || [])
  const effectiveHotStocks = extraHotStocks.length > 0 ? extraHotStocks : (overview?.hotStocks || [])
  const effectiveHotStockStatus = extraHotStockStatus || overview?.hotStockStatus || null
  const visibleDragonTigerStocks = useMemo(() => {
    return dragonTigerStocks.length > 0 ? dragonTigerStocks : (overview?.dragonTigerStocks || [])
  }, [dragonTigerStocks, overview?.dragonTigerStocks])
  const selectedTechnicalSymbol = selectedSymbol || marketQuotes[0]?.symbol || effectiveHotStocks[0]?.symbol || visibleDragonTigerStocks[0]?.symbol || ''
  const selectedTechnicalKey = buildTechnicalKey(selectedTechnicalSymbol, technicalTimeframe)
  const selectedTechnical = selectedTechnicalSymbol
    ? technicalsBySymbol.get(selectedTechnicalKey) || null
    : null
  const mergedTechnicals = useMemo(() => Array.from(technicalsBySymbol.values()), [technicalsBySymbol])
  const hotStocksOverview = useMemo(() => {
    if (!overview || !effectiveHotStockStatus) {
      return overview
    }
    return {
      ...overview,
      sectors: effectiveSectors,
      alerts: effectiveAlerts,
      hotStocks: effectiveHotStocks,
      hotStockQuotes: extraHotStockQuotes.length > 0 ? extraHotStockQuotes : overview.hotStockQuotes,
      hotStockStatus: effectiveHotStockStatus,
    }
  }, [effectiveAlerts, effectiveHotStockStatus, effectiveHotStocks, effectiveSectors, extraHotStockQuotes, overview])

  const handleSelectSymbol = useCallback((symbol: string) => {
    setSelectedSymbol(symbol)
    setTechnicalError(null)
  }, [])

  useEffect(() => {
    if (activeView !== 'technicals' || !selectedTechnicalSymbol || selectedTechnical) {
      return
    }
    if (technicalError?.key === selectedTechnicalKey) {
      return
    }
    let cancelled = false
    const symbol = selectedTechnicalSymbol
    const key = selectedTechnicalKey
    const timeframe = technicalTimeframe
    setTechnicalLoadingKey(key)
    void fetchMarketTechnical(symbol, timeframe)
      .then((technical) => {
        if (cancelled) {
          return
        }
        setExtraTechnicals((prev) => ({ ...prev, [buildTechnicalKey(technical.symbol, timeframe)]: technical }))
        setTechnicalError(null)
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        setTechnicalError({
          key,
          message: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => {
        if (cancelled) {
          return
        }
        setTechnicalLoadingKey((current) => current === key ? null : current)
      })
    return () => {
      cancelled = true
      setTechnicalLoadingKey((current) => current === key ? null : current)
    }
  }, [activeView, selectedTechnical, selectedTechnicalKey, selectedTechnicalSymbol, technicalError?.key, technicalTimeframe])

  useEffect(() => {
    if (activeView !== 'sectors' || extraSectors.length > 0 || sectorsLoading || Boolean(sectorsError)) {
      return
    }
    let cancelled = false
    setSectorsLoading(true)
    void fetchMarketSectors()
      .then((rows) => {
        if (cancelled) return
        setExtraSectors(rows)
        setSectorsError(null)
      })
      .catch((error) => {
        if (cancelled) return
        setSectorsError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (cancelled) return
        setSectorsLoading(false)
      })
    return () => {
      cancelled = true
      setSectorsLoading(false)
    }
  }, [activeView, extraSectors.length, sectorsError])

  useEffect(() => {
    if (activeView !== 'alerts' || extraAlerts.length > 0 || alertsLoading || Boolean(alertsError)) {
      return
    }
    let cancelled = false
    setAlertsLoading(true)
    void fetchMarketAlerts()
      .then((rows) => {
        if (cancelled) return
        setExtraAlerts(rows)
        setAlertsError(null)
      })
      .catch((error) => {
        if (cancelled) return
        setAlertsError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (cancelled) return
        setAlertsLoading(false)
      })
    return () => {
      cancelled = true
      setAlertsLoading(false)
    }
  }, [activeView, alertsError, extraAlerts.length])

  useEffect(() => {
    if (activeView !== 'hotstocks' || extraHotStockStatus || hotStocksLoading || Boolean(hotStocksError)) {
      return
    }
    let cancelled = false
    setHotStocksLoading(true)
    void fetchMarketHotStocks()
      .then((payload) => {
        if (cancelled) return
        setExtraHotStocks(payload.hotStocks)
        setExtraHotStockQuotes(payload.quotes)
        setExtraHotStockStatus(payload.status)
        setHotStocksError(null)
      })
      .catch((error) => {
        if (cancelled) return
        setHotStocksError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (cancelled) return
        setHotStocksLoading(false)
      })
    return () => {
      cancelled = true
      setHotStocksLoading(false)
    }
  }, [activeView, extraHotStockStatus, hotStocksError])

  useEffect(() => {
    if (activeView !== 'dragontiger' || visibleDragonTigerStocks.length > 0 || dragonTigerStocksLoading || Boolean(dragonTigerStocksError)) {
      return
    }
    let cancelled = false
    setDragonTigerStocksLoading(true)
    void fetchDragonTigerStocks()
      .then((rows) => {
        if (cancelled) return
        setDragonTigerStocks(rows)
        setDragonTigerStocksError(null)
      })
      .catch((error) => {
        if (cancelled) return
        setDragonTigerStocksError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (cancelled) return
        setDragonTigerStocksLoading(false)
      })
    return () => {
      cancelled = true
      setDragonTigerStocksLoading(false)
    }
  }, [activeView, dragonTigerStocksError, visibleDragonTigerStocks.length])

  useEffect(() => {
    if (activeView !== 'dragontiger' || dragonTigerDailyStocks.length > 0 || dragonTigerDailyStocksLoading || Boolean(dragonTigerDailyStocksError)) {
      return
    }
    let cancelled = false
    setDragonTigerDailyStocksLoading(true)
    void fetchDragonTigerDailyStocks()
      .then((rows) => {
        if (cancelled) return
        setDragonTigerDailyStocks(rows)
        setDragonTigerDailyStocksError(null)
      })
      .catch((error) => {
        if (cancelled) return
        setDragonTigerDailyStocksError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (cancelled) return
        setDragonTigerDailyStocksLoading(false)
      })
    return () => {
      cancelled = true
      setDragonTigerDailyStocksLoading(false)
    }
  }, [activeView, dragonTigerDailyStocks.length, dragonTigerDailyStocksError])

  useEffect(() => {
    if (
      activeView !== 'dragontiger' ||
      visibleDragonTigerStocks.length === 0 ||
      dragonTigerInstitutions.length > 0 ||
      dragonTigerInstitutionsLoading ||
      Boolean(dragonTigerInstitutionsError)
    ) {
      return
    }
    let cancelled = false
    setDragonTigerInstitutionsLoading(true)
    void fetchDragonTigerInstitutions()
      .then((rows) => {
        if (cancelled) return
        setDragonTigerInstitutions(rows)
        setDragonTigerInstitutionsError(null)
      })
      .catch((error) => {
        if (cancelled) return
        setDragonTigerInstitutionsError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (cancelled) return
        setDragonTigerInstitutionsLoading(false)
      })
    return () => {
      cancelled = true
      setDragonTigerInstitutionsLoading(false)
    }
  }, [activeView, dragonTigerInstitutions.length, dragonTigerInstitutionsError, visibleDragonTigerStocks.length])

  const handleLoadDragonTigerSeats = useCallback(async (stock: DragonTigerStock) => {
    const key = `${stock.symbol}:${stock.latestListedAt}`
    if (dragonTigerSeats[key]) {
      return
    }
    setDragonTigerSeatLoadingKey(key)
    setDragonTigerSeatError(null)
    try {
      const rows = await fetchDragonTigerSeats(stock.symbol, stock.latestListedAt)
      setDragonTigerSeats((prev) => ({ ...prev, [key]: rows }))
    } catch (error) {
      setDragonTigerSeatError(error instanceof Error ? error.message : String(error))
    } finally {
      setDragonTigerSeatLoadingKey((current) => current === key ? null : current)
    }
  }, [dragonTigerSeats])

  const handleLoadDragonTigerBrokerTrades = useCallback(async (seat: DragonTigerSeat) => {
    const key = `${seat.brokerName}:${seat.tradeDate}`
    if (dragonTigerBrokerTrades[key]) {
      return
    }
    setDragonTigerBrokerTradeLoadingKey(key)
    setDragonTigerBrokerTradeError(null)
    try {
      const rows = await fetchDragonTigerBrokerTrades(seat.brokerName, seat.tradeDate)
      setDragonTigerBrokerTrades((prev) => ({ ...prev, [key]: rows }))
    } catch (error) {
      setDragonTigerBrokerTradeError(error instanceof Error ? error.message : String(error))
    } finally {
      setDragonTigerBrokerTradeLoadingKey((current) => current === key ? null : current)
    }
  }, [dragonTigerBrokerTrades])

  const handleAddSymbols = async (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)
    const symbols = symbolInput
      .split(/[,\s，、]+/)
      .map((item) => item.trim())
      .filter(Boolean)
    if (symbols.length === 0) {
      setFormError('Enter at least one symbol.')
      return
    }
    try {
      await onAddSymbols(symbols)
      setSymbolInput('')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleAnalyzeNarrative = async (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)
    if (!narrativeInput.trim()) {
      setFormError('Paste a market note before analyzing.')
      return
    }
    try {
      await onAnalyzeNarrative(narrativeInput)
      setNarrativeInput('')
      setActiveView('narratives')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
    }
  }

  if (!overview && loading) {
    return (
      <section className="market-panel">
        <div className="scheduled-empty">
          <h4>Loading Market</h4>
          <p>Loading configured market data, sectors, narratives, and alerts.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="market-panel">
      <div className="market-toolbar">
        <div className="market-view-tabs" role="tablist" aria-label="Market views">
          {MARKET_VIEWS.map((view) => (
            <button
              key={view.id}
              className="proposal-filter"
              type="button"
              data-active={activeView === view.id}
              onClick={() => setActiveView(view.id)}
            >
              {view.label}
            </button>
          ))}
        </div>
        <div className="market-toolbar-actions">
          {overview && (
            <span className="market-provider-pill">
              {overview.status.providerLabel} · {overview.status.dataMode}
            </span>
          )}
          <button className="ghost-button" type="button" onClick={() => void onRefresh()} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {(error || formError) && (
        <div className="scheduled-inline-error">
          {formError || error}
        </div>
      )}

      {overview ? (
        <>
          <MarketStatusStrip overview={overview} />

          {activeView === 'overview' ? (
            <OverviewView
              overview={overview}
              narratives={narratives}
              onSelectSymbol={(symbol) => {
                handleSelectSymbol(symbol)
                setActiveView('technicals')
              }}
            />
          ) : activeView === 'watchlist' ? (
            <WatchlistView
              quotes={overview.quotes}
              symbolInput={symbolInput}
              mutating={mutating}
              onSymbolInputChange={setSymbolInput}
              onAddSymbols={(event) => void handleAddSymbols(event)}
              onRemoveSymbol={(symbol) => void onRemoveSymbol(symbol)}
              onSelectSymbol={(symbol) => {
                handleSelectSymbol(symbol)
                setActiveView('technicals')
              }}
            />
          ) : activeView === 'hotstocks' ? (
            <HotStocksView
              overview={hotStocksOverview || overview}
              narratives={narratives}
              technicals={mergedTechnicals}
              loading={hotStocksLoading}
              error={hotStocksError}
              onSelectSymbol={(symbol) => {
                handleSelectSymbol(symbol)
                setActiveView('technicals')
              }}
            />
          ) : activeView === 'dragontiger' ? (
            <DragonTigerView
              stocks={visibleDragonTigerStocks}
              stocksLoading={dragonTigerStocksLoading}
              stocksError={dragonTigerStocksError}
              dailyStocks={dragonTigerDailyStocks}
              dailyStocksLoading={dragonTigerDailyStocksLoading}
              dailyStocksError={dragonTigerDailyStocksError}
              quotesBySymbol={quotesBySymbol}
              seatsByKey={dragonTigerSeats}
              seatLoadingKey={dragonTigerSeatLoadingKey}
              seatError={dragonTigerSeatError}
              brokerTradesByKey={dragonTigerBrokerTrades}
              brokerTradeLoadingKey={dragonTigerBrokerTradeLoadingKey}
              brokerTradeError={dragonTigerBrokerTradeError}
              institutions={dragonTigerInstitutions}
              institutionsLoading={dragonTigerInstitutionsLoading}
              institutionsError={dragonTigerInstitutionsError}
              onLoadSeats={handleLoadDragonTigerSeats}
              onLoadBrokerTrades={handleLoadDragonTigerBrokerTrades}
              onSelectSymbol={(symbol) => {
                handleSelectSymbol(symbol)
                setActiveView('technicals')
              }}
            />
          ) : activeView === 'sectors' ? (
            <SectorsView
              sectors={effectiveSectors}
              quotesBySymbol={quotesBySymbol}
              loading={sectorsLoading}
              error={sectorsError}
            />
          ) : activeView === 'narratives' ? (
            <NarrativesView
              narratives={narratives}
              posts={overview.influencerPosts}
              narrativeInput={narrativeInput}
              mutating={mutating}
              onNarrativeInputChange={setNarrativeInput}
              onAnalyzeNarrative={(event) => void handleAnalyzeNarrative(event)}
            />
          ) : activeView === 'technicals' ? (
            <TechnicalsView
              quotes={marketQuotes}
              technicals={mergedTechnicals}
              selectedTechnical={selectedTechnical}
              selectedSymbol={selectedTechnicalSymbol}
              timeframe={technicalTimeframe}
              loadingKey={technicalLoadingKey}
              error={technicalError}
              narratives={narratives}
              influencerPosts={overview.influencerPosts}
              alerts={effectiveAlerts}
              onSelectSymbol={handleSelectSymbol}
              onSelectTimeframe={setTechnicalTimeframe}
            />
          ) : activeView === 'reports' ? (
            <ReportsView
              reports={reports}
              mutating={mutating}
              onRunReport={(kind) => void onRunReport(kind)}
            />
          ) : (
            <AlertsView alerts={effectiveAlerts} loading={alertsLoading} error={alertsError} />
          )}
        </>
      ) : (
        <div className="scheduled-empty">
          <h4>No Market Data</h4>
          <p>Market data will appear after the first successful refresh.</p>
        </div>
      )}
    </section>
  )
}

const MARKET_VIEWS: Array<{ id: MarketView; label: string }> = [
  { id: 'overview', label: '总览' },
  { id: 'watchlist', label: '自选股' },
  { id: 'hotstocks', label: '热门股票' },
  { id: 'dragontiger', label: '龙虎榜' },
  { id: 'sectors', label: '热门板块' },
  { id: 'narratives', label: '小作文' },
  { id: 'technicals', label: '技术面' },
  { id: 'reports', label: '报告' },
  { id: 'alerts', label: '预警' },
]

const TECHNICAL_TIMEFRAMES: Array<{ id: TechnicalTimeframe; label: string }> = [
  { id: '1m', label: '分时' },
  { id: '5m', label: '5分' },
  { id: '15m', label: '15分' },
  { id: '30m', label: '30分' },
  { id: '60m', label: '60分' },
  { id: '1d', label: '日K' },
  { id: '1mo', label: '月K' },
  { id: '1y', label: '年K' },
]

const MarketStatusStrip: React.FC<{ overview: MarketOverview }> = ({ overview }) => (
  <div className="market-status-strip">
    <MarketMetric label="Trading Day" value={overview.status.tradingDay} />
    <MarketMetric label="Phase" value={formatPhase(overview.status.phase)} />
    <MarketMetric label="Watchlist" value={`${overview.watchlist.symbols.length} symbols`} />
    <MarketMetric label="Alerts" value={`${overview.alerts.length} active`} tone={overview.alerts.some((alert) => alert.level === 'urgent') ? 'warn' : 'good'} />
    <MarketMetric label="Mode" value="Research only" />
  </div>
)

const OverviewView: React.FC<{
  overview: MarketOverview
  narratives: MarketNarrative[]
  onSelectSymbol: (symbol: string) => void
}> = ({ overview, narratives, onSelectSymbol }) => (
  <div className="market-overview-grid">
    <section className="market-card market-card-span-2">
      <div className="market-card-header">
        <div>
          <h3>Index Tape</h3>
          <p>A-share index snapshots from the configured market provider.</p>
        </div>
        <span>{formatTime(overview.status.now)}</span>
      </div>
      <div className="market-index-grid">
        {overview.indices.map((quote) => (
          <QuoteTile key={quote.symbol} quote={quote} compact />
        ))}
      </div>
    </section>

    <section className="market-card">
      <div className="market-card-header">
        <div>
          <h3>热门板块</h3>
          <p>按板块涨跌、成交和持续性排序。</p>
        </div>
      </div>
      <div className="market-sector-mini-list">
        {overview.sectors.length === 0 ? (
          <p className="market-muted">当前 provider 没有返回板块热度。</p>
        ) : overview.sectors.slice(0, 5).map((sector) => (
          <SectorRow key={sector.sectorId} sector={sector} />
        ))}
      </div>
    </section>

    <section className="market-card">
      <div className="market-card-header">
        <div>
          <h3>Watchlist Movers</h3>
          <p>Click a symbol to inspect technicals.</p>
        </div>
      </div>
      <div className="market-watchlist-table">
        {overview.quotes.slice(0, 8).map((quote) => (
          <QuoteRow key={quote.symbol} quote={quote} onClick={() => onSelectSymbol(quote.symbol)} />
        ))}
      </div>
    </section>

    <section className="market-card">
      <div className="market-card-header">
        <div>
          <h3>Narrative Radar</h3>
          <p>Rumors, notes, and news are kept separate from confirmed facts.</p>
        </div>
      </div>
      <NarrativeList narratives={narratives.slice(0, 3)} />
    </section>

    <section className="market-card">
      <div className="market-card-header">
        <div>
          <h3>Smart Alerts</h3>
          <p>Rules are advisory and require manual review.</p>
        </div>
      </div>
      <AlertList alerts={overview.alerts.slice(0, 4)} />
    </section>
  </div>
)

const WatchlistView: React.FC<{
  quotes: QuoteSnapshot[]
  symbolInput: string
  mutating: boolean
  onSymbolInputChange: (value: string) => void
  onAddSymbols: (event: React.FormEvent) => void
  onRemoveSymbol: (symbol: string) => void
  onSelectSymbol: (symbol: string) => void
}> = ({
  quotes,
  symbolInput,
  mutating,
  onSymbolInputChange,
  onAddSymbols,
  onRemoveSymbol,
  onSelectSymbol,
}) => (
  <div className="market-two-column">
    <section className="market-card">
      <div className="market-card-header">
        <div>
          <h3>Watchlist</h3>
          <p>Add symbols like 600519, 300750.SZ, or 688981.SH.</p>
        </div>
      </div>
      <form className="market-symbol-form" onSubmit={onAddSymbols}>
        <input
          className="scheduled-input"
          type="text"
          value={symbolInput}
          onChange={(event) => onSymbolInputChange(event.target.value)}
          placeholder="600519, 300750.SZ"
        />
        <button className="ghost-button" type="submit" disabled={mutating}>
          Add
        </button>
      </form>
      <div className="market-watchlist-table market-watchlist-table-large">
        {quotes.map((quote) => (
          <div className="market-watch-row-wrap" key={quote.symbol}>
            <QuoteRow quote={quote} onClick={() => onSelectSymbol(quote.symbol)} />
            <button className="icon-button" type="button" onClick={() => onRemoveSymbol(quote.symbol)} disabled={mutating}>
              Remove
            </button>
          </div>
        ))}
      </div>
    </section>
    <section className="market-card">
      <div className="market-card-header">
        <div>
          <h3>Positioning Notes</h3>
          <p>This tab does not trade. It tracks signals and evidence for manual review.</p>
        </div>
      </div>
      <div className="market-note-list">
        <p>Use alerts for observation only: price move, volume expansion, sector resonance, and narrative mentions.</p>
        <p>Before acting on any signal, verify official announcements, liquidity, position sizing, and invalidation conditions.</p>
      </div>
    </section>
  </div>
)

const HotStocksView: React.FC<{
  overview: MarketOverview
  narratives: MarketNarrative[]
  technicals: TechnicalSignal[]
  loading: boolean
  error: string | null
  onSelectSymbol: (symbol: string) => void
}> = ({ overview, narratives, technicals, loading, error, onSelectSymbol }) => {
  const candidates = useMemo(() => buildHotStockCandidates({
    overview,
    narratives,
    technicals,
  }), [narratives, overview, technicals])
  const leaders = candidates.slice(0, 3)
  const hasLiveQuotes = candidates.some((candidate) => Boolean(candidate.quote))
  const hotStockStatus = overview.hotStockStatus
  const usingExternalHotStocks = (overview.hotStocks || []).length > 0

  return (
    <div className="market-hotstocks-layout">
      <section className="market-card market-card-span-2">
        <div className="market-card-header">
          <div>
            <h3>热门股票收集</h3>
            <p>{usingExternalHotStocks ? '优先展示淘股吧授权页面抓取的热门股票；行情和技术面由当前 provider 补齐。' : '淘股吧热榜暂无可用结果，暂时用行情、板块、小作文、大V、预警和技术面做本地兜底聚合。'}</p>
          </div>
          <span>{formatTime(overview.status.now)}</span>
        </div>
        <HotStockSourceStatusBox status={hotStockStatus} hotStockCount={overview.hotStocks.length} quoteCount={overview.hotStockQuotes.length} />
        {loading ? (
          <div className="scheduled-empty">
            <h4>热门股票加载中</h4>
            <p>正在拉取淘股吧热榜和补充行情。</p>
          </div>
        ) : error ? (
          <div className="scheduled-inline-error">{error}</div>
        ) : candidates.length === 0 ? (
          <div className="scheduled-empty">
            <h4>暂无热门股票</h4>
            <p>{hotStockStatus.error || '当前没有从淘股吧热榜识别到股票，也没有足够的本地兜底信号。'}</p>
          </div>
        ) : (
          <div className="market-hot-stock-list">
            {candidates.slice(0, 12).map((candidate, index) => (
              <article className="market-hot-stock-card" key={candidate.symbol}>
                <div className="market-hot-stock-main">
                  <div className="market-hot-stock-rank">#{index + 1}</div>
                  <div className="market-hot-stock-copy">
                    <div className="market-hot-stock-title">
                      <h4>{candidate.name || candidate.symbol}</h4>
                      <span>{candidate.symbol}</span>
                    </div>
                    <div className="market-chip-row">
                      {candidate.sectors.slice(0, 3).map((sector) => <span key={sector}>{sector}</span>)}
                      {candidate.technical ? <span>{formatTrendLabel(candidate.technical.trend)}</span> : null}
                      {candidate.sourceName ? <span>{candidate.sourceName}</span> : null}
                      {candidate.latestMentionAt ? <span>最新提及 {formatTime(candidate.latestMentionAt)}</span> : null}
                    </div>
                  </div>
                </div>
                <div className="market-hot-stock-score">
                  <span>热度</span>
                  <strong>{candidate.score}</strong>
                </div>
                <div className="market-hot-stock-quote">
                  {candidate.quote ? (
                    <>
                      <strong>{formatPrice(candidate.quote.price)}</strong>
                      <Change value={candidate.quote.changePct} />
                      <span>量比 {formatNullableNumber(candidate.quote.volumeRatio)}x · 换手 {formatNullableNumber(candidate.quote.turnoverRate)}%</span>
                    </>
                  ) : (
                    <>
                      <strong>待补行情</strong>
                      <span>热榜有标的，但行情 provider 没有补齐这只股票的行情。</span>
                    </>
                  )}
                </div>
                <div className="market-hot-stock-evidence">
                  <div className="market-hot-stock-reasons">
                    <strong>入选理由</strong>
                    <ul>
                      {candidate.reasons.slice(0, 4).map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="market-hot-stock-reasons" data-risk="true">
                    <strong>风险提示</strong>
                    <ul>
                      {candidate.risks.slice(0, 3).map((risk) => (
                        <li key={risk}>{risk}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="market-hot-stock-footer">
                  <div className="market-hot-stock-counts">
                    {candidate.sourceMode === 'external' ? (
                      <>
                        <span>来源 {candidate.sourceName || '淘股吧热榜'}</span>
                        <span>排名 #{candidate.hotStockRank || '-'}</span>
                        <span>提及 {candidate.mentionCount}</span>
                        {candidate.fetchedAt ? <span>抓取 {formatTime(candidate.fetchedAt)}</span> : null}
                      </>
                    ) : (
                      <>
                        <span>题材 {candidate.narrativeCount}</span>
                        <span>大V {candidate.influencerCount}</span>
                        <span>预警 {candidate.alertCount}</span>
                      </>
                    )}
                  </div>
                  <button className="ghost-button" type="button" onClick={() => onSelectSymbol(candidate.symbol)}>
                    看技术面
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="market-card">
        <div className="market-card-header">
          <div>
            <h3>热度摘要</h3>
            <p>用于快速判断哪些股票值得继续人工复核。</p>
          </div>
        </div>
        <div className="market-score-grid">
          <MarketMetric label="候选股票" value={`${candidates.length} 只`} />
          <MarketMetric label="有实时行情" value={`${candidates.filter((candidate) => candidate.quote).length} 只`} />
          <MarketMetric label={usingExternalHotStocks ? '热榜提及' : '消息提及'} value={`${candidates.reduce((sum, candidate) => sum + candidate.mentionCount + candidate.narrativeCount + candidate.influencerCount, 0)} 条`} />
          <MarketMetric label="外部来源" value={usingExternalHotStocks ? '淘股吧' : '本地兜底'} tone={hotStockStatus.error ? 'warn' : 'good'} />
        </div>
        <div className="market-hot-stock-leaders">
          {leaders.length === 0 ? (
            <p className="market-muted">还没有足够数据生成热度榜。</p>
          ) : leaders.map((candidate) => (
            <button
              className="market-hot-stock-leader"
              key={candidate.symbol}
              type="button"
              onClick={() => onSelectSymbol(candidate.symbol)}
            >
              <div>
                <strong>{candidate.name || candidate.symbol}</strong>
                <span>{candidate.reasons[0] || '多源信号聚合'}</span>
              </div>
              <ScoreBadge value={candidate.score} />
            </button>
          ))}
        </div>
        <div className="market-note-list">
          <p>{hasLiveQuotes ? '价格、涨跌幅、量比和换手来自行情 provider；淘股吧只提供热度线索。' : '当前热榜标的尚未补齐行情，先检查 AKShare bridge 或 provider 返回。'}</p>
          <p>外部热度源只用于发现线索，不代表买卖建议；下单前仍需核对公告、流动性、仓位和失效条件。</p>
        </div>
      </section>
    </div>
  )
}

const HotStockSourceStatusBox: React.FC<{
  status: MarketOverview['hotStockStatus']
  hotStockCount: number
  quoteCount: number
}> = ({ status, hotStockCount, quoteCount }) => {
  const modeLabel = status.mode === 'agent_browser' ? 'agent-browser' : '未启用'
  return (
    <div className="market-hot-stock-source" data-error={Boolean(status.error)}>
      <div>
        <strong>{status.providerLabel || '外部热门股票源'}</strong>
        <span>
          {status.enabled ? '已启用' : '未启用'} · {modeLabel} · 热榜 {hotStockCount} 只 · 补行情 {quoteCount} 只
        </span>
      </div>
      <div className="market-hot-stock-source-meta">
        {status.fetchedAt ? <span>抓取 {formatTime(status.fetchedAt)}</span> : null}
        {status.message ? <span>{status.message}</span> : null}
        {status.sourceUrls.map((url) => (
          <a key={url} href={url} target="_blank" rel="noreferrer">来源页</a>
        ))}
      </div>
      {status.error ? <p>{status.error}</p> : null}
    </div>
  )
}

const DragonTigerView: React.FC<{
  stocks: DragonTigerStock[]
  stocksLoading: boolean
  stocksError: string | null
  dailyStocks: DragonTigerDailyStock[]
  dailyStocksLoading: boolean
  dailyStocksError: string | null
  quotesBySymbol: Map<string, QuoteSnapshot>
  seatsByKey: Record<string, DragonTigerSeat[]>
  seatLoadingKey: string | null
  seatError: string | null
  brokerTradesByKey: Record<string, DragonTigerBrokerTrade[]>
  brokerTradeLoadingKey: string | null
  brokerTradeError: string | null
  institutions: DragonTigerInstitutionSeat[]
  institutionsLoading: boolean
  institutionsError: string | null
  onLoadSeats: (stock: DragonTigerStock) => void
  onLoadBrokerTrades: (seat: DragonTigerSeat) => void
  onSelectSymbol: (symbol: string) => void
}> = ({
  stocks,
  stocksLoading,
  stocksError,
  dailyStocks,
  dailyStocksLoading,
  dailyStocksError,
  quotesBySymbol,
  seatsByKey,
  seatLoadingKey,
  seatError,
  brokerTradesByKey,
  brokerTradeLoadingKey,
  brokerTradeError,
  institutions,
  institutionsLoading,
  institutionsError,
  onLoadSeats,
  onLoadBrokerTrades,
  onSelectSymbol,
}) => {
  const dailyGroups = groupDragonTigerDailyStocks(dailyStocks)
  const isDailyLoading = dailyStocksLoading || (dailyStocks.length === 0 && stocksLoading)
  return (
    <div className="market-two-column market-dragon-layout">
      <section className="market-card">
        <div className="market-card-header">
          <div>
            <h3>每日龙虎榜明细</h3>
            <p>按交易日展示原始上榜行，保留上榜原因、买卖额、净额、换手率和上榜后表现。</p>
          </div>
        </div>
        <div className="market-dragon-daily-list">
          {isDailyLoading ? (
            <div className="scheduled-empty">
              <h4>龙虎榜加载中</h4>
              <p>正在拉取近14天每日龙虎榜明细。</p>
            </div>
          ) : dailyStocksError ? (
            <div className="scheduled-inline-error">{dailyStocksError}</div>
          ) : dailyGroups.length === 0 ? (
            <div className="scheduled-empty">
              <h4>暂无龙虎榜数据</h4>
              <p>当前 provider 没有返回每日龙虎榜明细。</p>
            </div>
          ) : dailyGroups.map((group) => (
            <section className="market-dragon-day-group" key={group.tradeDate}>
              <div className="market-dragon-day-header">
                <div>
                  <h4>{formatDateLabel(group.tradeDate)}</h4>
                  <span>{group.items.length} 条原始明细 · 净买合计 {formatCompactAmount(group.netBuyAmount)}</span>
                </div>
                <strong>成交 {formatCompactUnsignedAmount(group.totalAmount)}</strong>
              </div>
              <div className="market-dragon-daily-table-wrap">
                <table className="market-dragon-daily-table">
                  <thead>
                    <tr>
                      <th>序号</th>
                      <th>代码</th>
                      <th>名称</th>
                      <th>收盘</th>
                      <th>涨跌幅</th>
                      <th>净买额</th>
                      <th>买入额</th>
                      <th>卖出额</th>
                      <th>龙虎榜成交</th>
                      <th>市场成交</th>
                      <th>净买占比</th>
                      <th>成交占比</th>
                      <th>换手率</th>
                      <th>流通市值</th>
                      <th>解读</th>
                      <th>上榜原因</th>
                      <th>后续表现</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((stock) => {
                      const quote = quotesBySymbol.get(stock.symbol) || null
                      const seatKey = `${stock.symbol}:${stock.tradeDate}`
                      const seats = seatsByKey[seatKey] || []
                      const buySeats = seats.filter((seat) => seat.side === 'buy')
                      const sellSeats = seats.filter((seat) => seat.side === 'sell')
                      return (
                        <React.Fragment key={stock.id}>
                          <tr data-tone={stock.netBuyAmount >= 0 ? 'normal' : 'watch'}>
                            <td className="market-dragon-index">{stock.rawIndex ? `#${stock.rawIndex}` : '--'}</td>
                            <td className="market-dragon-symbol">{stock.symbol}</td>
                            <td>
                              <button className="link-button market-dragon-name-button" type="button" onClick={() => onSelectSymbol(stock.symbol)}>
                                {stock.name || stock.symbol}
                              </button>
                            </td>
                            <td className="market-dragon-number">{formatOptionalPrice(stock.closePrice)}</td>
                            <td><Change value={quote?.changePct ?? stock.changePct} /></td>
                            <td className="market-dragon-number" data-positive={stock.netBuyAmount >= 0}>{formatCompactAmount(stock.netBuyAmount)}</td>
                            <td className="market-dragon-number">{formatCompactUnsignedAmount(stock.buyAmount)}</td>
                            <td className="market-dragon-number">{formatCompactUnsignedAmount(stock.sellAmount)}</td>
                            <td className="market-dragon-number">{formatCompactUnsignedAmount(stock.totalAmount)}</td>
                            <td className="market-dragon-number">{formatCompactUnsignedAmount(stock.marketAmount)}</td>
                            <td className="market-dragon-number">{formatOptionalPct(stock.netBuyRatio)}</td>
                            <td className="market-dragon-number">{formatOptionalPct(stock.turnoverAmountRatio)}</td>
                            <td className="market-dragon-number">{formatOptionalPct(stock.turnoverRate)}</td>
                            <td className="market-dragon-number">{formatCompactUnsignedAmount(stock.floatMarketCap)}</td>
                            <td className="market-dragon-text">{stock.interpretation || '--'}</td>
                            <td className="market-dragon-reason">{stock.listingReason || '--'}</td>
                            <td className="market-dragon-returns">
                              <span>1日 {formatOptionalSignedPct(stock.after1DayReturn)}</span>
                              <span>2日 {formatOptionalSignedPct(stock.after2DayReturn)}</span>
                              <span>5日 {formatOptionalSignedPct(stock.after5DayReturn)}</span>
                              <span>10日 {formatOptionalSignedPct(stock.after10DayReturn)}</span>
                            </td>
                            <td>
                              <div className="market-dragon-table-actions">
                                <button className="link-button" type="button" onClick={() => onLoadSeats(dailyStockToDragonTigerStock(stock))} disabled={seatLoadingKey === seatKey}>
                                  {seatLoadingKey === seatKey ? '加载中' : seats.length > 0 ? '刷新席位' : '席位明细'}
                                </button>
                                <button className="link-button" type="button" onClick={() => onSelectSymbol(stock.symbol)}>
                                  技术面
                                </button>
                              </div>
                            </td>
                          </tr>
                          {seatError && seatLoadingKey === null && seats.length === 0 ? (
                            <tr className="market-dragon-seat-detail-row">
                              <td colSpan={18}>
                                <div className="scheduled-inline-error">{seatError}</div>
                              </td>
                            </tr>
                          ) : null}
                          {seats.length > 0 ? (
                            <tr className="market-dragon-seat-detail-row">
                              <td colSpan={18}>
                                <DragonTigerSeatList
                                  buySeats={buySeats}
                                  sellSeats={sellSeats}
                                  brokerTradesByKey={brokerTradesByKey}
                                  brokerTradeLoadingKey={brokerTradeLoadingKey}
                                  brokerTradeError={brokerTradeError}
                                  onLoadBrokerTrades={onLoadBrokerTrades}
                                />
                              </td>
                            </tr>
                          ) : null}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="market-card">
      <div className="market-card-header">
        <div>
          <h3>聚合统计 / 机构席位</h3>
          <p>右侧保留近14天聚合排行和机构参与统计，方便从原始明细回看资金持续性。</p>
        </div>
      </div>
      <div className="market-score-grid">
        <MarketMetric label="每日明细" value={`${dailyStocks.length} 条`} />
        <MarketMetric label="上榜股票" value={`${stocks.length} 只`} />
        <MarketMetric label="机构榜股票" value={`${institutions.length} 只`} />
        <MarketMetric label="机构净买为正" value={`${institutions.filter((item) => item.institutionNetBuyAmount > 0).length} 只`} />
      </div>
      {stocksError ? <div className="scheduled-inline-error">{stocksError}</div> : null}
      <div className="market-hot-stock-list market-dragon-aggregate-list">
        {stocksLoading && stocks.length === 0 ? (
          <p className="market-muted">聚合统计加载中。</p>
        ) : stocks.length === 0 ? (
          <p className="market-muted">暂无聚合统计。</p>
        ) : stocks.slice(0, 8).map((stock, index) => {
          const quote = quotesBySymbol.get(stock.symbol) || null
          const seatKey = `${stock.symbol}:${stock.latestListedAt}`
          const seats = seatsByKey[seatKey] || []
          const buySeats = seats.filter((seat) => seat.side === 'buy')
          const sellSeats = seats.filter((seat) => seat.side === 'sell')
          return (
            <article className="market-hot-stock-card" key={stock.id}>
              <div className="market-hot-stock-main">
                <div className="market-hot-stock-rank">#{index + 1}</div>
                <div className="market-hot-stock-copy">
                  <div className="market-hot-stock-title">
                    <h4>{stock.name || stock.symbol}</h4>
                    <span>{stock.symbol}</span>
                  </div>
                  <div className="market-chip-row">
                    <span>最近上榜 {formatTime(stock.latestListedAt)}</span>
                    <span>上榜 {stock.listingCount} 次</span>
                    {stock.listingReason ? <span>{stock.listingReason}</span> : null}
                  </div>
                </div>
              </div>
              <div className="market-hot-stock-score">
                <span>净买额</span>
                <strong>{formatCompactAmount(stock.netBuyAmount)}</strong>
              </div>
              <div className="market-hot-stock-quote">
                <strong>{formatPrice(stock.closePrice)}</strong>
                <Change value={quote?.changePct ?? stock.changePct} />
                <span>机构净买 {formatCompactAmount(stock.institutionNetBuyAmount)} · 成交 {formatCompactAmount(stock.totalAmount)}</span>
              </div>
              <div className="market-hot-stock-evidence">
                <div className="market-hot-stock-reasons">
                  <strong>榜单信息</strong>
                  <ul>
                    <li>龙虎榜买入额 {formatCompactAmount(stock.buyAmount)}</li>
                    <li>龙虎榜卖出额 {formatCompactAmount(stock.sellAmount)}</li>
                    <li>买方机构次数 {stock.institutionBuyCount}，卖方机构次数 {stock.institutionSellCount}</li>
                    {stock.interpretation ? <li>{stock.interpretation}</li> : null}
                  </ul>
                </div>
                <div className="market-hot-stock-reasons" data-risk="true">
                  <strong>上榜后表现</strong>
                  <ul>
                    <li>1日 {formatOptionalSignedPct(stock.after1DayReturn)}</li>
                    <li>2日 {formatOptionalSignedPct(stock.after2DayReturn)}</li>
                    <li>5日 {formatOptionalSignedPct(stock.after5DayReturn)}</li>
                    <li>10日 {formatOptionalSignedPct(stock.after10DayReturn)}</li>
                  </ul>
                </div>
              </div>
              <div className="market-hot-stock-footer">
                <div className="market-hot-stock-counts">
                  <span>来源 东方财富龙虎榜</span>
                  <span>总成交 {formatCompactAmount(stock.totalAmount)}</span>
                </div>
                <div className="market-inline-actions">
                  <button className="icon-button" type="button" onClick={() => onLoadSeats(stock)} disabled={seatLoadingKey === seatKey}>
                    {seatLoadingKey === seatKey ? '加载席位' : seats.length > 0 ? '刷新席位' : '席位明细'}
                  </button>
                  <button className="ghost-button" type="button" onClick={() => onSelectSymbol(stock.symbol)}>
                    看技术面
                  </button>
                </div>
              </div>
              {seatError && seatLoadingKey === null && seats.length === 0 ? (
                <div className="scheduled-inline-error market-hot-stock-wide">{seatError}</div>
              ) : null}
              {seats.length > 0 ? (
                <DragonTigerSeatList
                  buySeats={buySeats}
                  sellSeats={sellSeats}
                  brokerTradesByKey={brokerTradesByKey}
                  brokerTradeLoadingKey={brokerTradeLoadingKey}
                  brokerTradeError={brokerTradeError}
                  onLoadBrokerTrades={onLoadBrokerTrades}
                />
              ) : null}
            </article>
          )
        })}
      </div>

      <DragonTigerInstitutionList
        institutions={institutions}
        loading={institutionsLoading}
        error={institutionsError}
        onSelectSymbol={onSelectSymbol}
      />
      <div className="market-note-list">
        <p>龙虎榜更适合做资金行为观察：看上榜原因、净买额、机构参与度和后续承接。</p>
        <p>结合技术面、板块强度和公告验证一起看，避免把一次性席位博弈当成趋势确认。</p>
      </div>
      </section>
    </div>
  )
}

const DragonTigerSeatList: React.FC<{
  buySeats: DragonTigerSeat[]
  sellSeats: DragonTigerSeat[]
  brokerTradesByKey: Record<string, DragonTigerBrokerTrade[]>
  brokerTradeLoadingKey: string | null
  brokerTradeError: string | null
  onLoadBrokerTrades: (seat: DragonTigerSeat) => void
}> = ({ buySeats, sellSeats, brokerTradesByKey, brokerTradeLoadingKey, brokerTradeError, onLoadBrokerTrades }) => (
  <div className="market-dragon-seat-grid">
    <DragonTigerSeatColumn
      title="买方席位"
      seats={buySeats}
      brokerTradesByKey={brokerTradesByKey}
      brokerTradeLoadingKey={brokerTradeLoadingKey}
      brokerTradeError={brokerTradeError}
      onLoadBrokerTrades={onLoadBrokerTrades}
    />
    <DragonTigerSeatColumn
      title="卖方席位"
      seats={sellSeats}
      brokerTradesByKey={brokerTradesByKey}
      brokerTradeLoadingKey={brokerTradeLoadingKey}
      brokerTradeError={brokerTradeError}
      onLoadBrokerTrades={onLoadBrokerTrades}
    />
  </div>
)

const DragonTigerSeatColumn: React.FC<{
  title: string
  seats: DragonTigerSeat[]
  brokerTradesByKey: Record<string, DragonTigerBrokerTrade[]>
  brokerTradeLoadingKey: string | null
  brokerTradeError: string | null
  onLoadBrokerTrades: (seat: DragonTigerSeat) => void
}> = ({ title, seats, brokerTradesByKey, brokerTradeLoadingKey, brokerTradeError, onLoadBrokerTrades }) => (
  <div className="market-hot-stock-reasons">
    <strong>{title}</strong>
    {seats.length === 0 ? (
      <p className="market-muted">暂无席位明细。</p>
    ) : (
      <div className="market-dragon-seat-list">
        {seats.map((seat) => {
          const brokerKey = `${seat.brokerName}:${seat.tradeDate}`
          const trades = brokerTradesByKey[brokerKey] || []
          const isLoading = brokerTradeLoadingKey === brokerKey
          const canLoad = seat.seatType === 'broker' || seat.seatType === 'northbound'
          return (
            <div className="market-dragon-seat-card" key={seat.id}>
              <div className="market-dragon-seat-row">
                <div>
                  <strong>{seat.rank}. {seat.brokerName}</strong>
                  <span>{formatSeatType(seat.seatType)} · 净额 {formatCompactAmount(seat.netAmount)}</span>
                </div>
                <div>
                  <span>买 {formatCompactAmount(seat.buyAmount)}</span>
                  <span>卖 {formatCompactAmount(seat.sellAmount)}</span>
                </div>
              </div>
              <div className="market-dragon-seat-actions">
                <span>上榜日 {formatShortDate(seat.tradeDate)}</span>
                {canLoad ? (
                  <button className="link-button" type="button" onClick={() => onLoadBrokerTrades(seat)} disabled={isLoading}>
                    {isLoading ? '加载战绩中' : trades.length > 0 ? '刷新营业部战绩' : '营业部战绩'}
                  </button>
                ) : (
                  <span>该席位暂无营业部战绩</span>
                )}
              </div>
              {brokerTradeError && !isLoading && trades.length === 0 && canLoad ? (
                <div className="scheduled-inline-error market-dragon-seat-error">{brokerTradeError}</div>
              ) : null}
              {trades.length > 0 ? <DragonTigerBrokerTradeList trades={trades} /> : null}
            </div>
          )
        })}
      </div>
    )}
  </div>
)

const DragonTigerBrokerTradeList: React.FC<{
  trades: DragonTigerBrokerTrade[]
}> = ({ trades }) => (
  <div className="market-dragon-broker-list">
    {trades.slice(0, 8).map((trade) => (
      <div className="market-dragon-broker-row" key={trade.id}>
        <div className="market-dragon-broker-main">
          <strong>{trade.name || trade.symbol}</strong>
          <span>{trade.symbol} · {formatShortDate(trade.tradeDate)} · 当日 {formatSignedPct(trade.changePct)}</span>
        </div>
        <div className="market-dragon-broker-metrics">
          <span>净额 {formatCompactAmount(trade.netAmount)}</span>
          <span>1日 {formatOptionalSignedPct(trade.after1DayReturn)}</span>
          <span>5日 {formatOptionalSignedPct(trade.after5DayReturn)}</span>
          <span>10日 {formatOptionalSignedPct(trade.after10DayReturn)}</span>
        </div>
      </div>
    ))}
  </div>
)

const DragonTigerInstitutionList: React.FC<{
  institutions: DragonTigerInstitutionSeat[]
  loading: boolean
  error: string | null
  onSelectSymbol: (symbol: string) => void
}> = ({ institutions, loading, error, onSelectSymbol }) => (
  <div className="market-hot-stock-leaders">
    {loading ? (
      <p className="market-muted">机构席位加载中。</p>
    ) : error ? (
      <div className="scheduled-inline-error">{error}</div>
    ) : institutions.length === 0 ? (
      <p className="market-muted">暂无机构席位追踪数据。</p>
    ) : institutions.slice(0, 10).map((item) => (
      <button
        className="market-hot-stock-leader"
        key={item.id}
        type="button"
        onClick={() => onSelectSymbol(item.symbol)}
      >
        <div>
          <strong>{item.name || item.symbol}</strong>
          <span>机构净买 {formatCompactAmount(item.institutionNetBuyAmount)} · 上榜 {item.listingCount} 次</span>
        </div>
        <ScoreBadge value={Math.max(0, Math.min(100, Math.round(50 + item.oneMonthChangePct / 2)))} />
      </button>
    ))}
  </div>
)

const SectorsView: React.FC<{
  sectors: SectorHeat[]
  quotesBySymbol: Map<string, QuoteSnapshot>
  loading: boolean
  error: string | null
}> = ({ sectors, quotesBySymbol, loading, error }) => (
  <div className="market-sector-grid">
    {loading ? (
      <section className="market-card">
        <div className="scheduled-empty">
          <h4>热门板块加载中</h4>
          <p>正在拉取板块热度和龙头股。</p>
        </div>
      </section>
    ) : error ? (
      <section className="market-card">
        <div className="scheduled-inline-error">{error}</div>
      </section>
    ) : sectors.length === 0 ? (
      <section className="market-card">
        <div className="scheduled-empty">
          <h4>暂无板块数据</h4>
          <p>当前 provider 还没有返回真实板块热度。</p>
        </div>
      </section>
    ) : sectors.map((sector) => (
      <section className="market-card" key={sector.sectorId}>
        <div className="market-card-header">
          <div>
            <h3>{sector.sectorName}</h3>
            <p>{sector.risingCount} 家上涨 · {sector.fallingCount} 家下跌 · {sector.limitUpCount} 家涨停</p>
          </div>
          <Change value={sector.changePct} />
        </div>
        <div className="market-score-grid">
          <ScoreBar label="强度" value={sector.strengthScore} />
          <ScoreBar label="扩散" value={sector.diffusionScore} />
          <ScoreBar label="持续" value={sector.persistenceScore} />
          <ScoreBar label="风险" value={sector.riskScore} tone="risk" />
        </div>
        <div className="market-leader-list">
          {sector.leaderSymbols.map((symbol) => {
            const quote = quotesBySymbol.get(symbol)
            return (
              <div className="market-leader-chip" key={symbol}>
                <span>{symbol}</span>
                <strong>{quote ? formatSignedPct(quote.changePct) : '-'}</strong>
              </div>
            )
          })}
        </div>
      </section>
    ))}
  </div>
)

const NarrativesView: React.FC<{
  narratives: MarketNarrative[]
  posts: InfluencerPost[]
  narrativeInput: string
  mutating: boolean
  onNarrativeInputChange: (value: string) => void
  onAnalyzeNarrative: (event: React.FormEvent) => void
}> = ({
  narratives,
  posts,
  narrativeInput,
  mutating,
  onNarrativeInputChange,
  onAnalyzeNarrative,
}) => (
  <div className="market-two-column">
    <section className="market-card">
      <div className="market-card-header">
        <div>
          <h3>Small Essay Analyzer</h3>
          <p>Paste a note, rumor, or research excerpt to extract symbols and risk.</p>
        </div>
      </div>
      <form className="market-narrative-form" onSubmit={onAnalyzeNarrative}>
        <textarea
          className="scheduled-textarea"
          value={narrativeInput}
          onChange={(event) => onNarrativeInputChange(event.target.value)}
          placeholder="Paste a market note here. Example: 算力订单传闻提到中际旭创和兆易创新..."
        />
        <button className="ghost-button" type="submit" disabled={mutating || !narrativeInput.trim()}>
          Analyze
        </button>
      </form>
      <NarrativeList narratives={narratives} />
    </section>

    <section className="market-card">
      <div className="market-card-header">
        <div>
          <h3>Taoguba Influencer Watch</h3>
          <p>Authorized tracking feed. Treat posts as sentiment, not evidence.</p>
        </div>
      </div>
      <div className="market-post-list">
        {posts.length === 0 ? (
          <p className="market-muted">No authorized influencer feed is configured.</p>
        ) : posts.map((post) => (
          <article className="market-post-item" key={post.id}>
            <div className="market-post-topline">
              <strong>{post.authorName}</strong>
              <span>{formatTime(post.publishedAt || post.fetchedAt)}</span>
            </div>
            <h4>{post.title || 'Untitled post'}</h4>
            <p>{post.content}</p>
            <div className="market-chip-row">
              <span>{post.stance || 'unclear'}</span>
              <span>{formatInteger(post.engagement.views || 0)} views</span>
              <span>Influence {post.influenceScore}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  </div>
)

const TechnicalsView: React.FC<{
  quotes: QuoteSnapshot[]
  technicals: TechnicalSignal[]
  selectedTechnical: TechnicalSignal | null
  selectedSymbol: string
  timeframe: TechnicalTimeframe
  loadingKey: string | null
  error: { key: string; message: string } | null
  narratives: MarketNarrative[]
  influencerPosts: InfluencerPost[]
  alerts: MarketAlert[]
  onSelectSymbol: (symbol: string) => void
  onSelectTimeframe: (timeframe: TechnicalTimeframe) => void
}> = ({
  quotes,
  technicals,
  selectedTechnical,
  selectedSymbol,
  timeframe,
  loadingKey,
  error,
  narratives,
  influencerPosts,
  alerts,
  onSelectSymbol,
  onSelectTimeframe,
}) => {
  const selectedQuote = selectedTechnical ? quotes.find((quote) => quote.symbol === selectedTechnical.symbol) : null
  const pendingQuote = !selectedTechnical && selectedSymbol
    ? quotes.find((quote) => quote.symbol === selectedSymbol)
    : null
  const selectedKey = buildTechnicalKey(selectedSymbol, timeframe)
  const selectedError = error?.key === selectedKey ? error : null

  return (
    <div className="market-two-column">
      <section className="market-card">
        <div className="market-card-header">
          <div>
            <h3>股票列表</h3>
            <p>选择自选股或淘股吧热榜补行情标的，查看技术面信号和风险提示。</p>
          </div>
        </div>
        <div className="market-symbol-list">
          {quotes.map((quote) => (
            <button
              key={quote.symbol}
              className="market-symbol-button"
              type="button"
              data-active={selectedSymbol === quote.symbol}
              onClick={() => onSelectSymbol(quote.symbol)}
            >
              <div className="market-symbol-copy">
                <span>{quote.name || quote.symbol}</span>
                {quote.name ? <span className="market-symbol-subtitle">{quote.symbol}</span> : null}
              </div>
              <Change value={quote.changePct} />
            </button>
          ))}
        </div>
      </section>

      <section className="market-card market-technical-card">
        {selectedTechnical ? (
          <>
            <div className="market-card-header">
              <div>
                <h3>{formatQuoteLabel(selectedQuote, selectedTechnical.symbol)} 技术面</h3>
                <p>{selectedTechnical.summary}</p>
              </div>
              <div className="market-technical-actions">
                <div className="market-timeframe-tabs" role="tablist" aria-label="K line timeframe">
                  {TECHNICAL_TIMEFRAMES.map((item) => (
                    <button
                      key={item.id}
                      className="proposal-filter"
                      type="button"
                      data-active={timeframe === item.id}
                      onClick={() => onSelectTimeframe(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <span className="market-trend-chip" data-trend={selectedTechnical.trend}>
                  {selectedTechnical.trend}
                </span>
              </div>
            </div>
            <div className="market-technical-grid">
              <MarketMetric label="MA5" value={formatPrice(selectedTechnical.ma5)} />
              <MarketMetric label="MA10" value={formatPrice(selectedTechnical.ma10)} />
              <MarketMetric label="MA20" value={formatPrice(selectedTechnical.ma20)} />
              <MarketMetric label="RSI6" value={String(selectedTechnical.rsi6)} />
              <MarketMetric label="ATR14" value={formatPrice(selectedTechnical.atr14)} />
              <MarketMetric label="Volume" value={selectedTechnical.volumeSignal} />
              <MarketMetric label="Support" value={formatPrice(selectedTechnical.support)} />
              <MarketMetric label="Resistance" value={formatPrice(selectedTechnical.resistance)} />
            </div>
            <CandlestickChart
              bars={selectedTechnical.bars}
              symbol={selectedTechnical.symbol}
            />
            <div className="market-macd-box">
              <span>MACD · {formatTimeframeLabel(selectedTechnical.timeframe)}</span>
              <strong>DIF {selectedTechnical.macd.dif} · DEA {selectedTechnical.macd.dea} · HIST {selectedTechnical.macd.hist}</strong>
            </div>
            <div className="market-note-list">
              {selectedTechnical.riskNotes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          </>
        ) : loadingKey === selectedKey ? (
          <div className="scheduled-empty">
            <h4>{formatQuoteLabel(pendingQuote, selectedSymbol)} {formatTimeframeLabel(timeframe)} 加载中</h4>
            <p>正在拉取这只股票的 K 线和技术指标。</p>
          </div>
        ) : selectedError ? (
          <div className="scheduled-empty">
            <h4>技术面加载失败</h4>
            <p>{selectedError.message}</p>
          </div>
        ) : technicals.length === 0 ? (
          <div className="scheduled-empty">
            <h4>暂无技术面</h4>
            <p>先把股票加入自选列表，再生成技术面信号。</p>
          </div>
        ) : null}
      </section>
    </div>
  )
}

const AlertsView: React.FC<{
  alerts: MarketAlert[]
  loading: boolean
  error: string | null
}> = ({ alerts, loading, error }) => (
  <section className="market-card">
    <div className="market-card-header">
      <div>
        <h3>Alert Timeline</h3>
        <p>Every alert keeps the triggering rule and source references.</p>
      </div>
    </div>
    {loading ? (
      <div className="scheduled-empty">
        <h4>预警加载中</h4>
        <p>正在计算行情、板块和消息预警。</p>
      </div>
    ) : error ? (
      <div className="scheduled-inline-error">{error}</div>
    ) : (
      <AlertList alerts={alerts} />
    )}
  </section>
)

const ReportsView: React.FC<{
  reports: MarketReport[]
  mutating: boolean
  onRunReport: (kind: MarketReport['kind']) => void
}> = ({ reports, mutating, onRunReport }) => (
  <div className="market-two-column">
    <section className="market-card">
      <div className="market-card-header">
        <div>
          <h3>Run Report</h3>
          <p>Generate deterministic market notes from the current desk state.</p>
        </div>
      </div>
      <div className="market-report-actions">
        <button className="ghost-button" type="button" onClick={() => onRunReport('intraday')} disabled={mutating}>
          Intraday
        </button>
        <button className="ghost-button" type="button" onClick={() => onRunReport('close')} disabled={mutating}>
          Close
        </button>
        <button className="ghost-button" type="button" onClick={() => onRunReport('watchlist')} disabled={mutating}>
          Watchlist
        </button>
      </div>
      <div className="market-note-list">
        <p>Reports are generated from quotes, sector heat, narratives, alerts, and technical signals.</p>
        <p>They are deliberately phrased as observation notes and risk prompts, not trade instructions.</p>
      </div>
    </section>

    <section className="market-card">
      <div className="market-card-header">
        <div>
          <h3>Recent Reports</h3>
          <p>Keep these as a local audit trail for later scheduler and backtest work.</p>
        </div>
      </div>
      <div className="market-report-list">
        {reports.length === 0 ? (
          <p className="market-muted">No reports generated yet.</p>
        ) : reports.map((report) => (
          <article className="market-report-item" key={report.id}>
            <div className="market-report-topline">
              <span>{report.kind}</span>
              <span>{report.tradingDay}</span>
              <span>{formatTime(report.generatedAt)}</span>
            </div>
            <h4>{report.title}</h4>
            <p>{report.summary}</p>
            <ReportSection title="Sectors" items={report.sectorBrief} />
            <ReportSection title="Watchlist" items={report.watchlistBrief} />
            <ReportSection title="Narratives" items={report.narrativeBrief} />
            <ReportSection title="Technicals" items={report.technicalBrief} />
            <ReportSection title="Alerts" items={report.alertBrief} />
            <ReportSection title="Risks" items={report.riskNotes} />
            <ReportSection title="Follow-ups" items={report.followUps} />
          </article>
        ))}
      </div>
    </section>
  </div>
)

const ReportSection: React.FC<{ title: string; items: string[] }> = ({ title, items }) => (
  <div className="market-report-section">
    <h5>{title}</h5>
    {items.length === 0 ? (
      <p>No items.</p>
    ) : (
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    )}
  </div>
)

const QuoteTile: React.FC<{ quote: QuoteSnapshot; compact?: boolean }> = ({ quote, compact = false }) => (
  <div className="market-quote-tile" data-compact={compact}>
    <div>
      <strong>{quote.name || quote.symbol}</strong>
      <span>{quote.name ? `${quote.symbol} · ${formatTime(quote.ts)}` : formatTime(quote.ts)}</span>
    </div>
    <div>
      <span className="market-price">{formatPrice(quote.price)}</span>
      <Change value={quote.changePct} />
    </div>
  </div>
)

const QuoteRow: React.FC<{ quote: QuoteSnapshot; onClick?: () => void }> = ({ quote, onClick }) => (
  <button className="market-quote-row" type="button" onClick={onClick}>
    <div>
      <strong>{quote.name || quote.symbol}</strong>
      <span>{quote.name ? `${quote.symbol} · ` : ''}Vol {quote.volumeRatio}x · Turn {quote.turnoverRate}%</span>
    </div>
    <span>{formatPrice(quote.price)}</span>
    <Change value={quote.changePct} />
  </button>
)

const SectorRow: React.FC<{ sector: SectorHeat }> = ({ sector }) => (
  <div className="market-sector-row">
    <div>
      <strong>{sector.sectorName}</strong>
      <span>{sector.leaderSymbols.join(', ')}</span>
    </div>
    <ScoreBadge value={sector.strengthScore} />
  </div>
)

const NarrativeList: React.FC<{ narratives: MarketNarrative[] }> = ({ narratives }) => (
  <div className="market-narrative-list">
    {narratives.length === 0 ? (
      <p className="market-muted">No narratives yet.</p>
    ) : narratives.map((narrative) => (
      <article className="market-narrative-item" key={narrative.id}>
        <div className="market-narrative-topline">
          <span>{narrative.category}</span>
          <span>{narrative.source.sourceName}</span>
          <span>{formatTime(narrative.publishedAt || narrative.fetchedAt)}</span>
        </div>
        <h4>{narrative.title}</h4>
        <p>{narrative.aiSummary}</p>
        <div className="market-score-inline">
          <ScoreBadge label="Confidence" value={narrative.confidenceScore} />
          <ScoreBadge label="Catalyst" value={narrative.catalystScore} />
          <ScoreBadge label="Risk" value={narrative.riskScore} tone="risk" />
        </div>
        <div className="market-chip-row">
          {narrative.symbols.map((symbol) => <span key={symbol}>{symbol}</span>)}
        </div>
      </article>
    ))}
  </div>
)

const AlertList: React.FC<{ alerts: MarketAlert[] }> = ({ alerts }) => (
  <div className="market-alert-list">
    {alerts.length === 0 ? (
      <p className="market-muted">No active alerts.</p>
    ) : alerts.map((alert) => (
      <article className="market-alert-item" key={alert.id} data-level={alert.level}>
        <div className="market-alert-level">{alert.level}</div>
        <div>
          <div className="market-alert-title-row">
            <h4>{alert.title}</h4>
            <span>{formatTime(alert.triggeredAt)}</span>
          </div>
          <p>{alert.message}</p>
          {alert.aiRationale && <p className="market-alert-rationale">{alert.aiRationale}</p>}
          <div className="market-chip-row">
            {alert.symbols.map((symbol) => <span key={symbol}>{symbol}</span>)}
            {alert.ruleId && <span>{alert.ruleId}</span>}
          </div>
        </div>
      </article>
    ))}
  </div>
)

const MarketMetric: React.FC<{ label: string; value: string; tone?: 'good' | 'warn' }> = ({ label, value, tone }) => (
  <div className="market-metric" data-tone={tone || 'neutral'}>
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
)

const ScoreBar: React.FC<{ label: string; value: number; tone?: 'risk' }> = ({ label, value, tone }) => (
  <div className="market-score-bar" data-tone={tone || 'normal'}>
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
    <div className="market-score-track">
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  </div>
)

const ScoreBadge: React.FC<{ label?: string; value: number; tone?: 'risk' }> = ({ label, value, tone }) => (
  <span className="market-score-badge" data-tone={tone || 'normal'}>
    {label ? `${label} ` : ''}{value}
  </span>
)

const Change: React.FC<{ value: number }> = ({ value }) => (
  <span className="market-change" data-direction={value >= 0 ? 'up' : 'down'}>
    {formatSignedPct(value)}
  </span>
)

interface HotStockCandidate {
  sourceMode: 'external' | 'fallback'
  symbol: string
  name: string | null
  quote: QuoteSnapshot | null
  technical: TechnicalSignal | null
  score: number
  sectors: string[]
  reasons: string[]
  risks: string[]
  narrativeCount: number
  influencerCount: number
  alertCount: number
  mentionCount: number
  sourceName: string | null
  sourceUrl: string | null
  sourceType: HotStockSignal['sourceType'] | null
  heatText: string | null
  hotStockRank: number | null
  fetchedAt: string | null
  latestMentionAt: string | null
}

interface HotStockDraft {
  symbol: string
  name: string | null
  quote: QuoteSnapshot | null
  technical: TechnicalSignal | null
  score: number
  sectors: Set<string>
  reasons: Set<string>
  risks: Set<string>
  narrativeCount: number
  influencerCount: number
  alertCount: number
  latestMentionAt: string | null
}

interface DailyMarketEvent {
  id: string
  kind: 'narrative' | 'post' | 'alert'
  kindLabel: string
  dayKey: string
  timestamp: string
  title: string
  summary: string
  sourceLabel: string
  tone: 'neutral' | 'watch' | 'urgent'
  symbols: string[]
}

interface DailyMarketBucket {
  dayKey: string
  label: string
  bar: MarketBar
  events: DailyMarketEvent[]
  eventCount: number
  narrativeCount: number
  postCount: number
  alertCount: number
  tone: 'neutral' | 'watch' | 'urgent'
}

const CANDLE_CHART = {
  width: 360,
  height: 188,
  paddingTop: 12,
  paddingRight: 52,
  paddingBottom: 28,
  paddingLeft: 10,
}

const CandlestickChart: React.FC<{
  bars: MarketBar[]
  symbol: string
}> = ({ bars, symbol }) => {
  const chart = useMemo(() => buildCandlestickChartModel(bars), [bars])
  const stats = useMemo(() => buildChartStats(bars), [bars])
  const [selectedCandleKey, setSelectedCandleKey] = useState<string | null>(null)
  const chartStats = stats
    ? {
        ...stats,
        direction: stats.changePct >= 0 ? ('up' as const) : ('down' as const),
      }
    : null
  const last = bars[bars.length - 1]
  const selectedCandleIndex = selectedCandleKey ? chart.candles.findIndex((candle) => candle.key === selectedCandleKey) : -1
  const selectedCandle = selectedCandleIndex >= 0 ? chart.candles[selectedCandleIndex] || null : null
  const selectedDetails = selectedCandle
    ? buildSelectedCandleDetails(
        selectedCandle.bar,
        selectedCandleIndex > 0 ? chart.candles[selectedCandleIndex - 1]?.bar || null : null,
        selectedCandleIndex,
        chart.candles.length,
      )
    : null

  useEffect(() => {
    if (chart.candles.length === 0) {
      setSelectedCandleKey(null)
      return
    }
    setSelectedCandleKey((current) => {
      if (current && chart.candles.some((candle) => candle.key === current)) {
        return current
      }
      return chart.candles[chart.candles.length - 1]?.key || null
    })
  }, [chart.candles])

  return (
    <div className="market-sparkline-box">
      <div className="market-sparkline-header">
        <div className="market-sparkline-title">
          <span>最近 {bars.length} 根 {last ? formatTimeframeLabel(last.timeframe) : 'K线'}</span>
          {stats ? (
            <strong>
              {formatPrice(stats.open)} → {formatPrice(stats.close)}
            </strong>
          ) : null}
        </div>
        {chartStats ? (
          <span className="market-candle-change" data-direction={chartStats.direction}>
            {formatSignedPct(chartStats.changePct)}
          </span>
        ) : null}
      </div>
      {chartStats ? (
        <div className="market-candle-summary" aria-label="Chart summary">
          <span data-direction={chartStats.direction}>
            涨跌幅 {formatSignedPct(chartStats.changePct)}
          </span>
          <span>最高 {formatPrice(chartStats.high)}</span>
          <span>最低 {formatPrice(chartStats.low)}</span>
          <span>开盘 {formatPrice(chartStats.open)}</span>
          <span>收盘 {formatPrice(chartStats.close)}</span>
        </div>
      ) : null}
      <svg
        className="market-sparkline"
        viewBox={`0 0 ${CANDLE_CHART.width} ${CANDLE_CHART.height}`}
        role="img"
        aria-label={last ? `最近 ${bars.length} 根 ${formatTimeframeLabel(last.timeframe)} 蜡烛图` : 'K线图'}
      >
        <g className="market-candle-grid">
          {chart.yTicks.map((tick) => (
            <line
              key={`grid-${tick.value}`}
              x1={CANDLE_CHART.paddingLeft}
              x2={CANDLE_CHART.width - CANDLE_CHART.paddingRight}
              y1={tick.y}
              y2={tick.y}
            />
          ))}
        </g>
        <g className="market-candle-axis">
          {chart.yTicks.map((tick) => (
            <text key={`label-${tick.value}`} x={CANDLE_CHART.width - CANDLE_CHART.paddingRight + 6} y={tick.y + 4}>
              {formatPrice(tick.value)}
            </text>
          ))}
          <line
            x1={CANDLE_CHART.paddingLeft}
            x2={CANDLE_CHART.width - CANDLE_CHART.paddingRight}
            y1={CANDLE_CHART.height - CANDLE_CHART.paddingBottom}
            y2={CANDLE_CHART.height - CANDLE_CHART.paddingBottom}
          />
          {chart.xTicks.map((tick) => (
            <g key={`date-${tick.index}`}>
              <line
                x1={tick.x}
                x2={tick.x}
                y1={CANDLE_CHART.height - CANDLE_CHART.paddingBottom}
                y2={CANDLE_CHART.height - CANDLE_CHART.paddingBottom + 5}
              />
              <text x={tick.x} y={CANDLE_CHART.height - 8} textAnchor="middle">
                {tick.label}
              </text>
            </g>
          ))}
        </g>
        <g className="market-candle-series">
          {chart.candles.map((candle, index) => {
            const direction = candle.bar.close > candle.bar.open
              ? 'up'
              : candle.bar.close < candle.bar.open
                ? 'down'
                : 'flat'
            const previousBar = index > 0 ? chart.candles[index - 1]?.bar || null : null
            const isSelected = selectedCandleKey === candle.key
            const bodyY = Math.min(candle.openY, candle.closeY)
            const bodyHeight = Math.max(1.5, Math.abs(candle.openY - candle.closeY))

            return (
              <g
                key={candle.key}
                className="market-candle"
                data-direction={direction}
                data-selected={isSelected}
                data-clickable="true"
                role="button"
                tabIndex={0}
                onClick={() => {
                  setSelectedCandleKey(candle.key)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setSelectedCandleKey(candle.key)
                  }
                }}
              >
                <title>
                  {formatBarTooltip(candle.bar, previousBar)}
                </title>
                <line
                  className="market-candle-wick"
                  x1={candle.centerX}
                  x2={candle.centerX}
                  y1={candle.highY}
                  y2={candle.lowY}
                />
                {direction === 'flat' ? (
                  <line
                    className="market-candle-body market-candle-doji"
                    x1={candle.left}
                    x2={candle.right}
                    y1={candle.closeY}
                    y2={candle.closeY}
                  />
                ) : (
                  <rect
                    className="market-candle-body"
                    x={candle.left}
                    y={bodyY}
                    width={candle.width}
                    height={bodyHeight}
                    rx="1.4"
                    ry="1.4"
                  />
                )}
              </g>
            )
          })}
        </g>
      </svg>
      <div className="market-candle-detail">
        <div className="market-candle-detail-header">
          <div className="market-candle-detail-copy">
            <span>柱子详情</span>
            <strong>
              {selectedCandle
                ? `${formatBarDetailLabel(selectedCandle.bar)} · ${formatTimeframeLabel(selectedCandle.bar.timeframe)} · ${selectedDetails?.positionLabel || ''}`
                : '点击任意柱子查看详情'}
            </strong>
          </div>
          {selectedDetails ? (
            <span className="market-candle-detail-pill" data-direction={selectedDetails.direction}>
              {selectedDetails.direction === 'up' ? '上涨' : selectedDetails.direction === 'down' ? '下跌' : '平盘'}
            </span>
          ) : null}
        </div>
        {selectedCandle && selectedDetails ? (
          <>
            <div className="market-candle-detail-grid">
              <MarketMetric label="开盘" value={formatPrice(selectedCandle.bar.open)} />
              <MarketMetric label="最高" value={formatPrice(selectedCandle.bar.high)} />
              <MarketMetric label="最低" value={formatPrice(selectedCandle.bar.low)} />
              <MarketMetric label="收盘" value={formatPrice(selectedCandle.bar.close)} />
              <MarketMetric
                label="前收"
                value={selectedDetails.previousClose !== null ? formatPrice(selectedDetails.previousClose) : '--'}
              />
              <MarketMetric
                label="涨跌额"
                value={selectedDetails.changeAmount !== null ? formatSignedPrice(selectedDetails.changeAmount) : '--'}
                {...(selectedDetails.changeAmount === null
                  ? {}
                  : { tone: selectedDetails.changeAmount >= 0 ? 'good' : 'warn' })}
              />
              <MarketMetric
                label="涨跌幅"
                value={selectedDetails.changePct !== null ? formatSignedPct(selectedDetails.changePct) : '--'}
                {...(selectedDetails.changePct === null
                  ? {}
                  : { tone: selectedDetails.changePct >= 0 ? 'good' : 'warn' })}
              />
              <MarketMetric
                label="振幅"
                value={selectedDetails.amplitudePct !== null ? formatSignedPct(selectedDetails.amplitudePct) : '--'}
              />
              <MarketMetric label="成交量" value={formatInteger(selectedCandle.bar.volume)} />
              <MarketMetric label="成交额" value={formatInteger(selectedCandle.bar.amount)} />
            </div>
            <p className="market-candle-detail-note">
              涨跌额、涨跌幅按前一根柱子的收盘价计算；第一根柱子会显示为 `--`。
            </p>
          </>
        ) : (
          <p className="market-muted">点击任意柱子查看该柱子的开高低收、涨跌幅、振幅、成交量和成交额。</p>
        )}
      </div>
    </div>
  )
}

function buildCandlestickChartModel(bars: MarketBar[]): {
  candles: Array<{
    key: string
    bar: MarketBar
    dayKey: string
    centerX: number
    left: number
    right: number
    width: number
    openY: number
    closeY: number
    highY: number
    lowY: number
  }>
  yTicks: Array<{ value: number; y: number }>
  xTicks: Array<{ index: number; label: string; x: number }>
} {
  if (bars.length === 0) {
    return {
      candles: [],
      yTicks: [],
      xTicks: [],
    }
  }

  const plotWidth = CANDLE_CHART.width - CANDLE_CHART.paddingLeft - CANDLE_CHART.paddingRight
  const plotHeight = CANDLE_CHART.height - CANDLE_CHART.paddingTop - CANDLE_CHART.paddingBottom
  const high = Math.max(...bars.map((bar) => bar.high))
  const low = Math.min(...bars.map((bar) => bar.low))
  const baseRange = high - low || Math.max(Math.abs(high) * 0.04, 1)
  const paddedHigh = high + baseRange * 0.08
  const paddedLow = Math.max(0, low - baseRange * 0.08)
  const paddedRange = paddedHigh - paddedLow || 1
  const step = plotWidth / bars.length
  const bodyWidth = Math.max(4, Math.min(10, step * 0.58))

  const toY = (value: number) => {
    return CANDLE_CHART.paddingTop + ((paddedHigh - value) / paddedRange) * plotHeight
  }

  const candles = bars.map((bar, index) => {
    const centerX = CANDLE_CHART.paddingLeft + step * index + step / 2
    return {
      key: `${bar.ts}-${index}`,
      bar,
      dayKey: getShanghaiDayKey(bar.ts),
      centerX: roundForSvg(centerX),
      left: roundForSvg(centerX - bodyWidth / 2),
      right: roundForSvg(centerX + bodyWidth / 2),
      width: roundForSvg(bodyWidth),
      openY: roundForSvg(toY(bar.open)),
      closeY: roundForSvg(toY(bar.close)),
      highY: roundForSvg(toY(bar.high)),
      lowY: roundForSvg(toY(bar.low)),
    }
  })

  const tickValues = [paddedHigh, paddedHigh - paddedRange / 2, paddedLow]
  const yTicks = tickValues.map((value) => ({
    value: roundForAxis(value),
    y: roundForSvg(toY(value)),
  }))

  const xTickCount = bars.length >= 90 ? 5 : bars.length >= 30 ? 4 : 3
  const rawTickIndices = buildTickIndices(bars.length, xTickCount)
  const firstBar = bars[0]
  const useMinuteDateLabels = firstBar ? isMinuteTimeframe(firstBar.timeframe) && new Set(bars.map((bar) => bar.ts.slice(0, 10))).size > 1 : false
  const xTickIndices = Array.from(new Set(rawTickIndices.filter((index) => index >= 0 && index < bars.length))).sort((left, right) => left - right)
  const xTicks = xTickIndices.map((index) => ({
    index,
    label: formatBarAxisLabel(bars[index], useMinuteDateLabels),
    x: candles[index]?.centerX || 0,
  }))

  return {
    candles,
    yTicks,
    xTicks,
  }
}

function buildChartStats(bars: MarketBar[]): {
  open: number
  close: number
  high: number
  low: number
  changePct: number
} | null {
  if (bars.length === 0) {
    return null
  }
  const first = bars[0]
  const last = bars[bars.length - 1]
  if (!first || !last) {
    return null
  }
  const high = Math.max(...bars.map((bar) => bar.high))
  const low = Math.min(...bars.map((bar) => bar.low))
  const changePct = first.close
    ? ((last.close - first.close) / first.close) * 100
    : 0
  return {
    open: first.open,
    close: last.close,
    high,
    low,
    changePct,
  }
}

function buildHotStockCandidates(input: {
  overview: MarketOverview
  narratives: MarketNarrative[]
  technicals: TechnicalSignal[]
}): HotStockCandidate[] {
  const quoteByKey = buildQuoteLookup(mergeQuotes(input.overview.quotes, input.overview.hotStockQuotes))
  const technicalByKey = buildTechnicalLookup(input.technicals)

  if (input.overview.hotStocks.length > 0) {
    return buildExternalHotStockCandidates(input, quoteByKey, technicalByKey)
  }

  const drafts = new Map<string, HotStockDraft>()
  const ensureDraft = (symbol: string): HotStockDraft => {
    const key = getSymbolKey(symbol)
    const quote = quoteByKey.get(key) || null
    const technical = technicalByKey.get(key) || null
    const existing = drafts.get(key)
    if (existing) {
      if (!existing.quote && quote) {
        existing.symbol = quote.symbol
        existing.name = quote.name || null
        existing.quote = quote
      }
      if (!existing.technical && technical) {
        existing.technical = technical
      }
      return existing
    }
    const draft: HotStockDraft = {
      symbol: quote?.symbol || symbol.toUpperCase(),
      name: quote?.name || null,
      quote,
      technical,
      score: 0,
      sectors: new Set(),
      reasons: new Set(),
      risks: new Set(),
      narrativeCount: 0,
      influencerCount: 0,
      alertCount: 0,
      latestMentionAt: null,
    }
    drafts.set(key, draft)
    return draft
  }

  for (const quote of input.overview.quotes) {
    const draft = ensureDraft(quote.symbol)
    const absChange = Math.abs(quote.changePct)
    draft.score += 12 + Math.min(22, Math.max(0, quote.changePct) * 2.2)
    draft.score += Math.min(12, absChange * 1.1)
    draft.score += Math.min(14, Math.max(0, quote.volumeRatio - 1) * 4)
    draft.score += Math.min(10, Math.max(0, quote.turnoverRate) * 0.45)
    if (quote.changePct >= 7) {
      draft.reasons.add(`涨幅 ${formatSignedPct(quote.changePct)}，接近强势区间`)
    } else if (quote.changePct >= 3) {
      draft.reasons.add(`涨幅 ${formatSignedPct(quote.changePct)}，短线动能较强`)
    } else if (quote.changePct <= -4) {
      draft.reasons.add(`跌幅 ${formatSignedPct(quote.changePct)}，波动显著需要复核`)
    } else {
      draft.reasons.add(`本地行情监控，当前涨跌幅 ${formatSignedPct(quote.changePct)}`)
    }
    if (quote.volumeRatio >= 2) {
      draft.reasons.add(`量比 ${formatNullableNumber(quote.volumeRatio)}x，成交明显放大`)
    }
    if (quote.turnoverRate >= 6) {
      draft.reasons.add(`换手 ${formatNullableNumber(quote.turnoverRate)}%，筹码交换活跃`)
    }
    if (quote.limitUp) {
      draft.score += 18
      draft.reasons.add('触及涨停标记')
    }
    if (quote.limitDown) {
      draft.score += 10
      draft.risks.add('触及跌停标记，流动性和隔日风险较高')
    }
    if (quote.changePct < 0) {
      draft.risks.add('价格走弱，需确认是否只是消息热度而非趋势共振')
    }
  }

  for (const sector of input.overview.sectors) {
    const sectorBoost = Math.min(18, sector.strengthScore * 0.18 + Math.max(0, sector.changePct) * 1.2)
    for (const symbol of sector.leaderSymbols) {
      const draft = ensureDraft(symbol)
      draft.score += sectorBoost
      draft.sectors.add(sector.sectorName)
      draft.reasons.add(`热门板块「${sector.sectorName}」龙头，板块强度 ${sector.strengthScore}`)
      if (sector.riskScore >= 70) {
        draft.risks.add(`所在板块「${sector.sectorName}」风险分 ${sector.riskScore} 偏高`)
      }
    }
  }

  for (const narrative of input.narratives) {
    const timestamp = narrative.publishedAt || narrative.fetchedAt
    for (const symbol of narrative.symbols) {
      const draft = ensureDraft(symbol)
      draft.score += 8 + narrative.confidenceScore * 0.06 + narrative.catalystScore * 0.08
      draft.narrativeCount += 1
      updateLatestMention(draft, timestamp)
      for (const sector of narrative.sectors) {
        draft.sectors.add(sector)
      }
      draft.reasons.add(`题材「${narrative.title}」提及，催化 ${narrative.catalystScore}`)
      if (narrative.category === 'rumor') {
        draft.risks.add('包含小作文/传闻来源，必须回查公告和原文')
      }
      if (narrative.riskScore >= 65) {
        draft.risks.add(`题材风险分 ${narrative.riskScore} 偏高`)
      }
    }
  }

  for (const post of input.overview.influencerPosts) {
    const timestamp = post.publishedAt || post.fetchedAt
    for (const symbol of post.symbols) {
      const draft = ensureDraft(symbol)
      draft.score += 6 + post.influenceScore * 0.08 + post.noveltyScore * 0.04
      draft.influencerCount += 1
      updateLatestMention(draft, timestamp)
      for (const sector of post.sectors) {
        draft.sectors.add(sector)
      }
      draft.reasons.add(`淘股吧大V「${post.authorName}」提及，影响力 ${post.influenceScore}`)
      if (post.stance === 'bearish') {
        draft.risks.add(`大V「${post.authorName}」观点偏空`)
      }
      if (post.stance === 'unclear' || !post.stance) {
        draft.risks.add('大V观点方向不清晰，不能直接当作买卖依据')
      }
    }
  }

  for (const alert of input.overview.alerts) {
    for (const symbol of alert.symbols) {
      const draft = ensureDraft(symbol)
      draft.score += alert.level === 'urgent' ? 18 : alert.level === 'watch' ? 12 : 6
      draft.alertCount += 1
      updateLatestMention(draft, alert.triggeredAt)
      for (const sector of alert.sectors) {
        draft.sectors.add(sector)
      }
      draft.reasons.add(`触发「${alert.title}」${alert.level === 'urgent' ? '紧急' : alert.level === 'watch' ? '观察' : '提示'}预警`)
      if (alert.level === 'urgent') {
        draft.risks.add('存在紧急预警，先确认触发条件和失效条件')
      }
    }
  }

  for (const technical of technicalByKey.values()) {
    const draft = ensureDraft(technical.symbol)
    if (technical.trend === 'uptrend') {
      draft.score += 10
      draft.reasons.add(`技术趋势为${formatTrendLabel(technical.trend)}`)
    } else if (technical.trend === 'sideways') {
      draft.score += 3
      draft.reasons.add('技术趋势横盘，适合继续观察突破方向')
    } else {
      draft.score += 2
      draft.risks.add('技术趋势下行，消息热度可能无法转化为价格强度')
    }
    if (technical.volumeSignal === 'expanding') {
      draft.score += 7
      draft.reasons.add('技术面显示成交扩张')
    }
    if (technical.rsi6 >= 82) {
      draft.risks.add(`RSI6 ${technical.rsi6} 偏热，追高风险增加`)
    }
    for (const note of technical.riskNotes.slice(0, 2)) {
      draft.risks.add(note)
    }
  }

  return Array.from(drafts.values())
    .map((draft) => ({
      sourceMode: 'fallback' as const,
      symbol: draft.symbol,
      name: draft.name,
      quote: draft.quote,
      technical: draft.technical,
      score: Math.max(0, Math.round(draft.score)),
      sectors: Array.from(draft.sectors).slice(0, 5),
      reasons: Array.from(draft.reasons).slice(0, 6),
      risks: normalizeRiskList(draft),
      narrativeCount: draft.narrativeCount,
      influencerCount: draft.influencerCount,
      alertCount: draft.alertCount,
      mentionCount: 0,
      sourceName: null,
      sourceUrl: null,
      sourceType: null,
      heatText: null,
      hotStockRank: null,
      fetchedAt: null,
      latestMentionAt: draft.latestMentionAt,
    }))
    .filter((candidate) => candidate.score > 0 || candidate.quote || candidate.narrativeCount + candidate.influencerCount + candidate.alertCount > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return (right.quote?.changePct || 0) - (left.quote?.changePct || 0)
    })
}

function buildQuoteLookup(quotes: QuoteSnapshot[]): Map<string, QuoteSnapshot> {
  const quoteByKey = new Map<string, QuoteSnapshot>()
  for (const quote of quotes) {
    quoteByKey.set(getSymbolKey(quote.symbol), quote)
  }
  return quoteByKey
}

function buildTechnicalLookup(technicals: TechnicalSignal[]): Map<string, TechnicalSignal> {
  const technicalByKey = new Map<string, TechnicalSignal>()
  for (const technical of technicals) {
    const key = getSymbolKey(technical.symbol)
    const current = technicalByKey.get(key)
    if (!current || shouldReplaceTechnical(current, technical)) {
      technicalByKey.set(key, technical)
    }
  }
  return technicalByKey
}

function buildExternalHotStockCandidates(
  input: {
    overview: MarketOverview
    narratives: MarketNarrative[]
    technicals: TechnicalSignal[]
  },
  quoteByKey: Map<string, QuoteSnapshot>,
  technicalByKey: Map<string, TechnicalSignal>
): HotStockCandidate[] {
  return input.overview.hotStocks
    .map((signal) => {
      const key = getSymbolKey(signal.symbol)
      const quote = quoteByKey.get(key) || null
      const technical = technicalByKey.get(key) || null
      const sectors = new Set(signal.sectors)
      const reasons = new Set(signal.reasons)
      const risks = new Set<string>([
        '淘股吧热榜只代表外部关注度，需要回到原页面和公告核验',
      ])
      let latestMentionAt: string | null = signal.publishedAt || signal.fetchedAt
      let narrativeCount = 0
      let influencerCount = 0
      let alertCount = 0
      let score = signal.score

      if (signal.heatText) {
        reasons.add(`热榜摘录：${signal.heatText}`)
      }
      if (quote) {
        score += Math.min(10, Math.max(0, quote.changePct) * 0.8)
        reasons.add(`已补行情，当前涨跌幅 ${formatSignedPct(quote.changePct)}`)
        if (quote.volumeRatio >= 2) {
          reasons.add(`量比 ${formatNullableNumber(quote.volumeRatio)}x，成交放大`)
        }
        if (quote.changePct < 0) {
          risks.add('热度较高但价格走弱，需确认是否已经转弱')
        }
      } else {
        risks.add('热榜有标的，但行情 provider 未补齐行情')
      }

      if (technical) {
        if (technical.trend === 'uptrend') {
          score += 5
          reasons.add(`技术趋势为${formatTrendLabel(technical.trend)}`)
        } else if (technical.trend === 'downtrend') {
          risks.add('技术趋势下行，热度可能只是短线关注')
        }
        if (technical.volumeSignal === 'expanding') {
          score += 4
          reasons.add('技术面显示成交扩张')
        }
        for (const note of technical.riskNotes.slice(0, 2)) {
          risks.add(note)
        }
      }

      for (const sector of input.overview.sectors) {
        if (sector.leaderSymbols.some((symbol) => getSymbolKey(symbol) === key)) {
          sectors.add(sector.sectorName)
          reasons.add(`同步出现在热门板块「${sector.sectorName}」龙头列表`)
        }
      }

      for (const narrative of input.narratives) {
        if (!matchesSymbol(narrative.symbols, signal.symbol)) {
          continue
        }
        narrativeCount += 1
        latestMentionAt = pickLatestTimestamp(latestMentionAt, narrative.publishedAt || narrative.fetchedAt)
        for (const sector of narrative.sectors) {
          sectors.add(sector)
        }
      }

      for (const post of input.overview.influencerPosts) {
        if (!matchesSymbol(post.symbols, signal.symbol)) {
          continue
        }
        influencerCount += 1
        latestMentionAt = pickLatestTimestamp(latestMentionAt, post.publishedAt || post.fetchedAt)
      }

      for (const alert of input.overview.alerts) {
        if (!matchesSymbol(alert.symbols, signal.symbol)) {
          continue
        }
        alertCount += 1
        latestMentionAt = pickLatestTimestamp(latestMentionAt, alert.triggeredAt)
        if (alert.level === 'urgent') {
          risks.add(`同步触发紧急预警「${alert.title}」`)
        }
      }

      if (reasons.size === 0) {
        reasons.add(`${signal.sourceName} 排名 #${signal.rank}`)
      }

      return {
        sourceMode: 'external' as const,
        symbol: quote?.symbol || signal.symbol,
        name: signal.name || quote?.name || null,
        quote,
        technical,
        score: Math.max(1, Math.min(100, Math.round(score))),
        sectors: Array.from(sectors).slice(0, 5),
        reasons: Array.from(reasons).slice(0, 6),
        risks: Array.from(risks).slice(0, 4),
        narrativeCount,
        influencerCount,
        alertCount,
        mentionCount: Math.max(1, signal.mentionCount || 1),
        sourceName: signal.sourceName,
        sourceUrl: signal.sourceUrl || null,
        sourceType: signal.sourceType,
        heatText: signal.heatText,
        hotStockRank: signal.rank,
        fetchedAt: signal.fetchedAt,
        latestMentionAt,
      }
    })
    .sort((left, right) => {
      if (left.hotStockRank !== null && right.hotStockRank !== null && left.hotStockRank !== right.hotStockRank) {
        return left.hotStockRank - right.hotStockRank
      }
      return right.score - left.score
    })
}

function mergeQuotes(...groups: QuoteSnapshot[][]): QuoteSnapshot[] {
  const merged = new Map<string, QuoteSnapshot>()
  for (const quote of groups.flat()) {
    const key = getSymbolKey(quote.symbol)
    const existing = merged.get(key)
    if (existing) {
      if (!existing.name && quote.name) {
        merged.set(key, { ...existing, name: quote.name })
      }
      continue
    }
    merged.set(key, quote)
  }
  return Array.from(merged.values())
}

function groupDragonTigerDailyStocks(stocks: DragonTigerDailyStock[]): Array<{
  tradeDate: string
  netBuyAmount: number
  totalAmount: number
  items: DragonTigerDailyStock[]
}> {
  const groups = new Map<string, DragonTigerDailyStock[]>()
  for (const stock of stocks) {
    const tradeDate = stock.tradeDate.slice(0, 10)
    const items = groups.get(tradeDate) || []
    items.push(stock)
    groups.set(tradeDate, items)
  }
  return Array.from(groups.entries())
    .map(([tradeDate, items]) => {
      const sortedItems = [...items].sort((left, right) => {
        const leftIndex = left.rawIndex ?? Number.MAX_SAFE_INTEGER
        const rightIndex = right.rawIndex ?? Number.MAX_SAFE_INTEGER
        if (leftIndex !== rightIndex) {
          return leftIndex - rightIndex
        }
        return left.symbol.localeCompare(right.symbol)
      })
      return {
        tradeDate,
        netBuyAmount: sortedItems.reduce((sum, item) => sum + item.netBuyAmount, 0),
        totalAmount: sortedItems.reduce((sum, item) => sum + item.totalAmount, 0),
        items: sortedItems,
      }
    })
    .sort((left, right) => right.tradeDate.localeCompare(left.tradeDate))
}

function dailyStockToDragonTigerStock(stock: DragonTigerDailyStock): DragonTigerStock {
  return {
    id: stock.id,
    symbol: stock.symbol,
    ...(stock.name ? { name: stock.name } : {}),
    latestListedAt: stock.tradeDate,
    closePrice: stock.closePrice,
    changePct: stock.changePct,
    listingCount: 1,
    netBuyAmount: stock.netBuyAmount,
    buyAmount: stock.buyAmount,
    sellAmount: stock.sellAmount,
    totalAmount: stock.totalAmount,
    institutionBuyCount: 0,
    institutionSellCount: 0,
    institutionNetBuyAmount: 0,
    ...(stock.interpretation ? { interpretation: stock.interpretation } : {}),
    ...(stock.listingReason ? { listingReason: stock.listingReason } : {}),
    ...(typeof stock.after1DayReturn === 'number' ? { after1DayReturn: stock.after1DayReturn } : {}),
    ...(typeof stock.after2DayReturn === 'number' ? { after2DayReturn: stock.after2DayReturn } : {}),
    ...(typeof stock.after5DayReturn === 'number' ? { after5DayReturn: stock.after5DayReturn } : {}),
    ...(typeof stock.after10DayReturn === 'number' ? { after10DayReturn: stock.after10DayReturn } : {}),
    source: stock.source,
  }
}

function pickLatestTimestamp(current: string | null, next: string): string {
  if (!current || next.localeCompare(current) > 0) {
    return next
  }
  return current
}

function shouldReplaceTechnical(current: TechnicalSignal, next: TechnicalSignal): boolean {
  if (current.timeframe !== '1d' && next.timeframe === '1d') {
    return true
  }
  if (current.timeframe === '1d' && next.timeframe !== '1d') {
    return false
  }
  return next.ts.localeCompare(current.ts) > 0
}

function updateLatestMention(draft: HotStockDraft, timestamp: string): void {
  if (!draft.latestMentionAt || timestamp.localeCompare(draft.latestMentionAt) > 0) {
    draft.latestMentionAt = timestamp
  }
}

function normalizeRiskList(draft: HotStockDraft): string[] {
  const risks = Array.from(draft.risks)
  if (risks.length > 0) {
    return risks
  }
  if (!draft.quote) {
    return ['当前没有行情快照，需先补齐价格、成交量和流动性数据']
  }
  return ['热度仅用于线索排序，仍需人工复核公告、成交和仓位风险']
}

function getSymbolKey(symbol: string): string {
  const normalized = symbol.trim().toUpperCase()
  const withoutPrefix = normalized.replace(/^(SHSE|SSE|SZSE|SZ)\./, '')
  return withoutPrefix.split('.')[0] || normalized
}

function formatNullableNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '--'
  }
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: value >= 10 ? 1 : 2,
    maximumFractionDigits: value >= 10 ? 1 : 2,
  }).format(value)
}

function formatTrendLabel(value: TechnicalSignal['trend']): string {
  if (value === 'uptrend') {
    return '上升趋势'
  }
  if (value === 'downtrend') {
    return '下降趋势'
  }
  return '横盘震荡'
}

function formatSeatType(value: DragonTigerSeat['seatType']): string {
  if (value === 'institution') {
    return '机构席位'
  }
  if (value === 'northbound') {
    return '北向席位'
  }
  if (value === 'broker') {
    return '营业部'
  }
  return '未知席位'
}

function roundForSvg(value: number): number {
  return Math.round(value * 10) / 10
}

function roundForAxis(value: number): number {
  return Math.round(value * 100) / 100
}

function formatPhase(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: value >= 1000 ? 1 : 2,
    maximumFractionDigits: value >= 1000 ? 1 : 2,
  }).format(value)
}

function formatSignedPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}%`
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

function formatCompactAmount(value: number): string {
  const abs = Math.abs(value)
  if (!Number.isFinite(value)) {
    return '--'
  }
  if (abs >= 100_000_000) {
    return `${value >= 0 ? '+' : '-'}${(abs / 100_000_000).toFixed(2)}亿`
  }
  if (abs >= 10_000) {
    return `${value >= 0 ? '+' : '-'}${(abs / 10_000).toFixed(2)}万`
  }
  return `${value >= 0 ? '+' : '-'}${formatInteger(abs)}`
}

function formatCompactUnsignedAmount(value: number): string {
  if (!Number.isFinite(value) || value === 0) {
    return '--'
  }
  const abs = Math.abs(value)
  if (abs >= 100_000_000) {
    return `${(abs / 100_000_000).toFixed(2)}亿`
  }
  if (abs >= 10_000) {
    return `${(abs / 10_000).toFixed(2)}万`
  }
  return formatInteger(abs)
}

function formatOptionalPrice(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '--'
  }
  return formatPrice(value)
}

function formatOptionalSignedPct(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '--'
  }
  return formatSignedPct(value)
}

function formatOptionalPct(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '--'
  }
  return `${formatNullableNumber(value)}%`
}

function formatDateLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).format(date)
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function formatShortDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function formatShanghaiDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function formatTimeframeLabel(value: MarketBar['timeframe']): string {
  if (value === '1m') {
    return '分时'
  }
  if (value === '5m') {
    return '5分'
  }
  if (value === '15m') {
    return '15分'
  }
  if (value === '30m') {
    return '30分'
  }
  if (value === '60m') {
    return '60分'
  }
  if (value === '1mo') {
    return '月K'
  }
  if (value === '1y') {
    return '年K'
  }
  return '日K'
}

function formatBarAxisLabel(bar: MarketBar | undefined, includeDateForMinute = false): string {
  if (!bar) {
    return ''
  }
  const date = new Date(bar.ts)
  if (Number.isNaN(date.getTime())) {
    return bar.ts.slice(0, 10)
  }
  const parts = getShanghaiDateParts(date)
  if (isMinuteTimeframe(bar.timeframe)) {
    const monthDay = `${parts.month}-${parts.day}`
    const time = `${parts.hour}:${parts.minute}`
    return includeDateForMinute ? `${monthDay} ${time}` : time
  }
  if (bar.timeframe === '1y') {
    return parts.year
  }
  if (bar.timeframe === '1mo') {
    return `${parts.year}-${parts.month}`
  }
  return `${parts.month}-${parts.day}`
}

function formatBarDetailLabel(bar: MarketBar): string {
  const date = new Date(bar.ts)
  if (Number.isNaN(date.getTime())) {
    return bar.ts.slice(0, 10)
  }
  const parts = getShanghaiDateParts(date)
  if (isMinuteTimeframe(bar.timeframe)) {
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
  }
  if (bar.timeframe === '1y') {
    return parts.year
  }
  if (bar.timeframe === '1mo') {
    return `${parts.year}-${parts.month}`
  }
  return `${parts.year}-${parts.month}-${parts.day}`
}

function formatSignedPrice(value: number): string {
  const magnitude = formatPrice(Math.abs(value))
  return `${value >= 0 ? '+' : '-'}${magnitude}`
}

function formatBarTooltip(bar: MarketBar, previousBar: MarketBar | null = null): string {
  const changeAmount = previousBar ? bar.close - previousBar.close : null
  const changePct = previousBar && previousBar.close !== 0
    ? ((bar.close - previousBar.close) / previousBar.close) * 100
    : null
  const amplitudePct = bar.close !== 0
    ? ((bar.high - bar.low) / bar.close) * 100
    : null
  return [
    `${formatBarDetailLabel(bar)} ${formatTimeframeLabel(bar.timeframe)}`,
    `开 ${formatPrice(bar.open)}`,
    `高 ${formatPrice(bar.high)}`,
    `低 ${formatPrice(bar.low)}`,
    `收 ${formatPrice(bar.close)}`,
    previousBar ? `前收 ${formatPrice(previousBar.close)}` : '',
    changeAmount !== null ? `涨跌 ${formatSignedPrice(changeAmount)}` : '',
    changePct !== null ? `涨跌幅 ${formatSignedPct(changePct)}` : '',
    amplitudePct !== null ? `振幅 ${formatSignedPct(amplitudePct)}` : '',
    `量 ${formatInteger(bar.volume)}`,
    `额 ${formatInteger(bar.amount)}`,
  ].filter(Boolean).join(' · ')
}

function formatQuoteLabel(quote: QuoteSnapshot | null | undefined, fallbackSymbol: string): string {
  if (!quote) {
    return fallbackSymbol
  }
  return quote.name ? `${quote.name} (${quote.symbol})` : quote.symbol
}

function buildTechnicalKey(symbol: string, timeframe: TechnicalTimeframe): string {
  return `${symbol}:${timeframe}`
}

function buildSelectedCandleDetails(
  bar: MarketBar,
  previousBar: MarketBar | null,
  index: number,
  total: number
): {
  direction: 'up' | 'down' | 'flat'
  previousClose: number | null
  changeAmount: number | null
  changePct: number | null
  amplitudePct: number | null
  positionLabel: string
} {
  const previousClose = previousBar?.close ?? null
  const changeAmount = previousClose !== null ? bar.close - previousClose : null
  const changePct = previousClose !== null && previousClose !== 0
    ? ((bar.close - previousClose) / previousClose) * 100
    : null
  const amplitudePct = bar.close !== 0
    ? ((bar.high - bar.low) / bar.close) * 100
    : null
  const direction = changeAmount === null
    ? bar.close > bar.open
      ? 'up'
      : bar.close < bar.open
        ? 'down'
        : 'flat'
    : changeAmount > 0
      ? 'up'
      : changeAmount < 0
        ? 'down'
        : 'flat'

  return {
    direction,
    previousClose,
    changeAmount,
    changePct,
    amplitudePct,
    positionLabel: total > 0
      ? `第 ${index + 1} / ${total} 根${index + 1 === total ? ' · 最新' : ''}`
      : '无数据',
  }
}

function buildDailyMarketEventBuckets(input: {
  bars: MarketBar[]
  symbol: string
  narratives: MarketNarrative[]
  influencerPosts: InfluencerPost[]
  alerts: MarketAlert[]
}): {
  byKey: Map<string, DailyMarketBucket>
  defaultKey: string
} {
  const dailyBars = input.bars
    .filter((bar) => bar.timeframe === '1d')
    .slice()
    .sort((left, right) => left.ts.localeCompare(right.ts))
  const buckets = new Map<string, DailyMarketBucket>()
  for (const bar of dailyBars) {
    const dayKey = getShanghaiDayKey(bar.ts)
    const existing = buckets.get(dayKey)
    if (existing) {
      existing.bar = bar
      continue
    }
    buckets.set(dayKey, {
      dayKey,
      label: formatShanghaiDayLabel(dayKey),
      bar,
      events: [],
      eventCount: 0,
      narrativeCount: 0,
      postCount: 0,
      alertCount: 0,
      tone: 'neutral',
    })
  }

  const pushEvent = (event: DailyMarketEvent) => {
    const bucket = buckets.get(event.dayKey)
    if (!bucket) {
      return
    }
    bucket.events.push(event)
    bucket.eventCount += 1
    if (event.kind === 'narrative') {
      bucket.narrativeCount += 1
    } else if (event.kind === 'post') {
      bucket.postCount += 1
    } else {
      bucket.alertCount += 1
    }
    bucket.tone = mergeTone(bucket.tone, event.tone)
  }

  for (const narrative of input.narratives) {
    if (!matchesSymbol(narrative.symbols, input.symbol)) {
      continue
    }
    const timestamp = narrative.publishedAt || narrative.fetchedAt
    const dayKey = getShanghaiDayKey(timestamp)
    pushEvent({
      id: `narrative:${narrative.id}`,
      kind: 'narrative',
      kindLabel: narrative.category === 'announcement'
        ? '公告'
        : narrative.category === 'news'
          ? '新闻'
          : narrative.category === 'research'
            ? '研报'
            : narrative.category === 'social'
              ? '社媒'
              : narrative.category === 'rumor'
                ? '小作文'
                : '笔记',
      dayKey,
      timestamp,
      title: narrative.title,
      summary: narrative.aiSummary || narrative.content,
      sourceLabel: narrative.source.sourceName,
      tone: toneFromNarrative(narrative),
      symbols: narrative.symbols.length > 0 ? narrative.symbols : [input.symbol],
    })
  }

  for (const post of input.influencerPosts) {
    if (!matchesSymbol(post.symbols, input.symbol)) {
      continue
    }
    const timestamp = post.publishedAt || post.fetchedAt
    const dayKey = getShanghaiDayKey(timestamp)
    pushEvent({
      id: `post:${post.id}`,
      kind: 'post',
      kindLabel: '淘股吧大V',
      dayKey,
      timestamp,
      title: post.title || post.authorName,
      summary: post.content,
      sourceLabel: post.authorName,
      tone: toneFromPost(post),
      symbols: post.symbols.length > 0 ? post.symbols : [input.symbol],
    })
  }

  for (const alert of input.alerts) {
    if (!matchesSymbol(alert.symbols, input.symbol)) {
      continue
    }
    const dayKey = getShanghaiDayKey(alert.triggeredAt)
    pushEvent({
      id: `alert:${alert.id}`,
      kind: 'alert',
      kindLabel: alert.level === 'urgent' ? '预警' : alert.level === 'watch' ? '观察' : '提示',
      dayKey,
      timestamp: alert.triggeredAt,
      title: alert.title,
      summary: alert.message,
      sourceLabel: alert.ruleId || 'system alert',
      tone: alert.level === 'urgent' ? 'urgent' : alert.level === 'watch' ? 'watch' : 'neutral',
      symbols: alert.symbols.length > 0 ? alert.symbols : [input.symbol],
    })
  }

  const sortedBuckets = Array.from(buckets.values()).sort((left, right) => left.bar.ts.localeCompare(right.bar.ts))
  for (const bucket of sortedBuckets) {
    bucket.events.sort((left, right) => right.timestamp.localeCompare(left.timestamp) || left.kind.localeCompare(right.kind))
  }
  const byKey = new Map(sortedBuckets.map((bucket) => [bucket.dayKey, bucket]))
  return {
    byKey,
    defaultKey: sortedBuckets[sortedBuckets.length - 1]?.dayKey || '',
  }
}

function getShanghaiDayKey(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10)
  }
  const parts = getShanghaiDateParts(date)
  return `${parts.year}-${parts.month}-${parts.day}`
}

function formatShanghaiDayLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split('-')
  if (!year || !month || !day) {
    return dayKey
  }
  return `${year}-${month}-${day}`
}

function matchesSymbol(symbols: string[], symbol: string): boolean {
  if (!symbol) {
    return false
  }
  return symbols.some((item) => item === symbol || item.split('.')[0] === symbol.split('.')[0])
}

function toneFromNarrative(narrative: MarketNarrative): 'neutral' | 'watch' | 'urgent' {
  if (narrative.riskScore >= 70) {
    return 'urgent'
  }
  if (narrative.catalystScore >= 60 || narrative.confidenceScore >= 60) {
    return 'watch'
  }
  return 'neutral'
}

function toneFromPost(post: InfluencerPost): 'neutral' | 'watch' | 'urgent' {
  if (post.influenceScore >= 75) {
    return 'urgent'
  }
  if (post.influenceScore >= 55) {
    return 'watch'
  }
  return 'neutral'
}

function mergeTone(current: 'neutral' | 'watch' | 'urgent', next: 'neutral' | 'watch' | 'urgent'): 'neutral' | 'watch' | 'urgent' {
  if (current === 'urgent' || next === 'urgent') {
    return 'urgent'
  }
  if (current === 'watch' || next === 'watch') {
    return 'watch'
  }
  return 'neutral'
}

function isMinuteTimeframe(timeframe: MarketBar['timeframe']): boolean {
  return timeframe === '1m' || timeframe === '5m' || timeframe === '15m' || timeframe === '30m' || timeframe === '60m'
}

function buildTickIndices(length: number, count: number): number[] {
  if (length <= 1 || count <= 1) {
    return [0]
  }
  const result: number[] = []
  for (let index = 0; index < count; index += 1) {
    result.push(Math.round((length - 1) * (index / (count - 1))))
  }
  return result
}

function getShanghaiDateParts(date: Date): { year: string; month: string; day: string; hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    year: lookup.year || '',
    month: lookup.month || '',
    day: lookup.day || '',
    hour: lookup.hour || '00',
    minute: lookup.minute || '00',
  }
}
