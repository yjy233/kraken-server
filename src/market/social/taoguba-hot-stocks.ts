import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type {
  HotStockSignal,
  HotStockSourceStatus,
  MarketSourceRef,
  MarketSymbol,
} from '../types.js'
import { normalizeSymbol } from '../store.js'
import { collapseWhitespace, truncate } from '../../utils/helpers.js'

interface TaogubaHotStocksOptions {
  enabled: boolean
  mode: 'agent_browser'
  urls: string[]
  limit: number
  cacheTtlMs: number
  agentBrowserBin: string
  agentBrowserAllowedDomains?: string
  timeoutMs: number
  rootDir: string
}

interface HotStocksResult {
  hotStocks: HotStockSignal[]
  status: HotStockSourceStatus
}

interface CandidateDraft {
  symbol: string
  name?: string
  firstLine: string
  sourceUrl: string
  sourceType: HotStockSignal['sourceType']
  mentionCount: number
  rankHint: number
  score: number
  reasons: Set<string>
}

const DEFAULT_STATUS: HotStockSourceStatus = {
  enabled: false,
  provider: 'taoguba',
  providerLabel: '淘股吧热门股票',
  mode: 'disabled',
  sourceUrls: [],
  message: '淘股吧热门股票采集未启用。',
}

const BUILTIN_SYMBOL_HINTS: MarketSymbol[] = [
  { symbol: '600498.SH', exchange: 'SSE', name: '烽火通信', assetType: 'stock', currency: 'CNY' },
  { symbol: '300308.SZ', exchange: 'SZSE', name: '中际旭创', assetType: 'stock', currency: 'CNY' },
  { symbol: '603986.SH', exchange: 'SSE', name: '兆易创新', assetType: 'stock', currency: 'CNY' },
  { symbol: '688981.SH', exchange: 'SSE', name: '中芯国际', assetType: 'stock', currency: 'CNY' },
  { symbol: '002230.SZ', exchange: 'SZSE', name: '科大讯飞', assetType: 'stock', currency: 'CNY' },
  { symbol: '300750.SZ', exchange: 'SZSE', name: '宁德时代', assetType: 'stock', currency: 'CNY' },
  { symbol: '002594.SZ', exchange: 'SZSE', name: '比亚迪', assetType: 'stock', currency: 'CNY' },
  { symbol: '601318.SH', exchange: 'SSE', name: '中国平安', assetType: 'stock', currency: 'CNY' },
  { symbol: '000001.SZ', exchange: 'SZSE', name: '平安银行', assetType: 'stock', currency: 'CNY' },
  { symbol: '600519.SH', exchange: 'SSE', name: '贵州茅台', assetType: 'stock', currency: 'CNY' },
]

export function createTaogubaHotStocksCollector(options: TaogubaHotStocksOptions) {
  let cache: { expiresAt: number; result: HotStocksResult } | null = null

  async function getHotStocks(symbols: MarketSymbol[]): Promise<HotStocksResult> {
    const sourceUrls = normalizeUrls(options.urls)
    if (!options.enabled) {
      return {
        hotStocks: [],
        status: {
          ...DEFAULT_STATUS,
          sourceUrls,
        },
      }
    }
    if (cache && cache.expiresAt > Date.now()) {
      return cache.result
    }
    const fetchedAt = new Date().toISOString()
    const statusBase: HotStockSourceStatus = {
      enabled: true,
      provider: 'taoguba',
      providerLabel: '淘股吧热门股票',
      mode: 'agent_browser',
      sourceUrls,
      fetchedAt,
    }
    if (sourceUrls.length === 0) {
      return {
        hotStocks: [],
        status: {
          ...statusBase,
          error: 'TAOGUBA_HOTSTOCKS_URLS 为空。',
        },
      }
    }

    try {
      const textByUrl = await fetchTextByAgentBrowser(sourceUrls)
      const hotStocks = extractHotStocks({
        textByUrl,
        symbols: buildSymbolUniverse(symbols),
        fetchedAt,
        limit: options.limit,
      })
      const result: HotStocksResult = {
        hotStocks,
        status: {
          ...statusBase,
          message: hotStocks.length > 0
            ? `已从淘股吧页面提取 ${hotStocks.length} 只热门股票。`
            : '已打开淘股吧页面，但没有识别到股票代码或已知股票简称。',
        },
      }
      cache = {
        expiresAt: Date.now() + options.cacheTtlMs,
        result,
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const result: HotStocksResult = {
        hotStocks: [],
        status: {
          ...statusBase,
          error: message,
        },
      }
      cache = {
        expiresAt: Date.now() + Math.min(options.cacheTtlMs, 60_000),
        result,
      }
      return result
    }
  }

  async function fetchTextByAgentBrowser(urls: string[]): Promise<Array<{ url: string; text: string }>> {
    const bin = resolveAgentBrowserBin(options.agentBrowserBin, options.rootDir)
    const session = 'kraken-market-taoguba-hotstocks'
    const results: Array<{ url: string; text: string }> = []
    for (const url of urls) {
      await runAgentBrowser(bin, buildAgentBrowserArgs(session, ['open', url, '--json']), options.timeoutMs)
      await runAgentBrowser(bin, buildAgentBrowserArgs(session, ['wait', '--load', 'domcontentloaded', '--json']), options.timeoutMs)
        .catch(() => null)
      const textResult = await runAgentBrowser(bin, buildAgentBrowserArgs(session, ['get', 'text', 'body', '--json']), options.timeoutMs)
        .catch(async () => runAgentBrowser(bin, buildAgentBrowserArgs(session, ['snapshot', '-c', '--json']), options.timeoutMs))
      results.push({
        url,
        text: extractAgentBrowserText(textResult.stdout),
      })
    }
    return results
  }

  function buildAgentBrowserArgs(session: string, args: string[]): string[] {
    const command = ['--session', session]
    const allowedDomains = String(options.agentBrowserAllowedDomains || '').trim()
    if (allowedDomains && allowedDomains !== '*') {
      command.push('--allowed-domains', allowedDomains)
    }
    command.push(...args)
    return command
  }

  return {
    getHotStocks,
  }
}

function extractHotStocks(input: {
  textByUrl: Array<{ url: string; text: string }>
  symbols: MarketSymbol[]
  fetchedAt: string
  limit: number
}): HotStockSignal[] {
  const symbolByCode = new Map(input.symbols.map((item) => [symbolCode(item.symbol), item]))
  const symbolsByName = input.symbols
    .filter((item) => item.name && item.name.length >= 2)
    .sort((left, right) => right.name.length - left.name.length)
  const drafts = new Map<string, CandidateDraft>()

  const upsert = (params: {
    symbol: string
    name?: string
    line: string
    sourceUrl: string
    sourceType: HotStockSignal['sourceType']
    lineIndex: number
    reason: string
  }) => {
    const normalized = normalizeSymbol(params.symbol)
    if (!normalized || !isAStockSymbol(normalized)) {
      return
    }
    const current = drafts.get(normalized)
    const symbolInfo = symbolByCode.get(symbolCode(normalized))
    const name = params.name || symbolInfo?.name
    const lineScore = scoreHotStockLine(params.line, params.lineIndex)
    if (!current) {
      const draft: CandidateDraft = {
        symbol: normalized,
        ...(name ? { name } : {}),
        firstLine: params.line,
        sourceUrl: params.sourceUrl,
        sourceType: params.sourceType,
        mentionCount: 1,
        rankHint: params.lineIndex + 1,
        score: lineScore,
        reasons: new Set([params.reason]),
      }
      drafts.set(normalized, draft)
      return
    }
    current.mentionCount += 1
    current.score += Math.max(8, Math.round(lineScore * 0.24))
    current.rankHint = Math.min(current.rankHint, params.lineIndex + 1)
    if (!current.name && name) {
      current.name = name
    }
    current.reasons.add(params.reason)
  }

  for (const { url, text } of input.textByUrl) {
    const sourceType = inferSourceType(url)
    const lines = buildHotStockLines(text)
    lines.forEach((line, lineIndex) => {
      const codeMatches = Array.from(line.matchAll(/(?:SH|SZ|BJ)?\d{6}(?:\.(?:SH|SZ|BJ))?/gi))
      for (const match of codeMatches) {
        const rawSymbol = match[0]
        const normalized = normalizeSymbol(rawSymbol)
        const symbolInfo = symbolByCode.get(symbolCode(normalized))
        upsert({
          symbol: normalized,
          ...(symbolInfo?.name ? { name: symbolInfo.name } : {}),
          line,
          sourceUrl: url,
          sourceType,
          lineIndex,
          reason: buildReason(line, '淘股吧页面出现股票代码'),
        })
      }
      for (const symbol of symbolsByName) {
        if (!line.includes(symbol.name)) {
          continue
        }
        upsert({
          symbol: symbol.symbol,
          name: symbol.name,
          line,
          sourceUrl: url,
          sourceType,
          lineIndex,
          reason: buildReason(line, `淘股吧页面出现「${symbol.name}」`),
        })
      }
    })
  }

  return Array.from(drafts.values())
    .map((draft, index) => {
      const rank = index + 1
      const score = Math.max(1, Math.min(100, Math.round(draft.score + Math.max(0, 30 - draft.rankHint) + draft.mentionCount * 6)))
      const source: MarketSourceRef = {
        sourceName: draft.sourceType === 'taoguba_search_hot' ? '淘股吧搜索热度' : '淘股吧热门页面',
        provider: 'taoguba-agent-browser',
        sourceUrl: draft.sourceUrl,
        licenseType: 'user_authorized',
        fetchedAt: input.fetchedAt,
        rawHash: crypto.createHash('sha256').update(`${draft.symbol}:${draft.firstLine}`).digest('hex'),
      }
      const rawHash = source.rawHash || crypto.createHash('sha256').update(`${draft.symbol}:${draft.sourceUrl}`).digest('hex')
      return {
        id: `taoguba-hot-${rawHash.slice(0, 12)}`,
        symbol: draft.symbol,
        ...(draft.name ? { name: draft.name } : {}),
        rank,
        score,
        sourceName: source.sourceName,
        sourceUrl: draft.sourceUrl,
        sourceType: draft.sourceType,
        heatText: truncate(draft.firstLine, 180),
        reasons: Array.from(draft.reasons).slice(0, 4),
        sectors: [],
        mentionCount: draft.mentionCount,
        fetchedAt: input.fetchedAt,
        source,
      }
    })
    .sort((left, right) => right.score - left.score || left.rank - right.rank)
    .map((item, index) => ({ ...item, rank: index + 1 }))
    .slice(0, input.limit)
}

function resolveAgentBrowserBin(configured: string, rootDir: string): string {
  const candidate = String(configured || '').trim()
  if (candidate && candidate !== 'agent-browser') {
    return candidate
  }
  const localBin = path.join(rootDir, 'node_modules', '.bin', 'agent-browser')
  if (existsSync(localBin)) {
    return localBin
  }
  return candidate || 'agent-browser'
}

function runAgentBrowser(bin: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  const child = spawn(bin, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AGENT_BROWSER_SESSION: 'kraken-market-taoguba-hotstocks',
    },
    shell: false,
  })
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      reject(new Error(`agent-browser timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error.code === 'ENOENT') {
        reject(new Error(`agent-browser executable not found: ${bin}. 请先安装 agent-browser 并设置 ALLOW_AGENT_BROWSER=true。`))
        return
      }
      reject(error)
    })
    child.on('close', (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (exitCode && exitCode !== 0) {
        reject(new Error(`agent-browser failed with exit code ${exitCode}: ${stderr || stdout}`))
        return
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
    })
  })
}

function extractAgentBrowserText(stdout: string): string {
  const raw = stdout.trim()
  if (!raw) {
    return ''
  }
  try {
    const parsed = JSON.parse(raw)
    const strings: string[] = []
    collectStrings(parsed, strings)
    return strings.join('\n')
  } catch {
    return raw
  }
}

function collectStrings(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    if (value.trim().length > 1) {
      output.push(value)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, output)
    }
    return
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectStrings(item, output)
    }
  }
}

function buildHotStockLines(text: string): string[] {
  return text
    .split(/[\n\r]+/)
    .map((line) => collapseWhitespace(line))
    .filter((line) => line.length >= 2)
    .filter((line) => !/登录|注册|验证码|免责声明|Copyright/i.test(line))
    .slice(0, 500)
}

function buildSymbolUniverse(symbols: MarketSymbol[]): MarketSymbol[] {
  const bySymbol = new Map<string, MarketSymbol>()
  for (const symbol of [...symbols, ...BUILTIN_SYMBOL_HINTS]) {
    if (!symbol.symbol || symbol.assetType !== 'stock') {
      continue
    }
    bySymbol.set(normalizeSymbol(symbol.symbol), {
      ...symbol,
      symbol: normalizeSymbol(symbol.symbol),
    })
  }
  return Array.from(bySymbol.values())
}

function scoreHotStockLine(line: string, lineIndex: number): number {
  let score = Math.max(18, 76 - lineIndex * 2)
  if (/实时|24小时|热度|人气|搜索|热门|风云榜/.test(line)) {
    score += 12
  }
  if (/涨停|连板|打板|龙头|主线|异动|飙升/.test(line)) {
    score += 10
  }
  const numberMatch = line.match(/(\d+(?:\.\d+)?)\s*(?:万|次|%|℃|热度|人气)?/)
  if (numberMatch?.[1]) {
    score += Math.min(10, Number(numberMatch[1]) / 10)
  }
  return score
}

function buildReason(line: string, prefix: string): string {
  return `${prefix}：${truncate(line, 72)}`
}

function inferSourceType(url: string): HotStockSignal['sourceType'] {
  if (/hotPop/i.test(url)) {
    return 'taoguba_search_hot'
  }
  if (/popularity|rank|hot/i.test(url)) {
    return 'taoguba_popularity_board'
  }
  return 'taoguba_page'
}

function normalizeUrls(urls: string[]): string[] {
  return urls
    .map((item) => item.trim())
    .filter((item) => item.startsWith('http://') || item.startsWith('https://'))
}

function symbolCode(symbol: string): string {
  return normalizeSymbol(symbol).slice(0, 6)
}

function isAStockSymbol(symbol: string): boolean {
  return /^\d{6}\.(SH|SZ|BJ)$/.test(symbol) && !['000001.SH', '399001.SZ', '399006.SZ'].includes(symbol)
}
