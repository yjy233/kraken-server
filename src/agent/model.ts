/**
 * 模型调用层
 * 通过 @ai-sdk/openai 以 OpenAI 兼容协议对接 OpenRouter，
 * 支持任意 OpenRouter 上的模型（如 anthropic/claude-sonnet-4、openai/gpt-4o 等）。
 */

import { generateText, jsonSchema, type Tool, type ModelMessage, type TextPart, type ToolCallPart, type ToolResultPart } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import type { AgentMessage, AgentContentBlock, ToolDefinition, ModelResponse, ToolResultBlock, ToolUseBlock } from './types.js'
import { appendModelLog } from '../logging/file-logger.js'

const OPENROUTER_BASE_URL = normalizeBaseUrl(process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1')
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const OPENROUTER_PROMPT_CACHE = parseBoolean(process.env.OPENROUTER_PROMPT_CACHE, true)
const OPENROUTER_PROMPT_CACHE_TYPE = process.env.OPENROUTER_PROMPT_CACHE_TYPE || 'ephemeral'

type OpenRouterMessage = {
  role?: unknown
  content?: unknown
}

type OpenRouterTextPart = {
  type?: unknown
  text?: unknown
  cache_control?: unknown
}

/** 去掉 URL 末尾多余的斜杠 */
function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

/** 创建 OpenRouter 提供者实例 */
function getOpenRouterProvider() {
  const options: {
    baseURL?: string
    apiKey?: string
    headers?: Record<string, string>
    name?: string
    fetch?: typeof globalThis.fetch
  } = {
    name: 'openrouter',
  }
  if (OPENROUTER_BASE_URL) options.baseURL = OPENROUTER_BASE_URL
  if (OPENROUTER_API_KEY) options.apiKey = OPENROUTER_API_KEY
  // OpenRouter 推荐发送 Referer 和 App Title，用于统计与排名
  options.headers = {
    'HTTP-Referer': process.env.OPENROUTER_REFERER || 'http://localhost',
    'X-Title': process.env.OPENROUTER_APP_TITLE || 'Kraken Agent',
  }
  if (OPENROUTER_PROMPT_CACHE && isOpenRouterBaseUrl(OPENROUTER_BASE_URL)) {
    options.fetch = openRouterPromptCacheFetch
  }
  return createOpenAI(options)
}

/**
 * 解析模型 ID 并返回对应的 LanguageModel 实例。
 * 由于使用 OpenRouter，所有模型都走同一条 OpenAI 兼容通道，无需按前缀分流。
 */
export function resolveLanguageModel(modelId: string) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not configured. Add it to .env or your shell environment.')
  }
  const provider = getOpenRouterProvider()
  return provider.chat(modelId)
}

/**
 * 将内部 ToolDefinition[] 转换为 AI SDK 所需的 ToolSet。
 * 这里不设置 execute，因为工具执行由外层 loopQuery 手动控制，以便 emit 事件。
 */
function convertTools(tools: ToolDefinition[]): Record<string, Tool> {
  const result: Record<string, Tool> = {}
  for (const t of tools) {
    result[t.name] = {
      description: t.description,
      inputSchema: jsonSchema(t.input_schema as any),
    }
  }
  return result
}

/**
 * 将内部 AgentMessage[] 转换为 AI SDK 的 ModelMessage[]。
 * 关键处理：
 * - assistant 的 tool_use 块 → tool-call parts
 * - user 的 tool_result 块 → tool-result parts
 */
function convertMessages(messages: AgentMessage[]): ModelMessage[] {
  const result: ModelMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'user', content: msg.content })
      } else {
        const toolResults: ToolResultPart[] = []
        for (const block of msg.content as AgentContentBlock[]) {
          if (block.type === 'tool_result') {
            toolResults.push({
              type: 'tool-result',
              toolCallId: block.tool_use_id,
              toolName: block.tool_name || 'unknown',
              output: block.is_error
                ? { type: 'error-text', value: block.content }
                : { type: 'text', value: block.content },
            })
          }
        }
        if (toolResults.length > 0) {
          result.push({ role: 'tool', content: toolResults })
        }
      }
      continue
    }

    if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'assistant', content: msg.content })
      } else {
        const parts: Array<TextPart | ToolCallPart> = []
        for (const block of msg.content as AgentContentBlock[]) {
          if (block.type === 'text') {
            parts.push({ type: 'text', text: block.text })
          } else if (block.type === 'tool_use') {
            parts.push({
              type: 'tool-call',
              toolCallId: block.id,
              toolName: block.name,
              input: block.input,
            })
          }
        }
        result.push({ role: 'assistant', content: parts })
      }
      continue
    }
  }

  return result
}

function summarizeTools(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input_schema,
  }))
}

function createUsageRecord(result: {
  usage: {
    inputTokens?: number | null | undefined
    outputTokens?: number | null | undefined
    totalTokens?: number | null | undefined
  }
  response?: unknown
}): Record<string, unknown> {
  const rawUsage = readRawUsage(result.response)
  const usage: Record<string, unknown> = {
    input_tokens: firstNumber(
      result.usage.inputTokens,
      rawUsage?.prompt_tokens,
      rawUsage?.input_tokens
    ),
    output_tokens: firstNumber(
      result.usage.outputTokens,
      rawUsage?.completion_tokens,
      rawUsage?.output_tokens
    ),
    total_tokens: firstNumber(
      result.usage.totalTokens,
      rawUsage?.total_tokens
    ),
  }

  const cachedTokens = firstNumberOrNull(
    numberAt(rawUsage, ['prompt_tokens_details', 'cached_tokens']),
    numberAt(rawUsage, ['input_tokens_details', 'cached_tokens'])
  )
  if (cachedTokens !== null) {
    usage.cached_tokens = cachedTokens
  }

  const cacheWriteTokens = firstNumberOrNull(
    numberAt(rawUsage, ['prompt_tokens_details', 'cache_write_tokens']),
    numberAt(rawUsage, ['input_tokens_details', 'cache_write_tokens'])
  )
  if (cacheWriteTokens !== null) {
    usage.cache_write_tokens = cacheWriteTokens
  }

  const reasoningTokens = firstNumberOrNull(
    numberAt(rawUsage, ['completion_tokens_details', 'reasoning_tokens']),
    numberAt(rawUsage, ['output_tokens_details', 'reasoning_tokens'])
  )
  if (reasoningTokens !== null) {
    usage.reasoning_tokens = reasoningTokens
  }

  const cost = firstNumberOrNull(rawUsage?.cost)
  if (cost !== null) {
    usage.cost = cost
  }

  if (rawUsage) {
    usage.raw_usage = rawUsage
  }

  return usage
}

function readRawUsage(response: unknown): Record<string, unknown> | null {
  const raw = asRecord(response)
  const rawBody = asRecord(raw?.body)
  const rawBodyUsage = asRecord(rawBody?.usage)
  if (rawBodyUsage) {
    return rawBodyUsage
  }
  return asRecord(raw?.usage)
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

function firstNumber(...values: unknown[]): number {
  return firstNumberOrNull(...values) ?? 0
}

function firstNumberOrNull(...values: unknown[]): number | null {
  for (const value of values) {
    const number = finiteNumber(value)
    if (number !== null) {
      return number
    }
  }
  return null
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback
  }
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function isOpenRouterBaseUrl(value: string): boolean {
  try {
    return new URL(value).hostname === 'openrouter.ai'
  } catch {
    return false
  }
}

async function openRouterPromptCacheFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof init?.body !== 'string') {
    return fetch(input, init)
  }

  const body = addOpenRouterPromptCacheControl(init.body)
  return fetch(input, {
    ...init,
    body,
  })
}

function addOpenRouterPromptCacheControl(body: string): string {
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return body
  }

  const record = asRecord(payload)
  if (!record) {
    return body
  }
  if (!shouldApplyOpenRouterPromptCache(record.model)) {
    return body
  }
  const messages = Array.isArray(record?.messages) ? record.messages : null
  if (!messages || record.cache_control) {
    return body
  }

  if (!applyOpenRouterPromptCacheControl(messages)) {
    return body
  }

  return JSON.stringify(record)
}

function shouldApplyOpenRouterPromptCache(model: unknown): boolean {
  if (typeof model !== 'string') {
    return false
  }
  const modelId = model.trim().toLowerCase()
  return [
    'anthropic/',
    'google/gemini',
    'qwen/qwen-plus',
    'qwen/qwen3-max',
    'qwen/qwen3.6-plus',
    'qwen/qwen3-coder-plus',
    'qwen/qwen3-coder-flash',
    'deepseek/deepseek-v3.2',
  ].some((prefix) => modelId.startsWith(prefix))
}

function applyOpenRouterPromptCacheControl(messages: unknown[]): boolean {
  if (hasExistingCacheControl(messages)) {
    return false
  }

  const latestInputIndex = Math.max(
    findLatestMessageIndex(messages, 'user'),
    findLatestMessageIndex(messages, 'tool')
  )
  const maxIndex = latestInputIndex > 0 ? latestInputIndex - 1 : messages.length - 1
  const target = findLastTextTarget(messages, maxIndex, (message) => message.role !== 'tool')
    || findLastTextTarget(messages, maxIndex)

  if (!target) {
    return false
  }

  target.part.cache_control = { type: OPENROUTER_PROMPT_CACHE_TYPE }
  return true
}

function hasExistingCacheControl(messages: unknown[]): boolean {
  for (const item of messages) {
    const message = item as OpenRouterMessage | null
    const content = message?.content
    if (!Array.isArray(content)) {
      continue
    }
    for (const part of content) {
      if (asRecord(part)?.cache_control) {
        return true
      }
    }
  }
  return false
}

function findLatestMessageIndex(messages: unknown[], role: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as OpenRouterMessage | null
    if (message?.role === role) {
      return index
    }
  }
  return -1
}

function findLastTextTarget(
  messages: unknown[],
  maxIndex: number,
  predicate?: (message: OpenRouterMessage) => boolean
): { part: OpenRouterTextPart } | null {
  for (let index = maxIndex; index >= 0; index -= 1) {
    const message = messages[index] as OpenRouterMessage | null
    if (!message || (predicate && !predicate(message))) {
      continue
    }

    const content = message.content
    if (typeof content === 'string' && content.trim()) {
      message.content = [
        {
          type: 'text',
          text: content,
        },
      ]
      return { part: (message.content as OpenRouterTextPart[])[0]! }
    }

    if (!Array.isArray(content)) {
      continue
    }

    for (let partIndex = content.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = content[partIndex] as OpenRouterTextPart | null
      if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        return { part }
      }
    }
  }
  return null
}

/**
 * 调用大语言模型。
 * @returns 解析后的 ModelResponse，包含文本、工具请求、用量等。
 */
export async function invokeModel({
  model,
  systemPrompt,
  messages,
  tools,
  maxOutputTokens,
  timeout,
}: {
  model: string
  systemPrompt: string
  messages: AgentMessage[]
  tools: ToolDefinition[]
  maxOutputTokens: number
  timeout?: number
}): Promise<ModelResponse> {
  const requestId = crypto.randomUUID()
  const startedAt = Date.now()
  const languageModel = resolveLanguageModel(model)
  const aiTools = convertTools(tools)
  const aiMessages = convertMessages(messages)

  const generateOptions: any = {
    model: languageModel,
    system: systemPrompt,
    messages: aiMessages,
    tools: aiTools,
    maxOutputTokens,
  }
  if (timeout !== undefined) {
    generateOptions.timeout = timeout
  }

  await appendModelLog({
    kind: 'request',
    timestamp: new Date(startedAt).toISOString(),
    requestId,
    model,
    payload: {
      systemPrompt,
      messages: aiMessages,
      tools: summarizeTools(tools),
      maxOutputTokens,
      timeout: timeout ?? null,
    },
  })

  try {
    const result = await generateText(generateOptions)

    const toolUses = result.toolCalls.map((tc) => ({
      id: tc.toolCallId,
      name: tc.toolName,
      input: tc.input as Record<string, unknown>,
    }))

    const usage = createUsageRecord(result)

    await appendModelLog({
      kind: 'response',
      timestamp: new Date().toISOString(),
      requestId,
      model,
      durationMs: Date.now() - startedAt,
      payload: {
        text: result.text,
        toolUses,
        usage,
        stopReason: result.finishReason,
        raw: result.response,
      },
    })

    return {
      text: result.text,
      toolUses,
      usage,
      stopReason: result.finishReason,
      raw: result.response,
    }
  } catch (error) {
    await appendModelLog({
      kind: 'error',
      timestamp: new Date().toISOString(),
      requestId,
      model,
      durationMs: Date.now() - startedAt,
      payload: error,
    })

    throw error
  }
}
