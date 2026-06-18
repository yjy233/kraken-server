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

type MarketStore = ReturnType<typeof createMarketStore>

const MARKET_PROVIDER = 'mock'
const MARKET_PROVIDER_LABEL = 'Mock A-share provider'
const QUOTE_DELAY_MS = 15_000

const SYMBOLS: MarketSymbol[] = [
  { symbol: '000001.SH', exchange: 'SSE', name: '上证指数', assetType: 'index', currency: 'CNY' },
  { symbol: '399001.SZ', exchange: 'SZSE', name: '深证成指', assetType: 'index', currency: 'CNY' },
  { symbol: '399006.SZ', exchange: 'SZSE', name: '创业板指', assetType: 'index', currency: 'CNY' },
  { symbol: '600519.SH', exchange: 'SSE', name: '贵州茅台', assetType: 'stock', currency: 'CNY', lotSize: 100, sectorIds: ['consumption'] },
  { symbol: '300750.SZ', exchange: 'SZSE', name: '宁德时代', assetType: 'stock', currency: 'CNY', lotSize: 100, sectorIds: ['new-energy', 'lithium'] },
  { symbol: '002594.SZ', exchange: 'SZSE', name: '比亚迪', assetType: 'stock', currency: 'CNY', lotSize: 100, sectorIds: ['new-energy', 'auto'] },
  { symbol: '601318.SH', exchange: 'SSE', name: '中国平安', assetType: 'stock', currency: 'CNY', lotSize: 100, sectorIds: ['finance'] },
  { symbol: '000001.SZ', exchange: 'SZSE', name: '平安银行', assetType: 'stock', currency: 'CNY', lotSize: 100, sectorIds: ['finance'] },
  { symbol: '603986.SH', exchange: 'SSE', name: '兆易创新', assetType: 'stock', currency: 'CNY', lotSize: 100, sectorIds: ['semiconductor', 'ai-chip'] },
  { symbol: '688981.SH', exchange: 'SSE', name: '中芯国际', assetType: 'stock', currency: 'CNY', lotSize: 100, sectorIds: ['semiconductor'] },
  { symbol: '300308.SZ', exchange: 'SZSE', name: '中际旭创', assetType: 'stock', currency: 'CNY', lotSize: 100, sectorIds: ['ai-chip', 'optical'] },
  { symbol: '002230.SZ', exchange: 'SZSE', name: '科大讯飞', assetType: 'stock', currency: 'CNY', lotSize: 100, sectorIds: ['ai-app'] },
  { symbol: '601012.SH', exchange: 'SSE', name: '隆基绿能', assetType: 'stock', currency: 'CNY', lotSize: 100, sectorIds: ['new-energy'] },
  { symbol: '300124.SZ', exchange: 'SZSE', name: '汇川技术', assetType: 'stock', currency: 'CNY', lotSize: 100, sectorIds: ['robotics', 'industrial'] },
  { symbol: '002050.SZ', exchange: 'SZSE', name: '三花智控', assetType: 'stock', currency: 'CNY', lotSize: 100, sectorIds: ['robotics', 'auto'] },
]

const BASE_PRICES: Record<string, number> = {
  '000001.SH': 3128.42,
  '399001.SZ': 9820.31,
  '399006.SZ': 1878.16,
  '600519.SH': 1532.2,
  '300750.SZ': 198.46,
  '002594.SZ': 224.18,
  '601318.SH': 47.52,
  '000001.SZ': 10.74,
  '603986.SH': 88.33,
  '688981.SH': 48.26,
  '300308.SZ': 152.7,
  '002230.SZ': 44.91,
  '601012.SH': 17.58,
  '300124.SZ': 62.35,
  '002050.SZ': 24.68,
}

const SECTORS = [
  { id: 'ai-chip', name: 'AI 算力', symbols: ['603986.SH', '300308.SZ', '688981.SH'] },
  { id: 'semiconductor', name: '半导体', symbols: ['603986.SH', '688981.SH'] },
  { id: 'new-energy', name: '新能源', symbols: ['300750.SZ', '002594.SZ', '601012.SH'] },
  { id: 'robotics', name: '机器人', symbols: ['300124.SZ', '002050.SZ'] },
  { id: 'finance', name: '大金融', symbols: ['601318.SH', '000001.SZ'] },
  { id: 'consumption', name: '消费', symbols: ['600519.SH'] },
]

export function createMarketService(options: {
  store: MarketStore
  enabled: boolean
}) {
  const { store, enabled } = options

  async function getStatus(): Promise<MarketStatus> {
    const now = new Date()
    return {
      enabled,
      provider: MARKET_PROVIDER,
      providerLabel: MARKET_PROVIDER_LABEL,
      market: 'A_SHARE',
      phase: computeMarketPhase(now),
      tradingDay: formatShanghaiDate(now),
      now: now.toISOString(),
      quoteDelayMs: QUOTE_DELAY_MS,
      dataMode: 'mock',
      complianceMode: 'research_only',
    }
  }

  async function getOverview(): Promise<MarketOverview> {
    const [status, watchlist] = await Promise.all([
      getStatus(),
      store.getWatchlist(),
    ])
    const watchlistSymbols = normalizeSymbols(watchlist.symbols)
    const indices = buildQuotes(['000001.SH', '399001.SZ', '399006.SZ'])
    const quotes = buildQuotes(watchlistSymbols)
    const sectors = buildSectorHeat()
    const narratives = buildNarratives()
    const influencerPosts = buildInfluencerPosts()
    const alerts = buildAlerts(quotes, sectors, narratives, influencerPosts)
    const technicals = quotes.slice(0, 6).map((quote) => buildTechnicalSignal(quote.symbol))

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
    return buildQuotes(targetSymbols)
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
    return buildSectorHeat()
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
    if (timeframe !== '1d') {
      throw new Error('only 1d bars are available in mock provider')
    }
    return buildBars(normalized, timeframe, limit)
  }

  async function getNarratives() {
    return buildNarratives()
  }

  async function analyzeNarrative(content: string): Promise<MarketNarrative> {
    const trimmed = content.trim()
    if (!trimmed) {
      throw new Error('content is required')
    }
    const fetchedAt = new Date().toISOString()
    const symbols = SYMBOLS
      .filter((symbol) => trimmed.includes(symbol.symbol) || trimmed.includes(symbol.name))
      .map((symbol) => symbol.symbol)
    const sectors = SECTORS
      .filter((sector) => trimmed.includes(sector.name) || sector.symbols.some((symbol) => symbols.includes(symbol)))
      .map((sector) => sector.id)
    const contentHash = crypto.createHash('sha256').update(trimmed).digest('hex')
    return {
      id: `user-note-${contentHash.slice(0, 12)}`,
      title: '用户粘贴小作文分析',
      content: trimmed,
      contentHash,
      source: buildSource(fetchedAt, 'User Note'),
      fetchedAt,
      symbols,
      sectors,
      category: 'user_note',
      confidenceScore: clampScore(48 + symbols.length * 8),
      catalystScore: clampScore(42 + sectors.length * 10),
      riskScore: sectors.length > 0 ? 54 : 68,
      aiSummary: symbols.length > 0
        ? `识别到 ${symbols.length} 个相关标的。当前仅基于文本和 mock 行情做结构化归纳，需用公告/新闻继续核验。`
        : '未识别到明确股票代码或样本库内公司名称，建议补充来源和涉及标的后再判断。',
      evidenceIds: [],
      contradictionIds: [],
    }
  }

  async function getInfluencerPosts() {
    return buildInfluencerPosts()
  }

  async function getAlerts() {
    const overview = await getOverview()
    return overview.alerts
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

function buildBars(symbol: string, timeframe: MarketBar['timeframe'] = '1d', limit = 90): MarketBar[] {
  const normalized = normalizeSymbol(symbol)
  const basePrice = BASE_PRICES[normalized] || 20 + seededUnit(normalized) * 80
  const count = Math.max(30, Math.min(240, Math.round(limit)))
  const bars: MarketBar[] = []
  let close = basePrice * (0.88 + seededUnit(`${normalized}:bar-start`) * 0.2)
  const todayNoon = getShanghaiNoonUtc(new Date())

  for (let index = count - 1; index >= 0; index -= 1) {
    const dayIndex = count - 1 - index
    const ts = new Date(todayNoon.getTime() - index * 24 * 60 * 60 * 1000).toISOString()
    const drift = sectorBias(normalized) / 1000
    const wave = Math.sin(dayIndex / 7 + seededUnit(`${normalized}:wave`) * Math.PI * 2) * 0.014
    const noise = (seededUnit(`${normalized}:${dayIndex}:noise`) - 0.5) * 0.028
    const open = close * (1 + (seededUnit(`${normalized}:${dayIndex}:open`) - 0.5) * 0.012)
    close = Math.max(0.01, close * (1 + drift + wave + noise))
    const high = Math.max(open, close) * (1 + 0.006 + seededUnit(`${normalized}:${dayIndex}:high`) * 0.018)
    const low = Math.min(open, close) * (1 - 0.006 - seededUnit(`${normalized}:${dayIndex}:low`) * 0.018)
    const volume = Math.round((24_000_000 + seededUnit(`${normalized}:${dayIndex}:volume`) * 120_000_000) * (1 + Math.abs(close - open) / Math.max(1, open) * 8))
    bars.push({
      symbol: normalized,
      ts,
      timeframe,
      open: round(open, 2),
      high: round(high, 2),
      low: round(low, 2),
      close: round(close, 2),
      volume,
      amount: Math.round(volume * close),
      source: buildSource(ts),
    })
  }

  const latestQuote = buildQuote(normalized)
  const last = bars[bars.length - 1]
  if (last) {
    last.close = latestQuote.price
    last.high = round(Math.max(last.high, latestQuote.high, latestQuote.price), 2)
    last.low = round(Math.min(last.low, latestQuote.low, latestQuote.price), 2)
    last.volume = latestQuote.volume
    last.amount = latestQuote.amount
    last.ts = latestQuote.ts
    last.source = latestQuote.source
  }

  return bars
}

function buildQuotes(symbols: string[]): QuoteSnapshot[] {
  return normalizeSymbols(symbols).map(buildQuote)
}

function buildQuote(symbol: string): QuoteSnapshot {
  const normalized = normalizeSymbol(symbol)
  const now = new Date()
  const basePrice = BASE_PRICES[normalized] || 20 + seededUnit(normalized) * 80
  const minuteSlot = Math.floor(now.getTime() / 60_000)
  const wave = Math.sin(minuteSlot / 17 + seededUnit(normalized) * Math.PI * 2)
  const micro = Math.cos(minuteSlot / 7 + seededUnit(`${normalized}:micro`) * Math.PI * 2)
  const changePct = round((wave * 2.4 + micro * 0.7 + sectorBias(normalized)) / 100, 4) * 100
  const previousClose = round(basePrice, 2)
  const price = round(previousClose * (1 + changePct / 100), 2)
  const open = round(previousClose * (1 + (changePct * 0.22) / 100), 2)
  const high = round(Math.max(open, price) * (1 + (0.006 + seededUnit(`${normalized}:high`) * 0.012)), 2)
  const low = round(Math.min(open, price) * (1 - (0.006 + seededUnit(`${normalized}:low`) * 0.012)), 2)
  const volume = Math.round((30_000_000 + seededUnit(`${normalized}:volume`) * 180_000_000) * (1 + Math.abs(changePct) / 8))
  const amount = Math.round(volume * price)

  return {
    symbol: normalized,
    ts: now.toISOString(),
    price,
    change: round(price - previousClose, 2),
    changePct: round(changePct, 2),
    open,
    high,
    low,
    previousClose,
    volume,
    amount,
    turnoverRate: round(1.2 + seededUnit(`${normalized}:turnover`) * 7 + Math.abs(changePct) * 0.28, 2),
    volumeRatio: round(0.7 + seededUnit(`${normalized}:vr`) * 2.4 + Math.abs(changePct) * 0.16, 2),
    limitUp: changePct >= 9.8,
    limitDown: changePct <= -9.8,
    source: buildSource(now.toISOString()),
  }
}

function buildSectorHeat(): SectorHeat[] {
  const now = new Date().toISOString()
  return SECTORS.map((sector) => {
    const quotes = buildQuotes(sector.symbols)
    const changePct = average(quotes.map((quote) => quote.changePct))
    const risingCount = quotes.filter((quote) => quote.changePct >= 0).length
    const fallingCount = quotes.length - risingCount
    const limitUpCount = quotes.filter((quote) => quote.limitUp).length
    const amount = quotes.reduce((sum, quote) => sum + quote.amount, 0)
    const sorted = [...quotes].sort((left, right) => right.changePct - left.changePct)
    const diffusionScore = clampScore((risingCount / Math.max(1, quotes.length)) * 100)
    const persistenceScore = clampScore(42 + seededUnit(`${sector.id}:persistence`) * 34 + Math.max(0, changePct) * 5)
    const strengthScore = clampScore(45 + Math.max(0, changePct) * 9 + diffusionScore * 0.24 + limitUpCount * 8)
    const riskScore = clampScore(34 + Math.max(0, -changePct) * 9 + (100 - diffusionScore) * 0.22)
    return {
      sectorId: sector.id,
      sectorName: sector.name,
      ts: now,
      changePct: round(changePct, 2),
      amount,
      risingCount,
      fallingCount,
      limitUpCount,
      leaderSymbols: sorted.slice(0, 3).map((quote) => quote.symbol),
      strengthScore,
      diffusionScore,
      persistenceScore,
      riskScore,
    }
  }).sort((left, right) => right.strengthScore - left.strengthScore)
}

function buildNarratives(): MarketNarrative[] {
  const now = new Date()
  const fetchedAt = now.toISOString()
  const rows = [
    {
      id: 'narrative-ai-chip-capex',
      title: '算力链订单预期升温',
      content: '论坛和新闻源集中讨论 AI 算力资本开支，光模块、存储和先进封装方向关注度上升。',
      symbols: ['300308.SZ', '603986.SH', '688981.SH'],
      sectors: ['ai-chip', 'semiconductor'],
      category: 'social' as const,
      confidenceScore: 62,
      catalystScore: 76,
      riskScore: 58,
      aiSummary: '题材热度与板块强度有一定共振，但仍需确认订单、业绩或公告层面的硬证据。',
    },
    {
      id: 'narrative-robotics-policy',
      title: '机器人产业政策窗口',
      content: '产业政策预期带动机器人零部件方向活跃，资金更偏好有业绩兑现路径的核心供应链。',
      symbols: ['300124.SZ', '002050.SZ'],
      sectors: ['robotics'],
      category: 'news' as const,
      confidenceScore: 68,
      catalystScore: 64,
      riskScore: 44,
      aiSummary: '政策催化偏中期，短线要观察成交额能否扩散到板块内更多标的。',
    },
    {
      id: 'narrative-new-energy-repair',
      title: '新能源低位修复',
      content: '锂电和光伏方向出现低位修复讨论，但供需格局和价格压力仍是主要反证。',
      symbols: ['300750.SZ', '002594.SZ', '601012.SH'],
      sectors: ['new-energy', 'lithium'],
      category: 'research' as const,
      confidenceScore: 57,
      catalystScore: 53,
      riskScore: 66,
      aiSummary: '更像超跌修复，需要量能和产业价格数据配合，暂不宜把单日反弹当作趋势反转。',
    },
  ]

  return rows.map((row, index) => ({
    ...row,
    contentHash: crypto.createHash('sha256').update(row.content).digest('hex'),
    source: buildSource(fetchedAt, index === 1 ? 'Mock News' : 'Mock Social'),
    publishedAt: new Date(now.getTime() - (index + 1) * 38 * 60_000).toISOString(),
    fetchedAt,
    evidenceIds: [],
    contradictionIds: [],
  }))
}

function buildInfluencerPosts(): InfluencerPost[] {
  const now = new Date()
  const fetchedAt = now.toISOString()
  return [
    {
      id: 'tg-mock-lighthouse-ai',
      platform: 'taoguba',
      authorId: 'mock-lighthouse',
      authorName: '灯塔复盘',
      title: '今天主要看算力扩散',
      content: '算力方向继续有赚钱效应，重点观察龙头能否稳住，后排不要追高。',
      sourceUrl: 'https://tgb.cn/newIndex/',
      publishedAt: new Date(now.getTime() - 24 * 60_000).toISOString(),
      fetchedAt,
      symbols: ['300308.SZ', '603986.SH'],
      sectors: ['ai-chip'],
      engagement: {
        views: 18200,
        replies: 128,
        likes: 420,
        favorites: 96,
      },
      stance: 'bullish',
      noveltyScore: 61,
      influenceScore: 74,
    },
    {
      id: 'tg-mock-rhythm-risk',
      platform: 'taoguba',
      authorId: 'mock-rhythm',
      authorName: '节奏笔记',
      title: '尾盘防一致性兑现',
      content: '强题材午后如果继续加速，要留意一致性后的分歧风险。',
      sourceUrl: 'https://tgb.cn/newIndex/',
      publishedAt: new Date(now.getTime() - 53 * 60_000).toISOString(),
      fetchedAt,
      symbols: ['300308.SZ', '002050.SZ'],
      sectors: ['ai-chip', 'robotics'],
      engagement: {
        views: 9600,
        replies: 66,
        likes: 198,
      },
      stance: 'neutral',
      noveltyScore: 48,
      influenceScore: 59,
    },
  ]
}

function buildAlerts(
  quotes: QuoteSnapshot[],
  sectors: SectorHeat[],
  narratives: MarketNarrative[],
  influencerPosts: InfluencerPost[]
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
      title: `${getSymbolName(strongQuote.symbol)} 盘中异动`,
      message: `${strongQuote.symbol} 涨幅 ${formatPct(strongQuote.changePct)}，量比 ${strongQuote.volumeRatio}，需要确认是否与板块或消息共振。`,
      symbols: [strongQuote.symbol],
      sectors: getSymbolSectors(strongQuote.symbol),
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
      title: `${getSymbolName(highVolume.symbol)} 放量`,
      message: `${highVolume.symbol} 量比 ${highVolume.volumeRatio}，成交额 ${formatAmount(highVolume.amount)}，观察突破或冲高回落。`,
      symbols: [highVolume.symbol],
      sectors: getSymbolSectors(highVolume.symbol),
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

function buildTechnicalSignal(symbol: string): TechnicalSignal {
  return buildTechnicalSignalFromBars(normalizeSymbol(symbol), buildBars(symbol, '1d', 90))
}

function getShanghaiNoonUtc(date: Date): Date {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  return new Date(`${formatted}T04:00:00.000Z`)
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

function buildSource(fetchedAt: string, sourceName = 'Mock Market Feed'): MarketSourceRef {
  return {
    sourceName,
    provider: MARKET_PROVIDER,
    licenseType: 'mock',
    fetchedAt,
  }
}

function sectorBias(symbol: string): number {
  const sectors = getSymbolSectors(symbol)
  if (sectors.includes('ai-chip')) return 0.9
  if (sectors.includes('robotics')) return 0.45
  if (sectors.includes('finance')) return -0.12
  if (sectors.includes('new-energy')) return 0.18
  return 0
}

function getSymbolName(symbol: string): string {
  return SYMBOLS.find((item) => item.symbol === symbol)?.name || symbol
}

function getSymbolSectors(symbol: string): string[] {
  return SYMBOLS.find((item) => item.symbol === symbol)?.sectorIds || []
}

function seededUnit(value: string): number {
  const hash = crypto.createHash('sha256').update(value).digest()
  const int = hash.readUInt32BE(0)
  return int / 0xffffffff
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
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
