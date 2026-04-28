import type { AgentContentBlock, AgentMessage, ToolDefinition } from '../agent/types.js'
import { collapseWhitespace, truncate } from '../utils/helpers.js'

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string | AgentContentBlock[]
}

export type ContextCompressionMode = 'none' | 'partial' | 'full'

export interface ContextCompressionConfig {
  maxTokens: number
  softThresholdRatio: number
  hardThresholdRatio: number
  partialKeepRecentTurns: number
  fullKeepRecentTurns: number
}

export interface ContextWindowState {
  maxTokens: number
  rawTokens: number
  effectiveTokens: number
  rawUsageRatio: number
  effectiveUsageRatio: number
  rawUsagePercent: number
  effectiveUsagePercent: number
  compressionMode: ContextCompressionMode
  recentTurnsKept: number
  summarizedMessages: number
  originalMessageCount: number
  effectiveMessageCount: number
  summaryTokens: number
}

export interface ContextPreparationResult {
  messages: AgentMessage[]
  state: ContextWindowState
}

export function prepareContextWindow(params: {
  messages: HistoryMessage[]
  systemPrompt: string
  tools: ToolDefinition[]
  config: ContextCompressionConfig
}): ContextPreparationResult {
  const rawMessages = toAgentMessages(params.messages)
  const rawTokens = estimateConversationTokens({
    systemPrompt: params.systemPrompt,
    tools: params.tools,
    messages: rawMessages,
  })
  const rawUsageRatio = ratio(rawTokens, params.config.maxTokens)

  if (rawUsageRatio < params.config.softThresholdRatio) {
    return {
      messages: rawMessages,
      state: buildState({
        config: params.config,
        rawTokens,
        effectiveTokens: rawTokens,
        compressionMode: 'none',
        recentTurnsKept: countUserTurns(params.messages),
        summarizedMessages: 0,
        originalMessageCount: params.messages.length,
        effectiveMessageCount: rawMessages.length,
        summaryTokens: 0,
      }),
    }
  }

  if (rawUsageRatio > params.config.hardThresholdRatio) {
    return buildCompressedContext({
      ...params,
      rawTokens,
      compressionMode: 'full',
      keepRecentTurns: params.config.fullKeepRecentTurns,
      summaryBudgetTokens: Math.max(256, Math.floor(params.config.maxTokens * 0.1)),
    })
  }

  const partial = buildCompressedContext({
    ...params,
    rawTokens,
    compressionMode: 'partial',
    keepRecentTurns: params.config.partialKeepRecentTurns,
    summaryBudgetTokens: Math.max(384, Math.floor(params.config.maxTokens * 0.18)),
  })

  if (partial.state.effectiveUsageRatio > params.config.hardThresholdRatio) {
    return buildCompressedContext({
      ...params,
      rawTokens,
      compressionMode: 'full',
      keepRecentTurns: params.config.fullKeepRecentTurns,
      summaryBudgetTokens: Math.max(256, Math.floor(params.config.maxTokens * 0.1)),
    })
  }

  return partial
}

export function estimateConversationTokens(params: {
  systemPrompt: string
  tools: ToolDefinition[]
  messages: AgentMessage[]
}): number {
  const systemTokens = estimateTokens(params.systemPrompt)
  const toolTokens = params.tools.reduce((total, tool) => {
    return total + estimateTokens(JSON.stringify({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    }))
  }, 0)
  const messageTokens = params.messages.reduce((total, message) => {
    const content = typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content)
    return total + estimateTokens(content) + 6
  }, 0)

  return systemTokens + toolTokens + messageTokens + 24
}

function buildCompressedContext(params: {
  messages: HistoryMessage[]
  systemPrompt: string
  tools: ToolDefinition[]
  config: ContextCompressionConfig
  rawTokens: number
  compressionMode: 'partial' | 'full'
  keepRecentTurns: number
  summaryBudgetTokens: number
}): ContextPreparationResult {
  const split = splitByRecentUserTurns(params.messages, params.keepRecentTurns)
  const summaryText = buildSummaryText(split.older, params.summaryBudgetTokens)
  const compressedMessages: AgentMessage[] = []

  if (summaryText) {
    compressedMessages.push({
      role: 'assistant',
      content: summaryText,
    })
  }
  compressedMessages.push(...toAgentMessages(split.recent))

  const effectiveTokens = estimateConversationTokens({
    systemPrompt: params.systemPrompt,
    tools: params.tools,
    messages: compressedMessages,
  })

  return {
    messages: compressedMessages,
    state: buildState({
      config: params.config,
      rawTokens: params.rawTokens,
      effectiveTokens,
      compressionMode: params.compressionMode,
      recentTurnsKept: params.keepRecentTurns,
      summarizedMessages: split.older.length,
      originalMessageCount: params.messages.length,
      effectiveMessageCount: compressedMessages.length,
      summaryTokens: summaryText ? estimateTokens(summaryText) : 0,
    }),
  }
}

function buildState(params: {
  config: ContextCompressionConfig
  rawTokens: number
  effectiveTokens: number
  compressionMode: ContextCompressionMode
  recentTurnsKept: number
  summarizedMessages: number
  originalMessageCount: number
  effectiveMessageCount: number
  summaryTokens: number
}): ContextWindowState {
  const rawUsageRatio = ratio(params.rawTokens, params.config.maxTokens)
  const effectiveUsageRatio = ratio(params.effectiveTokens, params.config.maxTokens)

  return {
    maxTokens: params.config.maxTokens,
    rawTokens: params.rawTokens,
    effectiveTokens: params.effectiveTokens,
    rawUsageRatio,
    effectiveUsageRatio,
    rawUsagePercent: Math.round(rawUsageRatio * 100),
    effectiveUsagePercent: Math.round(effectiveUsageRatio * 100),
    compressionMode: params.compressionMode,
    recentTurnsKept: params.recentTurnsKept,
    summarizedMessages: params.summarizedMessages,
    originalMessageCount: params.originalMessageCount,
    effectiveMessageCount: params.effectiveMessageCount,
    summaryTokens: params.summaryTokens,
  }
}

function splitByRecentUserTurns(messages: HistoryMessage[], keepTurns: number): {
  older: HistoryMessage[]
  recent: HistoryMessage[]
} {
  if (keepTurns <= 0) {
    return {
      older: messages,
      recent: [],
    }
  }

  let userTurnsSeen = 0
  let splitIndex = 0

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user' && !isToolResultOnlyMessage(message)) {
      userTurnsSeen += 1
      if (userTurnsSeen === keepTurns) {
        splitIndex = index
        return {
          older: messages.slice(0, splitIndex),
          recent: messages.slice(splitIndex),
        }
      }
    }
  }

  return {
    older: [],
    recent: messages,
  }
}

function buildSummaryText(messages: HistoryMessage[], targetTokens: number): string {
  if (messages.length === 0) {
    return ''
  }

  const turns = groupTurns(messages)
  const charBudget = Math.max(320, targetTokens * 4)
  const header = [
    'Compressed earlier conversation summary:',
    '- Preserve factual decisions, user preferences, file paths, errors, and unresolved tasks from these earlier turns.',
  ]

  const lines = [...header]
  let usedChars = lines.join('\n').length + 1
  let includedTurns = 0

  for (let index = 0; index < turns.length; index += 1) {
    const turnsLeft = turns.length - index
    const remainingBudget = charBudget - usedChars
    if (remainingBudget < 120) {
      break
    }

    const perTurnBudget = Math.max(120, Math.min(420, Math.floor(remainingBudget / turnsLeft)))
    const userSummary = summarizeTurnPart(turns[index]?.userParts || [], Math.floor(perTurnBudget * 0.42))
    const assistantSummary = summarizeTurnPart(turns[index]?.assistantParts || [], Math.floor(perTurnBudget * 0.58))
    const turnLines = [`- Turn ${index + 1}:`]
    if (userSummary) {
      turnLines.push(`  user: ${userSummary}`)
    }
    if (assistantSummary) {
      turnLines.push(`  assistant: ${assistantSummary}`)
    }

    const turnText = turnLines.join('\n')
    if (usedChars + turnText.length > charBudget && includedTurns > 0) {
      break
    }

    lines.push(turnText)
    usedChars += turnText.length + 1
    includedTurns += 1
  }

  const omittedTurns = turns.length - includedTurns
  if (omittedTurns > 0 && usedChars < charBudget - 40) {
    lines.push(`- ${omittedTurns} older turn(s) omitted after compression.`)
  }

  return truncate(lines.join('\n'), charBudget)
}

function groupTurns(messages: HistoryMessage[]): Array<{
  userParts: string[]
  assistantParts: string[]
}> {
  const turns: Array<{ userParts: string[]; assistantParts: string[] }> = []
  let currentTurn: { userParts: string[]; assistantParts: string[] } | null = null

  for (const message of messages) {
    const content = historyMessageToText(message)
    if (message.role === 'user' && !isToolResultOnlyMessage(message)) {
      currentTurn = {
        userParts: [content],
        assistantParts: [],
      }
      turns.push(currentTurn)
      continue
    }

    if (!currentTurn) {
      currentTurn = {
        userParts: [],
        assistantParts: [],
      }
      turns.push(currentTurn)
    }
    currentTurn.assistantParts.push(content)
  }

  return turns
}

function summarizeTurnPart(parts: string[], maxChars: number): string {
  if (parts.length === 0 || maxChars <= 0) {
    return ''
  }
  const merged = collapseWhitespace(parts.join(' '))
  if (!merged) {
    return ''
  }
  return truncate(merged, maxChars)
}

function toAgentMessages(messages: HistoryMessage[]): AgentMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }))
}

function countUserTurns(messages: HistoryMessage[]): number {
  return messages.filter((message) => {
    return message.role === 'user' && !isToolResultOnlyMessage(message)
  }).length
}

function historyMessageToText(message: HistoryMessage): string {
  if (typeof message.content === 'string') {
    return message.content
  }
  return message.content.map((block) => {
    if (block.type === 'text') {
      return block.text
    }
    if (block.type === 'tool_use') {
      return `Tool call ${block.name}: ${JSON.stringify(block.input)}`
    }
    const label = block.tool_name || block.tool_use_id
    const status = block.is_error ? 'error' : 'ok'
    return `Tool result ${label} (${status}): ${block.content}`
  }).join('\n')
}

function isToolResultOnlyMessage(message: HistoryMessage): boolean {
  return Array.isArray(message.content) && message.content.length > 0 && message.content.every((block) => block.type === 'tool_result')
}

function estimateTokens(value: unknown): number {
  const text = typeof value === 'string'
    ? value
    : JSON.stringify(value)
  return Math.max(1, Math.ceil(String(text || '').length / 4))
}

function ratio(value: number, total: number): number {
  if (total <= 0) {
    return 0
  }
  return Math.max(0, Math.min(1, value / total))
}
