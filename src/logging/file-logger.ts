import fs from 'node:fs/promises'
import path from 'node:path'

const LOG_DIR = path.resolve(process.cwd(), 'logs')
const MODEL_LOG_PATH = path.join(LOG_DIR, 'model.jsonl')
const MAX_SERIALIZE_DEPTH = 8

let ensureLogDirPromise: Promise<void> | null = null

export type ModelLogKind = 'request' | 'response' | 'error'

export interface ModelLogEntry {
  kind: ModelLogKind
  timestamp: string
  requestId: string
  model: string
  durationMs?: number
  payload: unknown
}

function ensureLogDir(): Promise<void> {
  if (!ensureLogDirPromise) {
    ensureLogDirPromise = fs.mkdir(LOG_DIR, { recursive: true }).then(() => undefined)
  }
  return ensureLogDirPromise
}

function toSerializable(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (typeof value === 'undefined') {
    return '[undefined]'
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`
  }

  if (typeof value === 'symbol') {
    return value.toString()
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: toSerializable(value.cause, depth + 1, seen),
    }
  }

  if (depth >= MAX_SERIALIZE_DEPTH) {
    return '[MaxDepthExceeded]'
  }

  if (Array.isArray(value)) {
    return value.map((item) => toSerializable(item, depth + 1, seen))
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]'
    }

    seen.add(value)

    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      output[key] = toSerializable(item, depth + 1, seen)
    }

    seen.delete(value)
    return output
  }

  return String(value)
}

export async function appendModelLog(entry: ModelLogEntry): Promise<void> {
  try {
    await ensureLogDir()
    const line = JSON.stringify(toSerializable(entry)) + '\n'
    await fs.appendFile(MODEL_LOG_PATH, line, 'utf8')
  } catch (error) {
    console.error('Failed to write model log entry', error)
  }
}

export function getModelLogPath(): string {
  return MODEL_LOG_PATH
}
