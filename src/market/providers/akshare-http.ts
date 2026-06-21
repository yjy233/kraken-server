import type {
  DragonTigerBrokerTrade,
  DragonTigerDailyStock,
  DragonTigerInstitutionSeat,
  DragonTigerSeat,
  DragonTigerStock,
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
import { createMockMarketProvider } from './mock.js'

interface AkshareHttpProviderOptions {
  baseUrl: string
  timeoutMs: number
  allowFallback: boolean
}

export function createAkshareHttpMarketProvider(options: AkshareHttpProviderOptions): MarketProvider {
  const fallback = options.allowFallback ? createMockMarketProvider() : null
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const timeoutMs = Math.max(1000, options.timeoutMs)

  async function getStatus(): Promise<MarketProviderStatus> {
    return {
      provider: 'akshare-http',
      providerLabel: fallback ? 'AKShare HTTP provider with mock fallback' : 'AKShare HTTP provider',
      quoteDelayMs: 60_000,
      dataMode: 'live',
      capabilities: {
        quotes: true,
        bars: true,
        sectors: true,
        narratives: false,
        influencers: false,
      },
    }
  }

  async function getSymbols(): Promise<MarketSymbol[]> {
    return fallback ? fallback.getSymbols() : []
  }

  async function getQuotes(symbols: string[]): Promise<QuoteSnapshot[]> {
    const normalized = normalizeSymbols(symbols)
    if (normalized.length === 0) {
      return []
    }
    try {
      const payload = await requestJson('/api/market/quotes', { symbols: normalized.join(',') })
      const rows = Array.isArray((payload as any).quotes)
        ? (payload as any).quotes
        : Array.isArray(payload)
          ? payload
          : []
      const quotes = rows.map((row: unknown) => normalizeQuote(row)).filter(Boolean) as QuoteSnapshot[]
      if (quotes.length > 0) {
        return quotes
      }
      if (!fallback) {
        throw new Error(`AKShare HTTP quotes returned no rows for ${normalized.join(', ')}`)
      }
      return fallback.getQuotes(normalized)
    } catch (error) {
      if (fallback) {
        return fallback.getQuotes(normalized)
      }
      throw wrapAkshareError(error, 'quotes')
    }
  }

  async function getBars(symbol: string, timeframe: MarketBar['timeframe'], limit: number): Promise<MarketBar[]> {
    if (!isSupportedBarTimeframe(timeframe)) {
      throw new Error('only 1m, 5m, 15m, 30m, 60m, 1d, 1mo, and 1y bars are available in akshare-http provider')
    }
    const normalized = normalizeSymbol(symbol)
    try {
      const payload = await requestJson('/api/market/bars', {
        symbol: normalized,
        timeframe,
        limit: String(limit),
      }, getBarRequestTimeoutMs(timeframe, timeoutMs))
      const rows = Array.isArray((payload as any).bars)
        ? (payload as any).bars
        : Array.isArray(payload)
          ? payload
          : []
      const bars = rows.map((row: unknown) => normalizeBar(row, normalized, timeframe)).filter(Boolean) as MarketBar[]
      const expectedMinRows = timeframe === '1y'
        ? Math.min(Math.max(1, limit), 6)
        : timeframe === '1mo'
          ? Math.min(Math.max(1, limit), 12)
          : timeframe === '1m'
            ? Math.min(Math.max(1, limit), 48)
            : timeframe === '5m'
              ? Math.min(Math.max(1, limit), 24)
              : timeframe === '15m'
                ? Math.min(Math.max(1, limit), 10)
                : timeframe === '30m'
                  ? Math.min(Math.max(1, limit), 6)
                  : timeframe === '60m'
                    ? Math.min(Math.max(1, limit), 4)
                    : Math.min(Math.max(1, limit), 26)
      if (bars.length >= expectedMinRows) {
        return bars
      }
      if (fallback) {
        return fallback.getBars(normalized, timeframe, limit)
      }
      throw new Error(`AKShare HTTP bars returned ${bars.length} rows for ${normalized}; expected at least ${expectedMinRows}`)
    } catch (error) {
      if (fallback) {
        return fallback.getBars(normalized, timeframe, limit)
      }
      throw wrapAkshareError(error, 'bars')
    }
  }

  async function getHotSectors(): Promise<SectorHeat[]> {
    try {
      const payload = await requestJson('/api/market/sectors/hot', { limit: '12' })
      const rows = Array.isArray((payload as any).sectors)
        ? (payload as any).sectors
        : Array.isArray(payload)
          ? payload
          : []
      const sectors = rows.map((row: unknown, index: number) => normalizeSector(row, index)).filter(Boolean) as SectorHeat[]
      if (sectors.length > 0 || !fallback) {
        return sectors
      }
      return fallback.getHotSectors()
    } catch {
      return fallback ? fallback.getHotSectors() : []
    }
  }

  async function getDragonTigerStocks(): Promise<DragonTigerStock[]> {
    try {
      const payload = await requestJson('/api/market/dragon-tiger', { window: '近14天', limit: '20' })
      const rows = Array.isArray((payload as any).stocks)
        ? (payload as any).stocks
        : Array.isArray(payload)
          ? payload
          : []
      const stocks = rows.map((row: unknown, index: number) => normalizeDragonTigerStock(row, index)).filter(Boolean) as DragonTigerStock[]
      if (stocks.length > 0 || !fallback) {
        return stocks
      }
      return fallback.getDragonTigerStocks()
    } catch (error) {
      if (fallback) {
        return fallback.getDragonTigerStocks()
      }
      throw wrapAkshareError(error, 'dragon tiger stocks')
    }
  }

  async function getDragonTigerDailyStocks(): Promise<DragonTigerDailyStock[]> {
    try {
      const payload = await requestJson('/api/market/dragon-tiger/daily', { window: '近14天', limit: '500' }, Math.max(timeoutMs, 20_000))
      const rows = Array.isArray((payload as any).dailyStocks)
        ? (payload as any).dailyStocks
        : Array.isArray(payload)
          ? payload
          : []
      const dailyStocks = rows.map((row: unknown, index: number) => normalizeDragonTigerDailyStock(row, index)).filter(Boolean) as DragonTigerDailyStock[]
      if (dailyStocks.length > 0 || !fallback) {
        return dailyStocks
      }
      return fallback.getDragonTigerDailyStocks()
    } catch (error) {
      if (fallback) {
        return fallback.getDragonTigerDailyStocks()
      }
      throw wrapAkshareError(error, 'dragon tiger daily stocks')
    }
  }

  async function getDragonTigerSeats(symbol: string, tradeDate?: string): Promise<DragonTigerSeat[]> {
    try {
      const query: Record<string, string> = {
        symbol: normalizeSymbol(symbol),
      }
      if (tradeDate) {
        query.tradeDate = tradeDate
      }
      const payload = await requestJson('/api/market/dragon-tiger/seats', query)
      const rows = Array.isArray((payload as any).seats)
        ? (payload as any).seats
        : Array.isArray(payload)
          ? payload
          : []
      return rows.map((row: unknown, index: number) => normalizeDragonTigerSeat(row, index)).filter(Boolean) as DragonTigerSeat[]
    } catch (error) {
      if (fallback) {
        return fallback.getDragonTigerSeats(symbol, tradeDate)
      }
      throw wrapAkshareError(error, 'dragon tiger seats')
    }
  }

  async function getDragonTigerInstitutions(): Promise<DragonTigerInstitutionSeat[]> {
    try {
      const payload = await requestJson('/api/market/dragon-tiger/institutions', { window: '近一月', limit: '20' })
      const rows = Array.isArray((payload as any).institutions)
        ? (payload as any).institutions
        : Array.isArray(payload)
          ? payload
          : []
      return rows.map((row: unknown, index: number) => normalizeDragonTigerInstitution(row, index)).filter(Boolean) as DragonTigerInstitutionSeat[]
    } catch (error) {
      if (fallback) {
        return fallback.getDragonTigerInstitutions()
      }
      throw wrapAkshareError(error, 'dragon tiger institutions')
    }
  }

  async function getDragonTigerBrokerTrades(brokerName: string, tradeDate?: string): Promise<DragonTigerBrokerTrade[]> {
    try {
      const query: Record<string, string> = {
        brokerName: brokerName.trim(),
        limit: '12',
      }
      if (tradeDate) {
        query.tradeDate = tradeDate
      }
      const payload = await requestJson('/api/market/dragon-tiger/broker-trades', query, Math.max(timeoutMs, 20_000))
      const rows = Array.isArray((payload as any).trades)
        ? (payload as any).trades
        : Array.isArray(payload)
          ? payload
          : []
      return rows.map((row: unknown, index: number) => normalizeDragonTigerBrokerTrade(row, index)).filter(Boolean) as DragonTigerBrokerTrade[]
    } catch (error) {
      if (fallback) {
        return fallback.getDragonTigerBrokerTrades(brokerName, tradeDate)
      }
      throw wrapAkshareError(error, 'dragon tiger broker trades')
    }
  }

  async function getNarratives(): Promise<MarketNarrative[]> {
    return fallback ? fallback.getNarratives() : []
  }

  async function getInfluencerPosts(): Promise<InfluencerPost[]> {
    return fallback ? fallback.getInfluencerPosts() : []
  }

  async function requestJson(pathname: string, query: Record<string, string>, requestTimeoutMs = timeoutMs): Promise<unknown> {
    if (!baseUrl) {
      throw new Error('AKSHARE_BASE_URL is required when MARKET_PROVIDER=akshare-http')
    }
    const url = new URL(`${baseUrl}${pathname}`)
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs)
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: 'application/json',
        },
      })
      const text = await response.text()
      const payload = parseJsonPayload(text)
      if (!response.ok || isErrorPayload(payload)) {
        const payloadError = isRecord(payload) && typeof payload.error === 'string'
          ? payload.error
          : text.trim()
        const detail = payloadError || `${response.status} ${response.statusText}`.trim()
        throw new Error(`AKShare HTTP request failed: ${detail}`)
      }
      return payload
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    getStatus,
    getSymbols,
    getQuotes,
    getBars,
    getHotSectors,
    getDragonTigerStocks,
    getDragonTigerDailyStocks,
    getDragonTigerSeats,
    getDragonTigerInstitutions,
    getDragonTigerBrokerTrades,
    getNarratives,
    getInfluencerPosts,
  }
}

function isSupportedBarTimeframe(timeframe: MarketBar['timeframe']): boolean {
  return timeframe === '1m' || timeframe === '5m' || timeframe === '15m' || timeframe === '30m' || timeframe === '60m' || timeframe === '1d' || timeframe === '1mo' || timeframe === '1y'
}

function getBarRequestTimeoutMs(timeframe: MarketBar['timeframe'], baseTimeoutMs: number): number {
  if (timeframe === '1m' || timeframe === '5m' || timeframe === '15m' || timeframe === '30m' || timeframe === '60m') {
    return Math.max(baseTimeoutMs, 15_000)
  }
  if (timeframe === '1y') {
    return Math.max(baseTimeoutMs, 60_000)
  }
  if (timeframe === '1mo') {
    return Math.max(baseTimeoutMs, 20_000)
  }
  return baseTimeoutMs
}

function wrapAkshareError(error: unknown, context: string): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('AKShare HTTP')) {
    return new Error(message)
  }
  return new Error(`AKShare HTTP ${context} failed: ${message}`)
}

function parseJsonPayload(text: string): unknown {
  if (!text.trim()) {
    return {}
  }
  try {
    return JSON.parse(text)
  } catch {
    return { error: text }
  }
}

function isErrorPayload(value: unknown): boolean {
  return isRecord(value) && value.ok === false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}

function normalizeSector(value: unknown, index: number): SectorHeat | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const row = value as Record<string, unknown>
  const sectorName = String(row.sectorName ?? row.name ?? row.板块名称 ?? row.名称 ?? '').trim()
  if (!sectorName) {
    return null
  }
  const ts = normalizeTimestamp(row.ts ?? row.time ?? row.datetime)
  const changePct = toNumber(row.changePct ?? row.pct_chg ?? row.涨跌幅)
  const amount = toNumber(row.amount ?? row.成交额)
  const risingCount = Math.round(toNumber(row.risingCount ?? row.rising_count ?? row.上涨家数))
  const fallingCount = Math.round(toNumber(row.fallingCount ?? row.falling_count ?? row.下跌家数))
  const limitUpCount = Math.round(toNumber(row.limitUpCount ?? row.limit_up_count ?? row.涨停家数))
  const diffusionScore = computeDiffusionScore(risingCount, fallingCount)
  return {
    sectorId: normalizeSectorId(row.sectorId ?? row.code ?? row.板块代码 ?? `${sectorName}-${index}`),
    sectorName,
    ts,
    changePct: round(changePct, 2),
    amount: Math.round(amount || 0),
    risingCount: Math.max(0, risingCount),
    fallingCount: Math.max(0, fallingCount),
    limitUpCount: Math.max(0, limitUpCount),
    leaderSymbols: normalizeSymbols(parseSymbolList(row.leaderSymbols ?? row.leaderSymbol ?? row.leader_symbol ?? row.领涨股票代码)),
    strengthScore: clampScore(toNumber(row.strengthScore ?? row.strength_score) || 50 + changePct * 8),
    diffusionScore: clampScore(toNumber(row.diffusionScore ?? row.diffusion_score) || diffusionScore),
    persistenceScore: clampScore(toNumber(row.persistenceScore ?? row.persistence_score) || 50),
    riskScore: clampScore(toNumber(row.riskScore ?? row.risk_score) || Math.max(25, 70 - diffusionScore / 2)),
  }
}

function normalizeDragonTigerDailyStock(value: unknown, index: number): DragonTigerDailyStock | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const row = value as Record<string, unknown>
  const symbol = normalizeSymbol(row.symbol ?? row.code ?? row.ts_code ?? row.代码)
  const tradeDate = normalizeTimestamp(row.tradeDate ?? row.trade_date ?? row.上榜日 ?? row.日期)
  if (!symbol) {
    return null
  }
  const name = String(row.name ?? row.名称 ?? '').trim()
  return {
    id: `dragon-tiger-daily-${symbol}-${normalizeDateKey(tradeDate)}-${toNumber(row.rawIndex ?? row.序号) || index}`,
    ...optionalInteger('rawIndex', row.rawIndex ?? row.raw_index ?? row.序号),
    tradeDate,
    symbol,
    ...(name ? { name } : {}),
    closePrice: round(toNumber(row.closePrice ?? row.close_price ?? row.收盘价), 2),
    changePct: round(toNumber(row.changePct ?? row.pct_chg ?? row.涨跌幅), 2),
    netBuyAmount: Math.round(toNumber(row.netBuyAmount ?? row.net_buy_amount ?? row.龙虎榜净买额)),
    buyAmount: Math.round(toNumber(row.buyAmount ?? row.buy_amount ?? row.龙虎榜买入额)),
    sellAmount: Math.round(toNumber(row.sellAmount ?? row.sell_amount ?? row.龙虎榜卖出额)),
    totalAmount: Math.round(toNumber(row.totalAmount ?? row.total_amount ?? row.龙虎榜成交额 ?? row.龙虎榜总成交额)),
    marketAmount: Math.round(toNumber(row.marketAmount ?? row.market_amount ?? row.市场总成交额)),
    netBuyRatio: round(toNumber(row.netBuyRatio ?? row.net_buy_ratio ?? row.净买额占总成交比), 4),
    turnoverAmountRatio: round(toNumber(row.turnoverAmountRatio ?? row.turnover_amount_ratio ?? row.成交额占总成交比), 4),
    turnoverRate: round(toNumber(row.turnoverRate ?? row.turnover_rate ?? row.换手率), 4),
    floatMarketCap: Math.round(toNumber(row.floatMarketCap ?? row.float_market_cap ?? row.流通市值)),
    ...(String(row.interpretation ?? row.解读 ?? '').trim() ? { interpretation: String(row.interpretation ?? row.解读).trim() } : {}),
    ...(String(row.listingReason ?? row.reason ?? row.上榜原因 ?? '').trim() ? { listingReason: String(row.listingReason ?? row.reason ?? row.上榜原因).trim() } : {}),
    ...optionalNumber('after1DayReturn', row.after1DayReturn ?? row.after_1_day_return ?? row.上榜后1日),
    ...optionalNumber('after2DayReturn', row.after2DayReturn ?? row.after_2_day_return ?? row.上榜后2日),
    ...optionalNumber('after5DayReturn', row.after5DayReturn ?? row.after_5_day_return ?? row.上榜后5日),
    ...optionalNumber('after10DayReturn', row.after10DayReturn ?? row.after_10_day_return ?? row.上榜后10日),
    ...(isRecord(row.raw) ? { raw: row.raw } : {}),
    source: buildSource(tradeDate),
  }
}

function normalizeDragonTigerStock(value: unknown, index: number): DragonTigerStock | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const row = value as Record<string, unknown>
  const symbol = normalizeSymbol(row.symbol ?? row.code ?? row.ts_code)
  const latestListedAt = normalizeTimestamp(row.latestListedAt ?? row.latest_listed_at ?? row.最近上榜日 ?? row.上榜日)
  if (!symbol) {
    return null
  }
  const name = String(row.name ?? row.名称 ?? '').trim()
  return {
    id: `dragon-tiger-${symbol}-${index}`,
    symbol,
    ...(name ? { name } : {}),
    latestListedAt,
    closePrice: round(toNumber(row.closePrice ?? row.close_price ?? row.收盘价), 2),
    changePct: round(toNumber(row.changePct ?? row.pct_chg ?? row.涨跌幅), 2),
    listingCount: Math.round(toNumber(row.listingCount ?? row.listing_count ?? row.上榜次数)),
    netBuyAmount: Math.round(toNumber(row.netBuyAmount ?? row.net_buy_amount ?? row.龙虎榜净买额)),
    buyAmount: Math.round(toNumber(row.buyAmount ?? row.buy_amount ?? row.龙虎榜买入额)),
    sellAmount: Math.round(toNumber(row.sellAmount ?? row.sell_amount ?? row.龙虎榜卖出额)),
    totalAmount: Math.round(toNumber(row.totalAmount ?? row.total_amount ?? row.龙虎榜总成交额 ?? row.龙虎榜成交额)),
    institutionBuyCount: Math.round(toNumber(row.institutionBuyCount ?? row.institution_buy_count ?? row.买方机构次数)),
    institutionSellCount: Math.round(toNumber(row.institutionSellCount ?? row.institution_sell_count ?? row.卖方机构次数)),
    institutionNetBuyAmount: Math.round(toNumber(row.institutionNetBuyAmount ?? row.institution_net_buy_amount ?? row.机构买入净额)),
    ...(String(row.interpretation ?? row.解读 ?? '').trim() ? { interpretation: String(row.interpretation ?? row.解读).trim() } : {}),
    ...(String(row.listingReason ?? row.reason ?? row.上榜原因 ?? '').trim() ? { listingReason: String(row.listingReason ?? row.reason ?? row.上榜原因).trim() } : {}),
    ...optionalNumber('after1DayReturn', row.after1DayReturn ?? row.after_1_day_return ?? row.上榜后1日),
    ...optionalNumber('after2DayReturn', row.after2DayReturn ?? row.after_2_day_return ?? row.上榜后2日),
    ...optionalNumber('after5DayReturn', row.after5DayReturn ?? row.after_5_day_return ?? row.上榜后5日),
    ...optionalNumber('after10DayReturn', row.after10DayReturn ?? row.after_10_day_return ?? row.上榜后10日),
    source: buildSource(latestListedAt),
  }
}

function normalizeDragonTigerSeat(value: unknown, index: number): DragonTigerSeat | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const row = value as Record<string, unknown>
  const symbol = normalizeSymbol(row.symbol ?? row.code ?? row.ts_code)
  const tradeDate = normalizeTimestamp(row.tradeDate ?? row.trade_date ?? row.交易日)
  const brokerName = String(row.brokerName ?? row.交易营业部名称 ?? '').trim()
  const side = row.side === 'sell' ? 'sell' : 'buy'
  if (!symbol || !brokerName) {
    return null
  }
  return {
    id: `dragon-tiger-seat-${symbol}-${side}-${index}`,
    symbol,
    tradeDate,
    side,
    rank: Math.round(toNumber(row.rank ?? row.序号)),
    brokerName,
    buyAmount: Math.round(toNumber(row.buyAmount ?? row.买入金额)),
    buyAmountRatio: round(toNumber(row.buyAmountRatio ?? row['买入金额-占总成交比例']), 4),
    sellAmount: Math.round(toNumber(row.sellAmount ?? row.卖出金额)),
    sellAmountRatio: round(toNumber(row.sellAmountRatio ?? row['卖出金额-占总成交比例']), 4),
    netAmount: Math.round(toNumber(row.netAmount ?? row.净额)),
    seatType: normalizeSeatType(row.seatType),
    ...(String(row.reason ?? row.类型 ?? '').trim() ? { reason: String(row.reason ?? row.类型).trim() } : {}),
    source: buildSource(tradeDate),
  }
}

function normalizeDragonTigerInstitution(value: unknown, index: number): DragonTigerInstitutionSeat | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const row = value as Record<string, unknown>
  const symbol = normalizeSymbol(row.symbol ?? row.code ?? row.ts_code)
  if (!symbol) {
    return null
  }
  const name = String(row.name ?? row.名称 ?? '').trim()
  const fetchedAt = new Date().toISOString()
  return {
    id: `dragon-tiger-institution-${symbol}-${index}`,
    symbol,
    ...(name ? { name } : {}),
    closePrice: round(toNumber(row.closePrice ?? row.收盘价), 2),
    changePct: round(toNumber(row.changePct ?? row.涨跌幅), 2),
    totalAmount: Math.round(toNumber(row.totalAmount ?? row.龙虎榜成交金额)),
    listingCount: Math.round(toNumber(row.listingCount ?? row.上榜次数)),
    institutionBuyAmount: Math.round(toNumber(row.institutionBuyAmount ?? row.机构买入额)),
    institutionBuyCount: Math.round(toNumber(row.institutionBuyCount ?? row.机构买入次数)),
    institutionSellAmount: Math.round(toNumber(row.institutionSellAmount ?? row.机构卖出额)),
    institutionSellCount: Math.round(toNumber(row.institutionSellCount ?? row.机构卖出次数)),
    institutionNetBuyAmount: Math.round(toNumber(row.institutionNetBuyAmount ?? row.机构净买额)),
    oneMonthChangePct: round(toNumber(row.oneMonthChangePct ?? row['近1个月涨跌幅']), 2),
    source: buildSource(fetchedAt),
  }
}

function normalizeDragonTigerBrokerTrade(value: unknown, index: number): DragonTigerBrokerTrade | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const row = value as Record<string, unknown>
  const symbol = normalizeSymbol(row.symbol ?? row.code ?? row.股票代码)
  const brokerName = String(row.brokerName ?? row.营业部名称 ?? '').trim()
  const tradeDate = normalizeTimestamp(row.tradeDate ?? row.trade_date ?? row.交易日期 ?? row.交易日)
  if (!symbol || !brokerName) {
    return null
  }
  const name = String(row.name ?? row.股票名称 ?? row.名称 ?? '').trim()
  return {
    id: `dragon-tiger-broker-trade-${symbol}-${index}`,
    ...(String(row.brokerCode ?? row.营业部代码 ?? '').trim() ? { brokerCode: String(row.brokerCode ?? row.营业部代码).trim() } : {}),
    brokerName,
    ...(String(row.brokerShortName ?? row.营业部简称 ?? '').trim() ? { brokerShortName: String(row.brokerShortName ?? row.营业部简称).trim() } : {}),
    tradeDate,
    symbol,
    ...(name ? { name } : {}),
    changePct: round(toNumber(row.changePct ?? row.涨跌幅), 2),
    buyAmount: Math.round(toNumber(row.buyAmount ?? row.买入金额)),
    sellAmount: Math.round(toNumber(row.sellAmount ?? row.卖出金额)),
    netAmount: Math.round(toNumber(row.netAmount ?? row.净额)),
    ...(String(row.listingReason ?? row.上榜原因 ?? '').trim() ? { listingReason: String(row.listingReason ?? row.上榜原因).trim() } : {}),
    ...optionalNumber('after1DayReturn', row.after1DayReturn ?? row['1日后涨跌幅']),
    ...optionalNumber('after2DayReturn', row.after2DayReturn ?? row['2日后涨跌幅']),
    ...optionalNumber('after3DayReturn', row.after3DayReturn ?? row['3日后涨跌幅']),
    ...optionalNumber('after5DayReturn', row.after5DayReturn ?? row['5日后涨跌幅']),
    ...optionalNumber('after10DayReturn', row.after10DayReturn ?? row['10日后涨跌幅']),
    ...optionalNumber('after20DayReturn', row.after20DayReturn ?? row['20日后涨跌幅']),
    ...optionalNumber('after30DayReturn', row.after30DayReturn ?? row['30日后涨跌幅']),
    source: buildSource(tradeDate),
  }
}

function normalizeQuote(value: unknown): QuoteSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const row = value as Record<string, unknown>
  const symbol = normalizeSymbol(row.symbol ?? row.code ?? row.ts_code)
  const name = String(row.name ?? row.名称 ?? row.证券简称 ?? row.股票简称 ?? '').trim()
  const price = toNumber(row.price ?? row.close ?? row.latest)
  const previousClose = toNumber(row.previousClose ?? row.pre_close ?? row.prev_close ?? row.yesterdayClose) || price
  if (!symbol || !price) {
    return null
  }
  const ts = normalizeTimestamp(row.ts ?? row.time ?? row.datetime ?? row.trade_time)
  const change = toNumber(row.change ?? row.pct_chg_amount) || price - previousClose
  const changePct = toNumber(row.changePct ?? row.pct_chg ?? row.percent ?? row.change_percent) || (previousClose ? (price - previousClose) / previousClose * 100 : 0)
  return {
    symbol,
    ...(name ? { name } : {}),
    ts,
    price: round(price, 2),
    change: round(change, 2),
    changePct: round(changePct, 2),
    open: round(toNumber(row.open) || price, 2),
    high: round(toNumber(row.high) || price, 2),
    low: round(toNumber(row.low) || price, 2),
    previousClose: round(previousClose, 2),
    volume: Math.round(toNumber(row.volume ?? row.vol) || 0),
    amount: Math.round(toNumber(row.amount ?? row.成交额) || 0),
    turnoverRate: round(toNumber(row.turnoverRate ?? row.turnover_rate) || 0, 2),
    volumeRatio: round(toNumber(row.volumeRatio ?? row.volume_ratio) || 1, 2),
    source: buildSource(ts),
  }
}

function normalizeBar(value: unknown, fallbackSymbol: string, timeframe: MarketBar['timeframe']): MarketBar | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const row = value as Record<string, unknown>
  const symbol = normalizeSymbol(row.symbol ?? row.code ?? row.ts_code ?? fallbackSymbol)
  const close = toNumber(row.close ?? row.收盘)
  if (!symbol || !close) {
    return null
  }
  const ts = normalizeTimestamp(row.ts ?? row.date ?? row.trade_date ?? row.datetime ?? row.日期)
  return {
    symbol,
    ts,
    timeframe,
    open: round(toNumber(row.open ?? row.开盘) || close, 2),
    high: round(toNumber(row.high ?? row.最高) || close, 2),
    low: round(toNumber(row.low ?? row.最低) || close, 2),
    close: round(close, 2),
    volume: Math.round(toNumber(row.volume ?? row.vol ?? row.成交量) || 0),
    amount: Math.round(toNumber(row.amount ?? row.成交额) || 0),
    source: buildSource(ts),
  }
}

function normalizeTimestamp(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString()
  }
  const raw = String(value || '').trim()
  if (!raw) {
    return new Date().toISOString()
  }
  if (/^\d{8}$/.test(raw)) {
    return new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T04:00:00.000Z`).toISOString()
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    return new Date(`${raw.replace(' ', 'T')}+08:00`).toISOString()
  }
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

function normalizeSectorId(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown-sector'
}

function parseSymbolList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item))
  }
  return String(value || '')
    .split(/[,，、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function computeDiffusionScore(risingCount: number, fallingCount: number): number {
  const total = risingCount + fallingCount
  if (total <= 0) {
    return 50
  }
  return Math.round((risingCount / total) * 100)
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function buildSource(fetchedAt: string): MarketSourceRef {
  return {
    sourceName: 'AKShare HTTP',
    provider: 'akshare-http',
    licenseType: 'public',
    fetchedAt,
  }
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').replace(/%$/, '').trim()
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function normalizeSeatType(value: unknown): DragonTigerSeat['seatType'] {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'institution' || raw === 'broker' || raw === 'northbound' || raw === 'unknown') {
    return raw
  }
  return 'unknown'
}

function optionalNumber<T extends string>(key: T, value: unknown): Partial<Record<T, number>> {
  const parsed = toNumber(value)
  if (!Number.isFinite(parsed) || parsed === 0) {
    return {}
  }
  return {
    [key]: round(parsed, 2),
  } as Partial<Record<T, number>>
}

function optionalInteger<T extends string>(key: T, value: unknown): Partial<Record<T, number>> {
  const parsed = toNumber(value)
  if (!Number.isFinite(parsed) || parsed === 0) {
    return {}
  }
  return {
    [key]: Math.round(parsed),
  } as Partial<Record<T, number>>
}

function normalizeDateKey(value: string): string {
  return value.slice(0, 10).replace(/\D/g, '') || value.replace(/\W/g, '')
}
