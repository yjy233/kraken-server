/**
 * 模型调用层
 * 通过 @ai-sdk/openai 以 OpenAI 兼容协议对接 OpenRouter，
 * 支持任意 OpenRouter 上的模型（如 anthropic/claude-sonnet-4、openai/gpt-4o 等）。
 */

import { generateText, jsonSchema, type Tool, type ModelMessage, type TextPart, type ToolCallPart, type ToolResultPart } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import type { AgentMessage, AgentContentBlock, ToolDefinition, ModelResponse, ToolResultBlock, ToolUseBlock } from './types.js'

const OPENROUTER_BASE_URL = normalizeBaseUrl(process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1')
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''

/** 去掉 URL 末尾多余的斜杠 */
function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

/** 创建 OpenRouter 提供者实例 */
function getOpenRouterProvider() {
  const options: { baseURL?: string; apiKey?: string; headers?: Record<string, string>; name?: string } = {
    name: 'openrouter',
  }
  if (OPENROUTER_BASE_URL) options.baseURL = OPENROUTER_BASE_URL
  if (OPENROUTER_API_KEY) options.apiKey = OPENROUTER_API_KEY
  // OpenRouter 推荐发送 Referer 和 App Title，用于统计与排名
  options.headers = {
    'HTTP-Referer': process.env.OPENROUTER_REFERER || 'http://localhost',
    'X-Title': process.env.OPENROUTER_APP_TITLE || 'Kraken Agent',
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

  const result = await generateText(generateOptions)

  const toolUses = result.toolCalls.map((tc) => ({
    id: tc.toolCallId,
    name: tc.toolName,
    input: tc.input as Record<string, unknown>,
  }))

  const usage: Record<string, unknown> = {
    input_tokens: result.usage.inputTokens ?? 0,
    output_tokens: result.usage.outputTokens ?? 0,
    total_tokens: result.usage.totalTokens ?? 0,
  }

  return {
    text: result.text,
    toolUses,
    usage,
    stopReason: result.finishReason,
    raw: result.response,
  }
}
