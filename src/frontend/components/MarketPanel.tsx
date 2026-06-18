import React, { useMemo, useState } from 'react'
import type {
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

type MarketView = 'overview' | 'watchlist' | 'sectors' | 'narratives' | 'technicals' | 'alerts' | 'reports'

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

  const quotesBySymbol = useMemo(() => {
    return new Map((overview?.quotes || []).map((quote) => [quote.symbol, quote]))
  }, [overview?.quotes])

  const selectedTechnical = useMemo(() => {
    const symbol = selectedSymbol || overview?.quotes[0]?.symbol
    return (overview?.technicals || []).find((item) => item.symbol === symbol) || overview?.technicals[0] || null
  }, [overview?.quotes, overview?.technicals, selectedSymbol])

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
          <p>Preparing mock quotes, sectors, narratives, and alerts.</p>
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
                setSelectedSymbol(symbol)
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
                setSelectedSymbol(symbol)
                setActiveView('technicals')
              }}
            />
          ) : activeView === 'sectors' ? (
            <SectorsView sectors={overview.sectors} quotesBySymbol={quotesBySymbol} />
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
              quotes={overview.quotes}
              technicals={overview.technicals}
              selectedTechnical={selectedTechnical}
              selectedSymbol={selectedTechnical?.symbol || selectedSymbol || ''}
              onSelectSymbol={setSelectedSymbol}
            />
          ) : activeView === 'reports' ? (
            <ReportsView
              reports={reports}
              mutating={mutating}
              onRunReport={(kind) => void onRunReport(kind)}
            />
          ) : (
            <AlertsView alerts={overview.alerts} />
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
  { id: 'overview', label: 'Overview' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'sectors', label: 'Sectors' },
  { id: 'narratives', label: 'Narratives' },
  { id: 'technicals', label: 'Technicals' },
  { id: 'reports', label: 'Reports' },
  { id: 'alerts', label: 'Alerts' },
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
          <p>Mock A-share index snapshots with delayed research-only data.</p>
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
          <h3>Hot Sectors</h3>
          <p>Strength, breadth, and persistence ranking.</p>
        </div>
      </div>
      <div className="market-sector-mini-list">
        {overview.sectors.slice(0, 5).map((sector) => (
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

const SectorsView: React.FC<{
  sectors: SectorHeat[]
  quotesBySymbol: Map<string, QuoteSnapshot>
}> = ({ sectors, quotesBySymbol }) => (
  <div className="market-sector-grid">
    {sectors.map((sector) => (
      <section className="market-card" key={sector.sectorId}>
        <div className="market-card-header">
          <div>
            <h3>{sector.sectorName}</h3>
            <p>{sector.risingCount} rising · {sector.fallingCount} falling · {sector.limitUpCount} limit-up</p>
          </div>
          <Change value={sector.changePct} />
        </div>
        <div className="market-score-grid">
          <ScoreBar label="Strength" value={sector.strengthScore} />
          <ScoreBar label="Diffusion" value={sector.diffusionScore} />
          <ScoreBar label="Persistence" value={sector.persistenceScore} />
          <ScoreBar label="Risk" value={sector.riskScore} tone="risk" />
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
          <p>Mock authorized tracking feed. Treat as sentiment, not evidence.</p>
        </div>
      </div>
      <div className="market-post-list">
        {posts.map((post) => (
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
  onSelectSymbol: (symbol: string) => void
}> = ({ quotes, technicals, selectedTechnical, selectedSymbol, onSelectSymbol }) => (
  <div className="market-two-column">
    <section className="market-card">
      <div className="market-card-header">
        <div>
          <h3>Symbols</h3>
          <p>Select a watchlist symbol to inspect deterministic technical signals.</p>
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
            <span>{quote.symbol}</span>
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
              <h3>{selectedTechnical.symbol} Technicals</h3>
              <p>{selectedTechnical.summary}</p>
            </div>
            <span className="market-trend-chip" data-trend={selectedTechnical.trend}>
              {selectedTechnical.trend}
            </span>
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
          <Sparkline bars={selectedTechnical.bars} />
          <div className="market-macd-box">
            <span>MACD · {selectedTechnical.timeframe}</span>
            <strong>DIF {selectedTechnical.macd.dif} · DEA {selectedTechnical.macd.dea} · HIST {selectedTechnical.macd.hist}</strong>
          </div>
          <div className="market-note-list">
            {selectedTechnical.riskNotes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        </>
      ) : technicals.length === 0 ? (
        <div className="scheduled-empty">
          <h4>No Technicals</h4>
          <p>Add symbols to the watchlist to generate technical signals.</p>
        </div>
      ) : null}
    </section>
  </div>
)

const AlertsView: React.FC<{ alerts: MarketAlert[] }> = ({ alerts }) => (
  <section className="market-card">
    <div className="market-card-header">
      <div>
        <h3>Alert Timeline</h3>
        <p>Every alert keeps the triggering rule and source references.</p>
      </div>
    </div>
    <AlertList alerts={alerts} />
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
      <strong>{quote.symbol}</strong>
      <span>{formatTime(quote.ts)}</span>
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
      <strong>{quote.symbol}</strong>
      <span>Vol {quote.volumeRatio}x · Turn {quote.turnoverRate}%</span>
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

const Sparkline: React.FC<{ bars: MarketBar[] }> = ({ bars }) => {
  const points = useMemo(() => buildSparklinePoints(bars), [bars])
  const last = bars[bars.length - 1]
  const first = bars[0]

  return (
    <div className="market-sparkline-box">
      <div className="market-sparkline-header">
        <span>Last {bars.length} daily bars</span>
        {first && last && (
          <strong>
            {formatPrice(first.close)} → {formatPrice(last.close)}
          </strong>
        )}
      </div>
      <svg className="market-sparkline" viewBox="0 0 320 120" role="img" aria-label="Recent close price trend">
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function buildSparklinePoints(bars: MarketBar[]): string {
  if (bars.length === 0) {
    return ''
  }
  const closes = bars.map((bar) => bar.close)
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const range = max - min || 1
  return closes.map((close, index) => {
    const x = bars.length === 1 ? 160 : (index / (bars.length - 1)) * 312 + 4
    const y = 112 - ((close - min) / range) * 104
    return `${roundForSvg(x)},${roundForSvg(y)}`
  }).join(' ')
}

function roundForSvg(value: number): number {
  return Math.round(value * 10) / 10
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

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
