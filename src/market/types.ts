export type MarketExchange = 'SSE' | 'SZSE' | 'BJSE' | 'HKEX' | 'NASDAQ' | 'NYSE'

export interface MarketSourceRef {
  sourceName: string
  provider: string
  sourceUrl?: string
  licenseType: 'mock' | 'public' | 'licensed' | 'user_authorized'
  fetchedAt: string
  publishedAt?: string
  rawHash?: string
}

export interface MarketSymbol {
  symbol: string
  exchange: MarketExchange
  name: string
  assetType: 'stock' | 'index' | 'etf' | 'sector'
  currency: string
  lotSize?: number
  status?: 'active' | 'suspended' | 'delisted'
  sectorIds?: string[]
}

export interface QuoteSnapshot {
  symbol: string
  name?: string
  ts: string
  price: number
  change: number
  changePct: number
  open: number
  high: number
  low: number
  previousClose: number
  volume: number
  amount: number
  turnoverRate: number
  volumeRatio: number
  limitUp?: boolean
  limitDown?: boolean
  source: MarketSourceRef
}

export interface MarketBar {
  symbol: string
  ts: string
  timeframe: '1d' | '1mo' | '1y' | '1m' | '5m' | '15m' | '30m' | '60m'
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount: number
  source: MarketSourceRef
}

export interface SectorHeat {
  sectorId: string
  sectorName: string
  ts: string
  changePct: number
  amount: number
  risingCount: number
  fallingCount: number
  limitUpCount: number
  leaderSymbols: string[]
  strengthScore: number
  diffusionScore: number
  persistenceScore: number
  riskScore: number
}

export interface MarketNarrative {
  id: string
  title: string
  content: string
  contentHash: string
  source: MarketSourceRef
  publishedAt?: string
  fetchedAt: string
  symbols: string[]
  sectors: string[]
  category: 'announcement' | 'news' | 'research' | 'social' | 'rumor' | 'user_note'
  confidenceScore: number
  catalystScore: number
  riskScore: number
  aiSummary: string
  evidenceIds: string[]
  contradictionIds: string[]
}

export interface InfluencerPost {
  id: string
  platform: 'taoguba'
  authorId: string
  authorName: string
  title?: string
  content: string
  sourceUrl: string
  publishedAt?: string
  fetchedAt: string
  symbols: string[]
  sectors: string[]
  engagement: {
    views?: number
    replies?: number
    likes?: number
    favorites?: number
  }
  stance?: 'bullish' | 'bearish' | 'neutral' | 'unclear'
  noveltyScore: number
  influenceScore: number
}

export interface MarketAlert {
  id: string
  level: 'info' | 'watch' | 'urgent'
  title: string
  message: string
  symbols: string[]
  sectors: string[]
  triggeredAt: string
  ruleId?: string
  sourceEventIds: string[]
  status: 'new' | 'seen' | 'dismissed' | 'resolved'
  aiRationale?: string
}

export interface TechnicalSignal {
  symbol: string
  ts: string
  timeframe: MarketBar['timeframe']
  trend: 'uptrend' | 'sideways' | 'downtrend'
  ma5: number
  ma10: number
  ma20: number
  atr14: number
  rsi6: number
  macd: {
    dif: number
    dea: number
    hist: number
  }
  support: number
  resistance: number
  volumeSignal: 'expanding' | 'normal' | 'shrinking'
  bars: MarketBar[]
  summary: string
  riskNotes: string[]
}

export interface HotStockSignal {
  id: string
  symbol: string
  name?: string
  rank: number
  score: number
  sourceName: string
  sourceUrl?: string
  sourceType: 'taoguba_search_hot' | 'taoguba_popularity_board' | 'taoguba_page'
  heatText: string
  reasons: string[]
  sectors: string[]
  mentionCount: number
  fetchedAt: string
  publishedAt?: string
  source: MarketSourceRef
}

export interface HotStockSourceStatus {
  enabled: boolean
  provider: string
  providerLabel: string
  mode: 'disabled' | 'agent_browser'
  sourceUrls: string[]
  fetchedAt?: string
  message?: string
  error?: string
}

export interface DragonTigerStock {
  id: string
  symbol: string
  name?: string
  latestListedAt: string
  closePrice: number
  changePct: number
  listingCount: number
  netBuyAmount: number
  buyAmount: number
  sellAmount: number
  totalAmount: number
  institutionBuyCount: number
  institutionSellCount: number
  institutionNetBuyAmount: number
  interpretation?: string
  listingReason?: string
  after1DayReturn?: number
  after2DayReturn?: number
  after5DayReturn?: number
  after10DayReturn?: number
  source: MarketSourceRef
}

export interface DragonTigerDailyStock {
  id: string
  rawIndex?: number
  tradeDate: string
  symbol: string
  name?: string
  closePrice: number
  changePct: number
  netBuyAmount: number
  buyAmount: number
  sellAmount: number
  totalAmount: number
  marketAmount: number
  netBuyRatio: number
  turnoverAmountRatio: number
  turnoverRate: number
  floatMarketCap: number
  interpretation?: string
  listingReason?: string
  after1DayReturn?: number
  after2DayReturn?: number
  after5DayReturn?: number
  after10DayReturn?: number
  raw?: Record<string, unknown>
  source: MarketSourceRef
}

export interface DragonTigerSeat {
  id: string
  symbol: string
  tradeDate: string
  side: 'buy' | 'sell'
  rank: number
  brokerName: string
  buyAmount: number
  buyAmountRatio: number
  sellAmount: number
  sellAmountRatio: number
  netAmount: number
  seatType: 'institution' | 'broker' | 'northbound' | 'unknown'
  reason?: string
  source: MarketSourceRef
}

export interface DragonTigerInstitutionSeat {
  id: string
  symbol: string
  name?: string
  closePrice: number
  changePct: number
  totalAmount: number
  listingCount: number
  institutionBuyAmount: number
  institutionBuyCount: number
  institutionSellAmount: number
  institutionSellCount: number
  institutionNetBuyAmount: number
  oneMonthChangePct: number
  source: MarketSourceRef
}

export interface DragonTigerBrokerTrade {
  id: string
  brokerCode?: string
  brokerName: string
  brokerShortName?: string
  tradeDate: string
  symbol: string
  name?: string
  changePct: number
  buyAmount: number
  sellAmount: number
  netAmount: number
  listingReason?: string
  after1DayReturn?: number
  after2DayReturn?: number
  after3DayReturn?: number
  after5DayReturn?: number
  after10DayReturn?: number
  after20DayReturn?: number
  after30DayReturn?: number
  source: MarketSourceRef
}

export interface MarketStatus {
  enabled: boolean
  provider: string
  providerLabel: string
  market: 'A_SHARE'
  phase: 'pre_market' | 'open' | 'lunch_break' | 'closed' | 'after_hours'
  tradingDay: string
  now: string
  quoteDelayMs: number
  dataMode: 'mock' | 'live'
  complianceMode: 'research_only'
}

export interface MarketOverview {
  status: MarketStatus
  indices: QuoteSnapshot[]
  watchlist: MarketWatchlist
  quotes: QuoteSnapshot[]
  sectors: SectorHeat[]
  narratives: MarketNarrative[]
  influencerPosts: InfluencerPost[]
  alerts: MarketAlert[]
  technicals: TechnicalSignal[]
  hotStocks: HotStockSignal[]
  hotStockQuotes: QuoteSnapshot[]
  hotStockStatus: HotStockSourceStatus
  dragonTigerStocks: DragonTigerStock[]
}

export interface MarketReport {
  id: string
  kind: 'intraday' | 'close' | 'watchlist'
  generatedAt: string
  tradingDay: string
  provider: string
  title: string
  summary: string
  indexBrief: string[]
  sectorBrief: string[]
  watchlistBrief: string[]
  narrativeBrief: string[]
  technicalBrief: string[]
  alertBrief: string[]
  riskNotes: string[]
  followUps: string[]
  sourceRefs: MarketSourceRef[]
}

export interface MarketWatchlist {
  id: string
  name: string
  symbols: string[]
  updatedAt: string
}

export interface WatchlistState {
  watchlist: MarketWatchlist
}
