import crypto from 'node:crypto'
import type {
  InfluencerPost,
  MarketAlert,
  MarketBar,
  MarketNarrative,
  MarketOverview,
  MarketSourceRef,
  MarketStatus,
  MarketSymbol,
  QuoteSnapshot,
  SectorHeat,
  TechnicalSignal,
} from './types.js'
import type { createMarketStore } from './store.js'
import { normalizeSymbol, normalizeSymbols } from './store.js'
import { buildTechnicalSignalFromBars } from './indicators.js'
import type { MarketProvider } from './providers/types.js'

type MarketStore = ReturnType<typeof createMarketStore>

export function createMarketService(options: {
  store: MarketStore
  provider: MarketProvider
  enabled: boolean
}) {
  const { store, provider, enabled } = options

  async function getStatus(): Promise<MarketStatus> {
    const now = new Date()
    const providerStatus = await provider.getStatus()
    return {
      enabled,
      provider: providerStatus.provider,
      providerLabel: providerStatus.providerLabel,
      market: 'A_SHARE',
      phase: computeMarketPhase(now),
      tradingDay: formatShanghaiDate(now),
      now: now.toISOString(),
      quoteDelayMs: providerStatus.quoteDelayMs,
      dataMode: providerStatus.dataMode,
      complianceMode: 'research_only',
    }
  }

  async function getOverview(): Promise<MarketOverview> {
    const [status, watchlist, providerSymbols] = await Promise.all([
      getStatus(),
      store.getWatchlist(),
      provider.getSymbols(),
    ])
    const watchlistSymbols = normalizeSymbols(watchlist.symbols)
    const [indices, quotes, sectors, narratives, influencerPosts] = await Promise.all([
      provider.getQuotes(['000001.SH', '399001.SZ', '399006.SZ']),
      provider.getQuotes(watchlistSymbols),
      provider.getHotSectors(),
      provider.getNarratives(),
      provider.getInfluencerPosts(),
    ])
    const alerts = buildAlerts(quotes, sectors, narratives, influencerPosts, providerSymbols)
    const technicals = await Promise.all(
      quotes.slice(0, 6).map((quote) => buildTechnicalSignal(quote.symbol))
    )

    return {
      status,
      indices,
      watchlist,
      quotes,
      sectors,
      narratives,
      influencerPosts,
      alerts,
      technicals,
    }
  }

  async function getQuotes(symbols: string[]): Promise<QuoteSnapshot[]> {
    const normalized = normalizeSymbols(symbols)
    const targetSymbols = normalized.length > 0
      ? normalized
      : (await store.getWatchlist()).symbols
    return provider.getQuotes(targetSymbols)
  }

  async function getWatchlist() {
    return store.getWatchlist()
  }

  async function addWatchlistSymbols(symbols: string[]) {
    const normalized = normalizeSymbols(symbols)
    if (normalized.length === 0) {
      throw new Error('symbols are required')
    }
    return store.addSymbols(normalized)
  }

  async function removeWatchlistSymbol(symbol: string) {
    const normalized = normalizeSymbol(symbol)
    if (!normalized) {
      throw new Error('symbol is required')
    }
    return store.removeSymbol(normalized)
  }

  async function replaceWatchlistSymbols(symbols: string[]) {
    return store.replaceSymbols(symbols)
  }

  async function getHotSectors() {
    return provider.getHotSectors()
  }

  async function getTechnicals(symbol: string) {
    const normalized = normalizeSymbol(symbol)
    if (!normalized) {
      throw new Error('symbol is required')
    }
    return buildTechnicalSignal(normalized)
  }

  async function getBars(symbol: string, timeframe: MarketBar['timeframe'] = '1d', limit = 90) {
    const normalized = normalizeSymbol(symbol)
    if (!normalized) {
      throw new Error('symbol is required')
    }
    return provider.getBars(normalized, timeframe, limit)
  }

  async function getNarratives() {
    return provider.getNarratives()
  }

  async function analyzeNarrative(content: string): Promise<MarketNarrative> {
    const trimmed = content.trim()
    if (!trimmed) {
      throw new Error('content is required')
    }
    const [symbols, sectors] = await Promise.all([
      provider.getSymbols(),
      provider.getHotSectors(),
    ])
    const fetchedAt = new Date().toISOString()
    const matchedSymbols = symbols
      .filter((symbol) => trimmed.includes(symbol.symbol) || trimmed.includes(symbol.name))
      .map((symbol) => symbol.symbol)
    const matchedSectorIds = sectors
      .filter((sector) => {
        return trimmed.includes(sector.sectorName) ||
          sector.leaderSymbols.some((symbol) => matchedSymbols.includes(symbol))
      })
      .map((sector) => sector.sectorId)
    const sectorIdsFromSymbols = symbols
      .filter((symbol) => matchedSymbols.includes(symbol.symbol))
      .flatMap((symbol) => symbol.sectorIds || [])
    const normalizedSectorIds = Array.from(new Set([
      ...matchedSectorIds,
      ...sectorIdsFromSymbols,
    ]))
    const contentHash = crypto.createHash('sha256').update(trimmed).digest('hex')
    return {
      id: `user-note-${contentHash.slice(0, 12)}`,
      title: '用户粘贴小作文分析',
      content: trimmed,
      contentHash,
      source: buildUserSource(fetchedAt),
      fetchedAt,
      symbols: matchedSymbols,
      sectors: normalizedSectorIds,
      category: 'user_note',
      confidenceScore: clampScore(48 + matchedSymbols.length * 8),
      catalystScore: clampScore(42 + normalizedSectorIds.length * 10),
      riskScore: normalizedSectorIds.length > 0 ? 54 : 68,
      aiSummary: matchedSymbols.length > 0
        ? `识别到 ${matchedSymbols.length} 个相关标的。当前基于文本、行情 provider 和 mock/授权数据做结构化归纳，需继续用公告/新闻核验。`
        : '未识别到明确股票代码或样本库内公司名称，建议补充来源和涉及标的后再判断。',
      evidenceIds: [],
      contradictionIds: [],
    }
  }

  async function getInfluencerPosts() {
    return provider.getInfluencerPosts()
  }

  async function getAlerts() {
    const overview = await getOverview()
    return overview.alerts
  }

  async function buildTechnicalSignal(symbol: string): Promise<TechnicalSignal> {
    const normalized = normalizeSymbol(symbol)
    const bars = await provider.getBars(normalized, '1d', 90)
    return buildTechnicalSignalFromBars(normalized, bars)
  }

  return {
    getStatus,
    getOverview,
    getQuotes,
    getWatchlist,
    addWatchlistSymbols,
    removeWatchlistSymbol,
    replaceWatchlistSymbols,
    getHotSectors,
    getTechnicals,
    getBars,
    getNarratives,
    analyzeNarrative,
    getInfluencerPosts,
    getAlerts,
  }
}

function buildAlerts(
  quotes: QuoteSnapshot[],
  sectors: SectorHeat[],
  narratives: MarketNarrative[],
  influencerPosts: InfluencerPost[],
  symbols: MarketSymbol[]
): MarketAlert[] {
  const now = new Date()
  const alerts: MarketAlert[] = []
  const hotSector = sectors[0]
  const strongQuote = [...quotes].sort((left, right) => right.changePct - left.changePct)[0]
  const highVolume = [...quotes].sort((left, right) => right.volumeRatio - left.volumeRatio)[0]
  const topNarrative = narratives[0]
  const topPost = influencerPosts[0]

  if (hotSector) {
    alerts.push({
      id: `sector-${hotSector.sectorId}-${formatShanghaiDate(now)}`,
      level: hotSector.strengthScore >= 75 ? 'urgent' : 'watch',
      title: `${hotSector.sectorName} 板块强度靠前`,
      message: `强度 ${hotSector.strengthScore}，上涨家数 ${hotSector.risingCount}/${hotSector.risingCount + hotSector.fallingCount}，关注龙头和扩散是否延续。`,
      symbols: hotSector.leaderSymbols,
      sectors: [hotSector.sectorId],
      triggeredAt: now.toISOString(),
      ruleId: 'sector-strength-top',
      sourceEventIds: [hotSector.sectorId],
      status: 'new',
      aiRationale: '板块热度只代表资金关注度，需结合公告、成交额和个股位置判断持续性。',
    })
  }

  if (strongQuote && strongQuote.changePct >= 1) {
    alerts.push({
      id: `quote-move-${strongQuote.symbol}-${Math.floor(now.getTime() / 300_000)}`,
      level: strongQuote.changePct >= 3 ? 'urgent' : 'watch',
      title: `${getSymbolName(strongQuote.symbol, symbols)} 盘中异动`,
      message: `${strongQuote.symbol} 涨幅 ${formatPct(strongQuote.changePct)}，量比 ${strongQuote.volumeRatio}，需要确认是否与板块或消息共振。`,
      symbols: [strongQuote.symbol],
      sectors: getSymbolSectors(strongQuote.symbol, symbols),
      triggeredAt: now.toISOString(),
      ruleId: 'watchlist-price-move',
      sourceEventIds: [strongQuote.symbol],
      status: 'new',
    })
  }

  if (highVolume && highVolume.volumeRatio >= 1.8 && highVolume.symbol !== strongQuote?.symbol) {
    alerts.push({
      id: `volume-${highVolume.symbol}-${Math.floor(now.getTime() / 300_000)}`,
      level: 'watch',
      title: `${getSymbolName(highVolume.symbol, symbols)} 放量`,
      message: `${highVolume.symbol} 量比 ${highVolume.volumeRatio}，成交额 ${formatAmount(highVolume.amount)}，观察突破或冲高回落。`,
      symbols: [highVolume.symbol],
      sectors: getSymbolSectors(highVolume.symbol, symbols),
      triggeredAt: now.toISOString(),
      ruleId: 'watchlist-volume-ratio',
      sourceEventIds: [highVolume.symbol],
      status: 'new',
    })
  }

  if (topNarrative) {
    alerts.push({
      id: `narrative-${topNarrative.id}`,
      level: 'info',
      title: '小作文热度更新',
      message: `${topNarrative.title}：${topNarrative.aiSummary}`,
      symbols: topNarrative.symbols,
      sectors: topNarrative.sectors,
      triggeredAt: topNarrative.fetchedAt,
      ruleId: 'narrative-hot',
      sourceEventIds: [topNarrative.id],
      status: 'new',
    })
  }

  if (topPost) {
    alerts.push({
      id: `influencer-${topPost.id}`,
      level: 'info',
      title: `${topPost.authorName} 更新观点`,
      message: topPost.title || topPost.content,
      symbols: topPost.symbols,
      sectors: topPost.sectors,
      triggeredAt: topPost.fetchedAt,
      ruleId: 'influencer-watch',
      sourceEventIds: [topPost.id],
      status: 'new',
    })
  }

  return alerts
}

function computeMarketPhase(date: Date): MarketStatus['phase'] {
  const parts = getShanghaiParts(date)
  if (parts.weekday === 0 || parts.weekday === 6) {
    return 'closed'
  }
  const minutes = parts.hour * 60 + parts.minute
  if (minutes < 9 * 60 + 15) {
    return 'pre_market'
  }
  if (minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30) {
    return 'open'
  }
  if (minutes > 11 * 60 + 30 && minutes < 13 * 60) {
    return 'lunch_break'
  }
  if (minutes >= 13 * 60 && minutes <= 15 * 60) {
    return 'open'
  }
  if (minutes > 15 * 60 && minutes <= 18 * 60) {
    return 'closed'
  }
  return 'after_hours'
}

function getShanghaiParts(date: Date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const values = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  )
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  return {
    weekday: weekdayMap[values.weekday || 'Sun'] ?? 0,
    hour: Number(values.hour || 0),
    minute: Number(values.minute || 0),
  }
}

function formatShanghaiDate(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(date)
}

function buildUserSource(fetchedAt: string): MarketSourceRef {
  return {
    sourceName: 'User Note',
    provider: 'user',
    licenseType: 'user_authorized',
    fetchedAt,
  }
}

function getSymbolName(symbol: string, symbols: MarketSymbol[]): string {
  return symbols.find((item) => item.symbol === symbol)?.name || symbol
}

function getSymbolSectors(symbol: string, symbols: MarketSymbol[]): string[] {
  return symbols.find((item) => item.symbol === symbol)?.sectorIds || []
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function formatPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${round(value, 2)}%`
}

function formatAmount(value: number): string {
  if (value >= 100_000_000) {
    return `${round(value / 100_000_000, 2)} 亿`
  }
  if (value >= 10_000) {
    return `${round(value / 10_000, 1)} 万`
  }
  return String(value)
}
