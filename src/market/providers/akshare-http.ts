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
    if (timeframe !== '1d') {
      throw new Error('only 1d bars are available in akshare-http provider')
    }
    const normalized = normalizeSymbol(symbol)
    try {
      const payload = await requestJson('/api/market/bars', {
        symbol: normalized,
        timeframe,
        limit: String(limit),
      })
      const rows = Array.isArray((payload as any).bars)
        ? (payload as any).bars
        : Array.isArray(payload)
          ? payload
          : []
      const bars = rows.map((row: unknown) => normalizeBar(row, normalized, timeframe)).filter(Boolean) as MarketBar[]
      const expectedMinRows = Math.min(Math.max(1, limit), 26)
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

  async function getNarratives(): Promise<MarketNarrative[]> {
    return fallback ? fallback.getNarratives() : []
  }

  async function getInfluencerPosts(): Promise<InfluencerPost[]> {
    return fallback ? fallback.getInfluencerPosts() : []
  }

  async function requestJson(pathname: string, query: Record<string, string>): Promise<unknown> {
    if (!baseUrl) {
      throw new Error('AKSHARE_BASE_URL is required when MARKET_PROVIDER=akshare-http')
    }
    const url = new URL(`${baseUrl}${pathname}`)
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
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
    getNarratives,
    getInfluencerPosts,
  }
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
