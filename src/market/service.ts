import crypto from 'node:crypto'
import type {
  DragonTigerBrokerTrade,
  DragonTigerDailyStock,
  DragonTigerInstitutionSeat,
  DragonTigerSeat,
  DragonTigerStock,
  HotStockSignal,
  HotStockSourceStatus,
  InfluencerPost,
  MarketAlert,
  MarketBar,
  MarketNarrative,
  MarketOverview,
  MarketReport,
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
type HotStockCollector = {
  getHotStocks(symbols: MarketSymbol[]): Promise<{
    hotStocks: HotStockSignal[]
    status: HotStockSourceStatus
  }>
}

export function createMarketService(options: {
  store: MarketStore
  provider: MarketProvider
  enabled: boolean
  hotStockCollector?: HotStockCollector
}) {
  const { store, provider, enabled, hotStockCollector } = options

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
    const [status, watchlist] = await Promise.all([
      getStatus(),
      store.getWatchlist(),
    ])
    const indexSymbols = ['000001.SH', '399001.SZ', '399006.SZ']
    const watchlistSymbols = normalizeSymbols(watchlist.symbols)
    let allQuotes: QuoteSnapshot[] = []
    let providerAlerts: MarketAlert[] = []
    try {
      allQuotes = await provider.getQuotes(normalizeSymbols([...indexSymbols, ...watchlistSymbols]))
    } catch (error) {
      providerAlerts = [buildProviderErrorAlert(error)]
    }
    const indices = selectQuotesInOrder(allQuotes, indexSymbols)
    const quotes = selectQuotesInOrder(allQuotes, watchlistSymbols)

    return {
      status,
      indices,
      watchlist,
      quotes,
      sectors: [],
      narratives: [],
      influencerPosts: [],
      alerts: [
        ...providerAlerts,
        ...buildAlerts(quotes, [], [], [], []),
      ],
      technicals: [],
      hotStocks: [],
      hotStockQuotes: [],
      hotStockStatus: buildDeferredHotStockStatus(),
      dragonTigerStocks: [],
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

  async function getHotStocks() {
    const symbols = await provider.getSymbols()
    const hotStockResult = await getHotStockResult(symbols)
    const hotStockQuotes = await getHotStockQuotes(hotStockResult.hotStocks, [])
    return {
      ...hotStockResult,
      quotes: hotStockQuotes,
    }
  }

  async function getDragonTigerStocks(): Promise<DragonTigerStock[]> {
    return provider.getDragonTigerStocks()
  }

  async function getDragonTigerDailyStocks(): Promise<DragonTigerDailyStock[]> {
    return provider.getDragonTigerDailyStocks()
  }

  async function getDragonTigerSeats(symbol: string, tradeDate?: string): Promise<DragonTigerSeat[]> {
    const normalized = normalizeSymbol(symbol)
    if (!normalized) {
      throw new Error('symbol is required')
    }
    return provider.getDragonTigerSeats(normalized, tradeDate)
  }

  async function getDragonTigerInstitutions(): Promise<DragonTigerInstitutionSeat[]> {
    return provider.getDragonTigerInstitutions()
  }

  async function getDragonTigerBrokerTrades(brokerName: string, tradeDate?: string): Promise<DragonTigerBrokerTrade[]> {
    const normalizedBrokerName = brokerName.trim()
    if (!normalizedBrokerName) {
      throw new Error('brokerName is required')
    }
    return provider.getDragonTigerBrokerTrades(normalizedBrokerName, tradeDate)
  }

  async function getTechnicals(symbol: string, timeframe: MarketBar['timeframe'] = '1d') {
    const normalized = normalizeSymbol(symbol)
    if (!normalized) {
      throw new Error('symbol is required')
    }
    return buildTechnicalSignal(normalized, timeframe)
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
        ? `识别到 ${matchedSymbols.length} 个相关标的。当前基于文本和已配置行情/授权数据做结构化归纳，需继续用公告/新闻核验。`
        : '未识别到明确股票代码或样本库内公司名称，建议补充来源和涉及标的后再判断。',
      evidenceIds: [],
      contradictionIds: [],
    }
  }

  async function getInfluencerPosts() {
    return provider.getInfluencerPosts()
  }

  async function getAlerts() {
    const [watchlist, providerSymbols] = await Promise.all([
      store.getWatchlist(),
      provider.getSymbols(),
    ])
    const watchlistSymbols = normalizeSymbols(watchlist.symbols)
    const [quotes, sectors, narratives, influencerPosts] = await Promise.all([
      provider.getQuotes(watchlistSymbols),
      provider.getHotSectors(),
      provider.getNarratives(),
      provider.getInfluencerPosts(),
    ])
    return buildAlerts(quotes, sectors, narratives, influencerPosts, providerSymbols)
  }

  async function runReport(kind: MarketReport['kind'] = 'intraday'): Promise<MarketReport> {
    const overview = await getReportOverview()
    return buildMarketReport(kind, overview)
  }

  async function getReportOverview(): Promise<MarketOverview> {
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
      hotStocks: [],
      hotStockQuotes: [],
      hotStockStatus: buildDeferredHotStockStatus(),
      dragonTigerStocks: [],
    }
  }

  async function buildTechnicalSignal(symbol: string, timeframe: MarketBar['timeframe'] = '1d'): Promise<TechnicalSignal> {
    const normalized = normalizeSymbol(symbol)
    const bars = await provider.getBars(normalized, timeframe, getTechnicalBarLimit(timeframe))
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
    getHotStocks,
    getDragonTigerStocks,
    getDragonTigerDailyStocks,
    getDragonTigerSeats,
    getDragonTigerInstitutions,
    getDragonTigerBrokerTrades,
    getTechnicals,
    getBars,
    getNarratives,
    analyzeNarrative,
    getInfluencerPosts,
    getAlerts,
    runReport,
  }

  async function getHotStockResult(symbols: MarketSymbol[]): Promise<{
    hotStocks: HotStockSignal[]
    status: HotStockSourceStatus
  }> {
    if (!hotStockCollector) {
      return {
        hotStocks: [],
        status: {
          enabled: false,
          provider: 'none',
          providerLabel: '外部热门股票源',
          mode: 'disabled',
          sourceUrls: [],
          message: '外部热门股票采集未配置。',
        },
      }
    }
    return hotStockCollector.getHotStocks(symbols)
  }

  async function getHotStockQuotes(hotStocks: HotStockSignal[], existingQuotes: QuoteSnapshot[]): Promise<QuoteSnapshot[]> {
    return getExternalStockQuotes(hotStocks.map((item) => item.symbol), existingQuotes)
  }

  async function getExternalStockQuotes(targetSymbols: string[], existingQuotes: QuoteSnapshot[]): Promise<QuoteSnapshot[]> {
    const existingSymbols = new Set(existingQuotes.map((quote) => quote.symbol))
    const symbols = normalizeSymbols(targetSymbols)
      .filter((symbol) => !existingSymbols.has(symbol))
    if (symbols.length === 0) {
      return []
    }
    try {
      return await provider.getQuotes(symbols)
    } catch {
      return []
    }
  }
}

function getTechnicalBarLimit(timeframe: MarketBar['timeframe']): number {
  if (timeframe === '1m') {
    return 240
  }
  if (timeframe === '5m') {
    return 180
  }
  if (timeframe === '15m') {
    return 180
  }
  if (timeframe === '30m') {
    return 120
  }
  if (timeframe === '60m') {
    return 120
  }
  if (timeframe === '1y') {
    return 40
  }
  if (timeframe === '1mo') {
    return 120
  }
  return 90
}

function buildMarketReport(kind: MarketReport['kind'], overview: MarketOverview): MarketReport {
  const generatedAt = new Date().toISOString()
  const topSector = overview.sectors[0]
  const strongQuotes = [...overview.quotes]
    .sort((left, right) => right.changePct - left.changePct)
    .slice(0, 3)
  const weakQuotes = [...overview.quotes]
    .sort((left, right) => left.changePct - right.changePct)
    .slice(0, 2)
  const urgentAlerts = overview.alerts.filter((alert) => alert.level === 'urgent')
  const watchAlerts = overview.alerts.filter((alert) => alert.level === 'watch')
  const hotNarratives = [...overview.narratives]
    .sort((left, right) => right.catalystScore - left.catalystScore)
    .slice(0, 3)
  const technicals = [...overview.technicals]
    .sort((left, right) => trendRank(right.trend) - trendRank(left.trend))
    .slice(0, 4)
  const topStrongQuote = strongQuotes[0]
  const quoteLabels = new Map(
    [...overview.indices, ...overview.quotes].map((quote) => [quote.symbol, formatQuoteLabel(quote)])
  )

  const indexBrief = overview.indices.map((quote) => {
    return `${formatQuoteLabel(quote)} ${formatPct(quote.changePct)}，成交额 ${formatAmount(quote.amount)}。`
  })
  const sectorBrief = overview.sectors.slice(0, 4).map((sector, index) => {
    return `${index + 1}. ${sector.sectorName} 强度 ${sector.strengthScore}，涨跌幅 ${formatPct(sector.changePct)}，扩散 ${sector.diffusionScore}，龙头 ${sector.leaderSymbols.join(', ')}。`
  })
  const watchlistBrief = [
    ...strongQuotes.map((quote) => `${formatQuoteLabel(quote)} 领涨 ${formatPct(quote.changePct)}，量比 ${quote.volumeRatio}，成交额 ${formatAmount(quote.amount)}。`),
    ...weakQuotes.map((quote) => `${formatQuoteLabel(quote)} 偏弱 ${formatPct(quote.changePct)}，先观察是否跌破技术支撑。`),
  ]
  const narrativeBrief = hotNarratives.map((narrative) => {
    return `${narrative.title}：催化 ${narrative.catalystScore}，可信度 ${narrative.confidenceScore}，相关标的 ${narrative.symbols.join(', ') || '未识别'}。`
  })
  const technicalBrief = technicals.map((technical) => {
    return `${quoteLabels.get(technical.symbol) || technical.symbol} ${technical.trend}，RSI6 ${technical.rsi6}，支撑 ${technical.support}，压力 ${technical.resistance}，${technical.volumeSignal}。`
  })
  const alertBrief = overview.alerts.slice(0, 6).map((alert) => {
    return `[${alert.level}] ${alert.title}：${alert.message}`
  })
  const riskNotes = [
    '本报告只用于盯盘和投研辅助，不构成投资建议或交易指令。',
    '论坛、大 V 和小作文内容需要用公告、新闻和成交数据交叉验证。',
    '低频或延迟数据不适合做高实时性交易决策。',
    ...(topSector && topSector.riskScore >= 60 ? [`${topSector.sectorName} 风险分 ${topSector.riskScore}，注意一致性过高后的分歧。`] : []),
    ...(urgentAlerts.length > 0 ? [`存在 ${urgentAlerts.length} 条 urgent 告警，需优先核查触发依据。`] : []),
  ]
  const followUps = [
    topSector ? `确认 ${topSector.sectorName} 是否有公告、新闻或成交额继续配合。` : '确认今日是否有明确主线板块。',
    topStrongQuote ? `跟踪 ${formatQuoteLabel(topStrongQuote)} 是否能维持强势并带动板块扩散。` : '跟踪自选股是否出现放量异动。',
    watchAlerts.length > 0 ? `复核 ${watchAlerts.length} 条 watch 告警是否为有效信号或误报。` : '补充更细的告警规则以降低漏报。',
    '盘后记录信号触发后的表现，用于后续回测和规则调参。',
  ]

  const titleKind = kind === 'close'
    ? '盘后复盘'
    : kind === 'watchlist'
      ? '自选股报告'
      : '盘中盯盘报告'
  const summary = [
    topSector ? `当前主线偏向 ${topSector.sectorName}，强度 ${topSector.strengthScore}。` : '当前主线不明确。',
    topStrongQuote ? `自选股中 ${formatQuoteLabel(topStrongQuote)} 表现最强。` : '自选股暂无明显领涨。',
    urgentAlerts.length > 0 ? `有 ${urgentAlerts.length} 条 urgent 告警。` : '暂无 urgent 告警。',
  ].join(' ')

  return {
    id: `market-report-${kind}-${overview.status.tradingDay}-${Math.floor(Date.now() / 1000)}`,
    kind,
    generatedAt,
    tradingDay: overview.status.tradingDay,
    provider: overview.status.provider,
    title: `${overview.status.tradingDay} ${titleKind}`,
    summary,
    indexBrief,
    sectorBrief,
    watchlistBrief,
    narrativeBrief,
    technicalBrief,
    alertBrief,
    riskNotes,
    followUps,
    sourceRefs: collectSourceRefs(overview),
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
    const quoteLabel = formatQuoteLabel(strongQuote, symbols)
    alerts.push({
      id: `quote-move-${strongQuote.symbol}-${Math.floor(now.getTime() / 300_000)}`,
      level: strongQuote.changePct >= 3 ? 'urgent' : 'watch',
      title: `${quoteLabel} 盘中异动`,
      message: `${quoteLabel} 涨幅 ${formatPct(strongQuote.changePct)}，量比 ${strongQuote.volumeRatio}，需要确认是否与板块或消息共振。`,
      symbols: [strongQuote.symbol],
      sectors: getSymbolSectors(strongQuote.symbol, symbols),
      triggeredAt: now.toISOString(),
      ruleId: 'watchlist-price-move',
      sourceEventIds: [strongQuote.symbol],
      status: 'new',
    })
  }

  if (highVolume && highVolume.volumeRatio >= 1.8 && highVolume.symbol !== strongQuote?.symbol) {
    const quoteLabel = formatQuoteLabel(highVolume, symbols)
    alerts.push({
      id: `volume-${highVolume.symbol}-${Math.floor(now.getTime() / 300_000)}`,
      level: 'watch',
      title: `${quoteLabel} 放量`,
      message: `${quoteLabel} 量比 ${highVolume.volumeRatio}，成交额 ${formatAmount(highVolume.amount)}，观察突破或冲高回落。`,
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

function formatQuoteLabel(quote: QuoteSnapshot, symbols: MarketSymbol[] = []): string {
  const name = quote.name || getSymbolName(quote.symbol, symbols)
  return name && name !== quote.symbol ? `${name}（${quote.symbol}）` : quote.symbol
}

function selectQuotesInOrder(quotes: QuoteSnapshot[], symbols: string[]): QuoteSnapshot[] {
  const quoteBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]))
  return normalizeSymbols(symbols)
    .map((symbol) => quoteBySymbol.get(symbol))
    .filter(Boolean) as QuoteSnapshot[]
}

function buildProviderErrorAlert(error: unknown): MarketAlert {
  const message = error instanceof Error ? error.message : String(error)
  const triggeredAt = new Date().toISOString()
  return {
    id: `market-provider-error-${Math.floor(Date.now() / 60_000)}`,
    level: 'watch',
    title: '行情数据加载失败',
    message: `当前行情 provider 返回失败：${message}`,
    symbols: [],
    sectors: [],
    triggeredAt,
    ruleId: 'market-provider-error',
    sourceEventIds: ['market-provider'],
    status: 'new',
    aiRationale: '这不是 mock 数据；请检查 AKShare HTTP bridge 是否启动、网络是否可达，或稍后重试。',
  }
}

function getSymbolSectors(symbol: string, symbols: MarketSymbol[]): string[] {
  return symbols.find((item) => item.symbol === symbol)?.sectorIds || []
}

function trendRank(trend: TechnicalSignal['trend']): number {
  if (trend === 'uptrend') return 3
  if (trend === 'sideways') return 2
  return 1
}

function collectSourceRefs(overview: MarketOverview): MarketSourceRef[] {
  const refs = [
    ...overview.indices.map((quote) => quote.source),
    ...overview.quotes.map((quote) => quote.source),
    ...overview.narratives.map((narrative) => narrative.source),
    ...overview.technicals.flatMap((technical) => technical.bars.slice(-1).map((bar) => bar.source)),
  ]
  const seen = new Set<string>()
  return refs.filter((ref) => {
    const key = `${ref.provider}:${ref.sourceName}:${ref.fetchedAt}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  }).slice(0, 20)
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

function buildDeferredHotStockStatus(): HotStockSourceStatus {
  return {
    enabled: false,
    provider: 'deferred',
    providerLabel: '外部热门股票源',
    mode: 'disabled',
    sourceUrls: [],
    message: '进入“热门股票”页后再加载。',
  }
}
