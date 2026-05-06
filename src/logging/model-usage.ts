import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import readline from 'node:readline'
import { getModelLogPath, type ModelLogEntry } from './file-logger.js'

export interface ModelUsageCounters {
  requestCount: number
  responseCount: number
  errorCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  cost: number
  durationMs: number
  toolUseCount: number
}

export interface ModelUsageModelStats extends ModelUsageCounters {
  model: string
  providerModels: string[]
  usageFields: Record<string, number>
  averageDurationMs: number | null
  firstSeenAt: string | null
  lastSeenAt: string | null
  lastRequestAt: string | null
  lastResponseAt: string | null
  lastErrorAt: string | null
}

export interface ModelUsageSummary {
  generatedAt: string
  logPath: string
  logBytes: number
  parsedLineCount: number
  skippedLineCount: number
  modelCount: number
  usageFieldKeys: string[]
  totals: ModelUsageCounters
  models: ModelUsageModelStats[]
}

type MutableModelUsageModelStats = ModelUsageModelStats

interface NormalizedUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  cost: number
  usageFields: Record<string, number>
}

const EMPTY_COUNTERS: ModelUsageCounters = {
  requestCount: 0,
  responseCount: 0,
  errorCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  cost: 0,
  durationMs: 0,
  toolUseCount: 0,
}

export async function summarizeModelUsageLog(logPath = getModelLogPath()): Promise<ModelUsageSummary> {
  const stat = await fs.stat(logPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return null
    }
    throw error
  })
  if (!stat) {
    return createEmptySummary(logPath)
  }

  const models = new Map<string, MutableModelUsageModelStats>()
  let parsedLineCount = 0
  let skippedLineCount = 0

  const stream = createReadStream(logPath, { encoding: 'utf8' })
  const lines = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  })

  for await (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    let entry: ModelLogEntry
    try {
      entry = JSON.parse(trimmed) as ModelLogEntry
    } catch {
      skippedLineCount += 1
      continue
    }

    if (!isModelLogEntry(entry)) {
      skippedLineCount += 1
      continue
    }

    parsedLineCount += 1
    const stats = getOrCreateStats(models, entry.model || 'unknown')
    noteSeenAt(stats, entry.timestamp)

    if (entry.kind === 'request') {
      stats.requestCount += 1
      stats.lastRequestAt = latestIso(stats.lastRequestAt, entry.timestamp)
      continue
    }

    if (entry.kind === 'error') {
      stats.errorCount += 1
      stats.lastErrorAt = latestIso(stats.lastErrorAt, entry.timestamp)
      continue
    }

    stats.responseCount += 1
    stats.lastResponseAt = latestIso(stats.lastResponseAt, entry.timestamp)
    const durationMs = finiteNumber(entry.durationMs) ?? 0
    stats.durationMs += durationMs

    const payload = asRecord(entry.payload)
    const normalized = normalizeUsage(payload)
    stats.inputTokens += normalized.inputTokens
    stats.outputTokens += normalized.outputTokens
    stats.totalTokens += normalized.totalTokens
    stats.cachedTokens += normalized.cachedTokens
    stats.cacheWriteTokens += normalized.cacheWriteTokens
    stats.reasoningTokens += normalized.reasoningTokens
    stats.cost += normalized.cost
    stats.toolUseCount += Array.isArray(payload?.toolUses) ? payload.toolUses.length : 0
    mergeNumericFields(stats.usageFields, normalized.usageFields)

    const providerModel = readProviderModel(payload)
    if (providerModel && !stats.providerModels.includes(providerModel)) {
      stats.providerModels.push(providerModel)
    }
  }

  const modelList = [...models.values()]
    .map((stats) => ({
      ...stats,
      providerModels: [...stats.providerModels].sort(),
      usageFields: sortRecord(stats.usageFields),
      averageDurationMs: stats.responseCount > 0
        ? Math.round(stats.durationMs / stats.responseCount)
        : null,
    }))
    .sort((a, b) => {
      const requestDiff = b.requestCount - a.requestCount
      if (requestDiff !== 0) return requestDiff
      const tokenDiff = b.totalTokens - a.totalTokens
      if (tokenDiff !== 0) return tokenDiff
      return a.model.localeCompare(b.model)
    })

  const totals = modelList.reduce<ModelUsageCounters>((acc, item) => {
    acc.requestCount += item.requestCount
    acc.responseCount += item.responseCount
    acc.errorCount += item.errorCount
    acc.inputTokens += item.inputTokens
    acc.outputTokens += item.outputTokens
    acc.totalTokens += item.totalTokens
    acc.cachedTokens += item.cachedTokens
    acc.cacheWriteTokens += item.cacheWriteTokens
    acc.reasoningTokens += item.reasoningTokens
    acc.cost += item.cost
    acc.durationMs += item.durationMs
    acc.toolUseCount += item.toolUseCount
    return acc
  }, createEmptyCounters())

  const usageFieldKeys = [...new Set(modelList.flatMap((item) => Object.keys(item.usageFields)))].sort()

  return {
    generatedAt: new Date().toISOString(),
    logPath,
    logBytes: stat.size,
    parsedLineCount,
    skippedLineCount,
    modelCount: modelList.length,
    usageFieldKeys,
    totals,
    models: modelList,
  }
}

function createEmptySummary(logPath: string): ModelUsageSummary {
  return {
    generatedAt: new Date().toISOString(),
    logPath,
    logBytes: 0,
    parsedLineCount: 0,
    skippedLineCount: 0,
    modelCount: 0,
    usageFieldKeys: [],
    totals: createEmptyCounters(),
    models: [],
  }
}

function createEmptyCounters(): ModelUsageCounters {
  return { ...EMPTY_COUNTERS }
}

function createEmptyStats(model: string): MutableModelUsageModelStats {
  return {
    ...createEmptyCounters(),
    model,
    providerModels: [],
    usageFields: {},
    averageDurationMs: null,
    firstSeenAt: null,
    lastSeenAt: null,
    lastRequestAt: null,
    lastResponseAt: null,
    lastErrorAt: null,
  }
}

function getOrCreateStats(
  models: Map<string, MutableModelUsageModelStats>,
  model: string
): MutableModelUsageModelStats {
  const existing = models.get(model)
  if (existing) {
    return existing
  }
  const created = createEmptyStats(model)
  models.set(model, created)
  return created
}

function isModelLogEntry(value: unknown): value is ModelLogEntry {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    (record.kind === 'request' || record.kind === 'response' || record.kind === 'error') &&
    typeof record.timestamp === 'string' &&
    typeof record.requestId === 'string' &&
    typeof record.model === 'string'
  )
}

function normalizeUsage(payload: Record<string, unknown> | null): NormalizedUsage {
  const payloadUsage = asRecord(payload?.usage)
  const rawUsage = readRawUsage(payload)
  const usageFields: Record<string, number> = {}
  flattenNumericFields(rawUsage || payloadUsage, '', usageFields)

  return {
    inputTokens: firstNumber(
      payloadUsage?.input_tokens,
      payloadUsage?.inputTokens,
      rawUsage?.prompt_tokens,
      rawUsage?.input_tokens
    ),
    outputTokens: firstNumber(
      payloadUsage?.output_tokens,
      payloadUsage?.outputTokens,
      rawUsage?.completion_tokens,
      rawUsage?.output_tokens
    ),
    totalTokens: firstNumber(
      payloadUsage?.total_tokens,
      payloadUsage?.totalTokens,
      rawUsage?.total_tokens
    ),
    cachedTokens: firstNumber(
      payloadUsage?.cached_tokens,
      payloadUsage?.cache_read_tokens,
      numberAt(rawUsage, ['prompt_tokens_details', 'cached_tokens']),
      numberAt(rawUsage, ['input_tokens_details', 'cached_tokens'])
    ),
    cacheWriteTokens: firstNumber(
      payloadUsage?.cache_write_tokens,
      numberAt(rawUsage, ['prompt_tokens_details', 'cache_write_tokens']),
      numberAt(rawUsage, ['input_tokens_details', 'cache_write_tokens'])
    ),
    reasoningTokens: firstNumber(
      payloadUsage?.reasoning_tokens,
      numberAt(rawUsage, ['completion_tokens_details', 'reasoning_tokens']),
      numberAt(rawUsage, ['output_tokens_details', 'reasoning_tokens'])
    ),
    cost: firstNumber(payloadUsage?.cost, rawUsage?.cost),
    usageFields,
  }
}

function readRawUsage(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  const raw = asRecord(payload?.raw)
  const rawBody = asRecord(raw?.body)
  const rawBodyUsage = asRecord(rawBody?.usage)
  if (rawBodyUsage) {
    return rawBodyUsage
  }

  const rawUsage = asRecord(raw?.usage)
  if (rawUsage) {
    return rawUsage
  }

  const payloadUsage = asRecord(payload?.usage)
  const nestedRawUsage = asRecord(payloadUsage?.raw_usage)
  return nestedRawUsage
}

function readProviderModel(payload: Record<string, unknown> | null): string | null {
  const raw = asRecord(payload?.raw)
  const body = asRecord(raw?.body)
  const bodyModel = typeof body?.model === 'string' ? body.model.trim() : ''
  if (bodyModel) {
    return bodyModel
  }
  const rawModel = typeof raw?.model === 'string' ? raw.model.trim() : ''
  return rawModel || null
}

function noteSeenAt(stats: MutableModelUsageModelStats, timestamp: string) {
  stats.firstSeenAt = earliestIso(stats.firstSeenAt, timestamp)
  stats.lastSeenAt = latestIso(stats.lastSeenAt, timestamp)
}

function earliestIso(current: string | null, candidate: string): string {
  if (!current) {
    return candidate
  }
  return Date.parse(candidate) < Date.parse(current) ? candidate : current
}

function latestIso(current: string | null, candidate: string): string {
  if (!current) {
    return candidate
  }
  return Date.parse(candidate) > Date.parse(current) ? candidate : current
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    const number = finiteNumber(value)
    if (number !== null) {
      return number
    }
  }
  return 0
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function numberAt(record: Record<string, unknown> | null, path: string[]): number | null {
  let current: unknown = record
  for (const key of path) {
    const currentRecord = asRecord(current)
    if (!currentRecord) {
      return null
    }
    current = currentRecord[key]
  }
  return finiteNumber(current)
}

function flattenNumericFields(
  value: unknown,
  prefix: string,
  output: Record<string, number>,
  depth = 0
) {
  const number = finiteNumber(value)
  if (number !== null && prefix) {
    output[prefix] = (output[prefix] || 0) + number
    return
  }

  if (depth >= 6 || !value || typeof value !== 'object' || Array.isArray(value)) {
    return
  }

  for (const [key, item] of Object.entries(value)) {
    const field = prefix ? `${prefix}.${key}` : key
    flattenNumericFields(item, field, output, depth + 1)
  }
}

function mergeNumericFields(target: Record<string, number>, source: Record<string, number>) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] || 0) + value
  }
}

function sortRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
