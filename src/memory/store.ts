import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { MemoryCandidate, MemoryRecord, MemoryScope } from './types.js'

const MAX_MEMORY_TEXT_LENGTH = 2000

export interface MemoryStore {
  addCandidate(candidate: MemoryCandidate): Promise<MemoryRecord | null>
  list(scope?: MemoryScope): Promise<MemoryRecord[]>
  search(input: {
    scope: MemoryScope
    query: string
    limit?: number
  }): Promise<Array<{ record: MemoryRecord; score: number }>>
}

export function createMemoryStore(memoryDir: string): MemoryStore {
  mkdirSync(memoryDir, { recursive: true })
  const memoryPath = path.join(memoryDir, 'memories.jsonl')

  async function addCandidate(candidate: MemoryCandidate): Promise<MemoryRecord | null> {
    const text = normalizeMemoryText(candidate.text)
    if (!text || containsSecret(text)) {
      return null
    }

    const existing = await list(candidate.scope)
    const duplicate = existing.find((record) => normalizeComparable(record.text) === normalizeComparable(text))
    const timestamp = new Date().toISOString()

    if (duplicate) {
      const updated: MemoryRecord = {
        ...duplicate,
        confidence: Math.max(duplicate.confidence, candidate.confidence),
        importance: Math.max(duplicate.importance, candidate.importance),
        tags: Array.from(new Set([...duplicate.tags, ...candidate.tags])),
        updatedAt: timestamp,
      }
      await rewriteRecords((await list()).map((record) => record.id === updated.id ? updated : record))
      return updated
    }

    const record: MemoryRecord = {
      id: crypto.randomUUID(),
      scope: candidate.scope,
      kind: candidate.kind,
      text,
      tags: candidate.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 12),
      confidence: clamp01(candidate.confidence),
      importance: clamp01(candidate.importance),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    if (candidate.sourceSessionId) record.sourceSessionId = candidate.sourceSessionId
    if (candidate.sourceRunId) record.sourceRunId = candidate.sourceRunId
    if (candidate.sourceMessageIds && candidate.sourceMessageIds.length > 0) {
      record.sourceMessageIds = candidate.sourceMessageIds
    }

    await appendJsonLine(memoryPath, record)
    return record
  }

  async function list(scope?: MemoryScope): Promise<MemoryRecord[]> {
    const records = await readJsonLines<MemoryRecord>(memoryPath)
    const valid = records.filter(isMemoryRecord)
    if (!scope) {
      return valid
    }
    return valid.filter((record) => record.scope.type === scope.type && record.scope.key === scope.key)
  }

  async function search(input: {
    scope: MemoryScope
    query: string
    limit?: number
  }): Promise<Array<{ record: MemoryRecord; score: number }>> {
    const queryTerms = tokenize(input.query)
    const records = await list(input.scope)
    const scored = records.map((record) => {
      const haystack = tokenize([
        record.text,
        record.kind,
        record.tags.join(' '),
      ].join(' '))
      const termScore = queryTerms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0)
      const tagScore = record.tags.some((tag) => queryTerms.includes(tag.toLowerCase())) ? 1 : 0
      const recencyScore = record.lastUsedAt ? 0.2 : 0
      return {
        record,
        score: termScore + tagScore + record.importance + record.confidence + recencyScore,
      }
    })
      .filter((item) => item.score > 0.2)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, Math.min(input.limit || 6, 12)))

    if (scored.length > 0) {
      const timestamp = new Date().toISOString()
      const hitIds = new Set(scored.map((item) => item.record.id))
      const all = await list()
      await rewriteRecords(all.map((record) => hitIds.has(record.id)
        ? { ...record, lastUsedAt: timestamp }
        : record
      ))
    }

    return scored
  }

  async function rewriteRecords(records: MemoryRecord[]): Promise<void> {
    await fs.mkdir(path.dirname(memoryPath), { recursive: true })
    const tmpPath = `${memoryPath}.${process.pid}.tmp`
    const body = records.map((record) => JSON.stringify(record)).join('\n')
    await fs.writeFile(tmpPath, body ? `${body}\n` : '', 'utf8')
    await fs.rename(tmpPath, memoryPath)
  }

  return {
    addCandidate,
    list,
    search,
  }
}

async function appendJsonLine(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8')
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  if (!existsSync(filePath)) {
    return []
  }
  const raw = await fs.readFile(filePath, 'utf8')
  return raw.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as T
      } catch {
        return null
      }
    })
    .filter((item): item is T => Boolean(item))
}

function isMemoryRecord(value: unknown): value is MemoryRecord {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Partial<MemoryRecord>
  return typeof record.id === 'string' &&
    typeof record.text === 'string' &&
    Boolean(record.scope && typeof record.scope === 'object') &&
    typeof record.scope?.type === 'string' &&
    typeof record.scope?.key === 'string'
}

function normalizeMemoryText(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MEMORY_TEXT_LENGTH)
}

function normalizeComparable(value: string): string {
  return normalizeMemoryText(value).toLowerCase()
}

function tokenize(value: string): string[] {
  return Array.from(new Set(value
    .toLowerCase()
    .split(/[^a-z0-9_\-\u4e00-\u9fff]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
  ))
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(1, value))
}

function containsSecret(value: string): boolean {
  return [
    /sk-[a-z0-9_-]{20,}/i,
    /sk-or-v1-[a-z0-9]{40,}/i,
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
    /xox[baprs]-[a-z0-9-]+/i,
  ].some((pattern) => pattern.test(value))
}
