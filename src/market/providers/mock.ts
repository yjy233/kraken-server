import crypto from 'node:crypto'
import type {
  InfluencerPost,
  MarketBar,
  MarketNarrative,
  MarketSourceRef,
  MarketSymbol,
  QuoteSnapshot,
  SectorHeat,
} from '../types.js'
import { normalizeSymbol, normalizeSymbols } from '../store.js'
import type { MarketProvider, MarketProviderStatus } from './types.js'

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

export function createMockMarketProvider(): MarketProvider {
  async function getStatus(): Promise<MarketProviderStatus> {
    return {
      provider: MARKET_PROVIDER,
      providerLabel: MARKET_PROVIDER_LABEL,
      quoteDelayMs: QUOTE_DELAY_MS,
      dataMode: 'mock',
      capabilities: {
        quotes: true,
        bars: true,
        sectors: true,
        narratives: true,
        influencers: true,
      },
    }
  }

  async function getSymbols(): Promise<MarketSymbol[]> {
    return SYMBOLS
  }

  async function getQuotes(symbols: string[]): Promise<QuoteSnapshot[]> {
    return buildQuotes(symbols)
  }

  async function getBars(symbol: string, timeframe: MarketBar['timeframe'], limit: number): Promise<MarketBar[]> {
    if (timeframe !== '1d') {
      throw new Error('only 1d bars are available in mock provider')
    }
    return buildBars(symbol, timeframe, limit)
  }

  async function getHotSectors(): Promise<SectorHeat[]> {
    return buildSectorHeat()
  }

  async function getNarratives(): Promise<MarketNarrative[]> {
    return buildNarratives()
  }

  async function getInfluencerPosts(): Promise<InfluencerPost[]> {
    return buildInfluencerPosts()
  }

  return {
    getStatus,
    getSymbols,
    getQuotes,
    getBars,
    getHotSectors,
    getNarratives,
    getInfluencerPosts,
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

function getShanghaiNoonUtc(date: Date): Date {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  return new Date(`${formatted}T04:00:00.000Z`)
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
