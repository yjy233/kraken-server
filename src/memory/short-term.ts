import { collapseWhitespace, truncate } from '../utils/helpers.js'
import type { SessionMemoryFailure, SessionMemoryState } from './types.js'
import type { CompletedRunForMemory } from './types.js'

export function createEmptySessionMemoryState(now = new Date()): SessionMemoryState {
  return {
    summary: '',
    goals: [],
    decisions: [],
    openItems: [],
    userPreferences: [],
    relevantFiles: [],
    recentFailures: [],
    updatedAt: now.toISOString(),
  }
}

export function updateSessionMemory(input: {
  current?: SessionMemoryState | undefined
  completedRun: CompletedRunForMemory
}): SessionMemoryState {
  const now = new Date().toISOString()
  const current = normalizeSessionMemory(input.current)
  const userText = messageContentToText(input.completedRun.userMessage.content)
  const assistantText = input.completedRun.assistantMessages
    .map((message) => messageContentToText(message.content))
    .join('\n')

  const summaryParts = [
    current.summary,
    userText ? `User asked: ${truncate(collapseWhitespace(userText), 240)}` : '',
    assistantText ? `Assistant replied: ${truncate(collapseWhitespace(assistantText), 320)}` : '',
  ].filter(Boolean)

  const recentFailures = [
    ...input.completedRun.toolExecutions
      .filter((execution) => execution.isError)
      .map((execution) => ({
        toolName: execution.toolName,
        inputPreview: '',
        error: truncate(collapseWhitespace(execution.output), 240),
        resolved: false,
        at: now,
      })),
    ...current.recentFailures,
  ].slice(0, 8)

  return {
    ...current,
    summary: truncate(summaryParts.join(' | '), 1400),
    goals: mergeItems(current.goals, extractGoalItems(userText), 8),
    decisions: mergeItems(current.decisions, extractDecisionItems(assistantText), 8),
    openItems: mergeItems(current.openItems, extractOpenItems(`${userText}\n${assistantText}`), 8),
    userPreferences: mergeItems(current.userPreferences, extractPreferenceItems(userText), 8),
    relevantFiles: mergeItems(current.relevantFiles, extractFilePaths(`${userText}\n${assistantText}`), 12),
    recentFailures,
    updatedAt: now,
  }
}

export function normalizeSessionMemory(value: unknown): SessionMemoryState {
  if (!value || typeof value !== 'object') {
    return createEmptySessionMemoryState()
  }
  const record = value as Partial<SessionMemoryState>
  return {
    summary: typeof record.summary === 'string' ? record.summary : '',
    goals: normalizeStringArray(record.goals),
    decisions: normalizeStringArray(record.decisions),
    openItems: normalizeStringArray(record.openItems),
    userPreferences: normalizeStringArray(record.userPreferences),
    relevantFiles: normalizeStringArray(record.relevantFiles),
    recentFailures: Array.isArray(record.recentFailures)
      ? record.recentFailures.map((failure): SessionMemoryFailure | null => {
        if (!failure || typeof failure !== 'object') {
          return null
        }
        const item = failure as unknown as Record<string, unknown>
        const toolName = typeof item.toolName === 'string' ? item.toolName.trim() : ''
        const error = typeof item.error === 'string' ? item.error.trim() : ''
        if (!toolName || !error) {
          return null
        }
        const normalized: SessionMemoryFailure = {
          toolName,
          inputPreview: typeof item.inputPreview === 'string' ? item.inputPreview : '',
          error,
          at: typeof item.at === 'string' ? item.at : new Date().toISOString(),
        }
        if (typeof item.resolved === 'boolean') {
          normalized.resolved = item.resolved
        }
        return normalized
      }).filter((failure): failure is SessionMemoryFailure => Boolean(failure)).slice(0, 8)
      : [],
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString(),
  }
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 20)
    : []
}

function mergeItems(existing: string[], next: string[], limit: number): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const value of [...next, ...existing]) {
    const normalized = collapseWhitespace(value)
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) {
      continue
    }
    seen.add(key)
    merged.push(truncate(normalized, 180))
    if (merged.length >= limit) {
      break
    }
  }
  return merged
}

function extractGoalItems(text: string): string[] {
  if (!text) return []
  if (/实现|支持|修复|生成|设计|build|implement|fix|create|add/i.test(text)) {
    return [truncate(collapseWhitespace(text), 180)]
  }
  return []
}

function extractDecisionItems(text: string): string[] {
  const matches = text.match(/(?:决定|采用|建议|推荐|implemented|added|fixed)[^。.\n]{4,120}/gi)
  return matches ? matches.slice(0, 4) : []
}

function extractOpenItems(text: string): string[] {
  const matches = text.match(/(?:todo|next|后续|待办|需要|pending)[^。.\n]{4,120}/gi)
  return matches ? matches.slice(0, 4) : []
}

function extractPreferenceItems(text: string): string[] {
  const matches = text.match(/(?:我希望|我想要|偏好|prefer|不要|先不要|以后)[^。.\n]{4,120}/gi)
  return matches ? matches.slice(0, 4) : []
}

function extractFilePaths(text: string): string[] {
  const matches = text.match(/(?:^|\s)(?:\.{0,2}\/)?[\w.-]+(?:\/[\w.@()[\]-]+)+/g)
  return matches ? matches.map((item) => item.trim()).slice(0, 8) : []
}

function messageContentToText(content: CompletedRunForMemory['userMessage']['content']): string {
  if (typeof content === 'string') {
    return content
  }
  return content.map((block) => {
    if (block.type === 'text') return block.text
    if (block.type === 'image') return `[image${block.filename ? `: ${block.filename}` : ''}]`
    if (block.type === 'tool_use') return `Tool call ${block.name}: ${JSON.stringify(block.input)}`
    return `Tool result ${block.tool_name || block.tool_use_id}: ${block.content}`
  }).join('\n')
}
