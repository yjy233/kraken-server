/**
 * 前端类型定义
 */

export interface Config {
  appTitle: string
  configured: boolean
  model: string
  defaultSystemPrompt: string
  maxAgentSteps: number
  tools: ToolInfo[]
}

export interface ToolInfo {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface Session {
  id: string
  title: string
  model: string
  systemPrompt: string
  createdAt: string
  updatedAt: string
  messages: SessionMessage[]
}

export interface SessionSummary {
  id: string
  title: string
  model: string
  createdAt: string
  updatedAt: string
  messageCount: number
  preview: string
  lastRole: string | null
}

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface RuntimeEvent {
  event: string
  data: unknown
  at: string
}

export interface RunResult {
  id: string
  sessionId: string
  createdAt: string
  model: string
  steps: Array<{
    step: number
    stopReason: string | null
    assistantText: string
    toolUseCount: number
  }>
  finalText: string
  usage: Array<Record<string, unknown> | null>
  toolExecutions: Array<{
    toolUseId: string
    toolName: string
    isError: boolean
    output: string
  }>
}

export interface StreamCompleteData {
  ok: boolean
  reply: string
  session: Session
  run: RunResult
}
