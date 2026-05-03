import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { SessionSandboxConfig } from '../tools/types.js'
import {
  collapseWhitespace,
  isSafeSessionId,
  sanitizeTitle,
  truncate,
} from '../utils/helpers.js'
import type { AgentContentBlock, ContextWindowState } from '../agent/types.js'

export type SessionMessageContent = string | AgentContentBlock[]

export interface FeishuMessageMeta {
  provider: 'feishu'
  eventId?: string
  messageId: string
  rootMessageId?: string
  parentMessageId?: string
  threadId?: string
  chatId: string
  chatType: 'p2p' | 'group'
  senderId: string
  senderType?: string
  senderName?: string
  messageType: string
  createTime?: string
  conversationKey: string
  mentionBot: boolean
}

export interface SessionMessageMeta {
  source?: 'web' | 'feishu' | 'scheduler'
  feishu?: FeishuMessageMeta
}

export interface SessionMessageRecord {
  id: string
  role: 'user' | 'assistant'
  content: SessionMessageContent
  createdAt: string
  meta?: SessionMessageMeta | undefined
}

export interface SessionRecord {
  id: string
  title: string
  model: string
  systemPrompt: string
  sandbox?: SessionSandboxConfig | undefined
  loadedSkills?: string[] | undefined
  contextWindow?: ContextWindowState | undefined
  createdAt: string
  updatedAt: string
  messages: SessionMessageRecord[]
}

export interface SessionSummaryRecord {
  id: string
  title: string
  model: string
  sandbox?: SessionSandboxConfig | undefined
  loadedSkills?: string[] | undefined
  contextWindow?: ContextWindowState | undefined
  createdAt: string
  updatedAt: string
  messageCount: number
  preview: string
  lastRole: string | null
}

export function createSessionStore(params: {
  sessionDir: string
  defaultModel: string
  normalizeSystemPrompt: (value: string | undefined) => string
}) {
  const { sessionDir, defaultModel, normalizeSystemPrompt } = params
  mkdirSync(sessionDir, { recursive: true })

  function createSession(input: {
    id?: string | undefined
    title: string
    systemPrompt?: string | undefined
    model: string
    sandbox?: SessionSandboxConfig | undefined
    loadedSkills?: string[] | undefined
  }): SessionRecord {
    const timestamp = new Date().toISOString()
    return {
      id: input.id && isSafeSessionId(input.id) ? input.id : crypto.randomUUID(),
      title: sanitizeTitle(input.title) || 'New chat',
      model: input.model || defaultModel,
      systemPrompt: normalizeSystemPrompt(input.systemPrompt),
      sandbox: input.sandbox,
      loadedSkills: input.loadedSkills || [],
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    }
  }

  function summarizeSession(session: SessionRecord): SessionSummaryRecord {
    const lastMessage = session.messages.at(-1)
    return {
      id: session.id,
      title: session.title,
      model: session.model,
      sandbox: session.sandbox,
      loadedSkills: session.loadedSkills || [],
      contextWindow: session.contextWindow,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
      preview: lastMessage ? truncate(collapseWhitespace(messageContentPreview(lastMessage.content)), 100) : '',
      lastRole: lastMessage?.role ?? null,
    }
  }

  async function listSessions(): Promise<SessionSummaryRecord[]> {
    const entries = await fs.readdir(sessionDir, { withFileTypes: true })
    const sessions: SessionSummaryRecord[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue
      }
      try {
        const raw = await fs.readFile(path.join(sessionDir, entry.name), 'utf8')
        const session = JSON.parse(raw) as SessionRecord
        sessions.push(summarizeSession(normalizeSession(session)))
      } catch {
        continue
      }
    }
    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async function loadSession(sessionId: string): Promise<SessionRecord | null> {
    if (!isSafeSessionId(sessionId)) {
      return null
    }
    const filePath = sessionFilePath(sessionId)
    if (!existsSync(filePath)) {
      return null
    }
    const raw = await fs.readFile(filePath, 'utf8')
    return normalizeSession(JSON.parse(raw) as SessionRecord)
  }

  async function saveSession(session: SessionRecord): Promise<void> {
    await fs.writeFile(sessionFilePath(session.id), JSON.stringify(session, null, 2), 'utf8')
  }

  async function deleteSession(sessionId: string): Promise<void> {
    if (!isSafeSessionId(sessionId)) {
      return
    }
    const filePath = sessionFilePath(sessionId)
    if (existsSync(filePath)) {
      await fs.unlink(filePath)
    }
  }

  async function deleteAllSessions(): Promise<void> {
    const entries = await fs.readdir(sessionDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        const sessionId = entry.name.slice(0, -5)
        if (sessionId.startsWith('scheduled-')) {
          continue
        }
        await fs.unlink(path.join(sessionDir, entry.name))
      }
    }
  }

  function sessionFilePath(sessionId: string): string {
    return path.join(sessionDir, `${sessionId}.json`)
  }

  function normalizeSession(session: SessionRecord): SessionRecord {
    session.systemPrompt = normalizeSystemPrompt(session.systemPrompt)
    session.loadedSkills = Array.isArray(session.loadedSkills)
      ? session.loadedSkills.map((item) => String(item).trim()).filter(Boolean)
      : []
    session.messages = Array.isArray(session.messages)
      ? session.messages.map(normalizeMessageRecord).filter((message): message is SessionMessageRecord => Boolean(message))
      : []
    return session
  }

  return {
    createSession,
    summarizeSession,
    listSessions,
    loadSession,
    saveSession,
    deleteSession,
    deleteAllSessions,
    sessionFilePath,
  }
}

function normalizeMessageRecord(value: unknown): SessionMessageRecord | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as Partial<SessionMessageRecord>
  const role = record.role === 'assistant' ? 'assistant' : record.role === 'user' ? 'user' : null
  if (!role) {
    return null
  }
  const content = normalizeMessageContent(record.content)
  if (content === null) {
    return null
  }
  return {
    id: typeof record.id === 'string' && record.id ? record.id : crypto.randomUUID(),
    role,
    content,
    createdAt: typeof record.createdAt === 'string' && record.createdAt
      ? record.createdAt
      : new Date().toISOString(),
    meta: normalizeMessageMeta(record.meta),
  }
}

function normalizeMessageMeta(value: unknown): SessionMessageMeta | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const record = value as Record<string, unknown>
  const meta: SessionMessageMeta = {}

  if (record.source === 'web' || record.source === 'feishu' || record.source === 'scheduler') {
    meta.source = record.source
  }

  if (record.feishu && typeof record.feishu === 'object') {
    const feishu = normalizeFeishuMessageMeta(record.feishu)
    if (feishu) {
      meta.feishu = feishu
    }
  }

  if (!meta.source && !meta.feishu) {
    return undefined
  }

  return meta
}

function normalizeFeishuMessageMeta(value: unknown): FeishuMessageMeta | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const record = value as Record<string, unknown>
  const messageId = typeof record.messageId === 'string' ? record.messageId.trim() : ''
  const chatId = typeof record.chatId === 'string' ? record.chatId.trim() : ''
  const senderId = typeof record.senderId === 'string' ? record.senderId.trim() : ''
  const conversationKey = typeof record.conversationKey === 'string' ? record.conversationKey.trim() : ''
  const messageType = typeof record.messageType === 'string' ? record.messageType.trim() : ''
  const chatType = record.chatType === 'group' ? 'group' : record.chatType === 'p2p' ? 'p2p' : null

  if (!messageId || !chatId || !senderId || !conversationKey || !messageType || !chatType) {
    return undefined
  }

  const meta: FeishuMessageMeta = {
    provider: 'feishu',
    messageId,
    chatId,
    chatType,
    senderId,
    messageType,
    conversationKey,
    mentionBot: Boolean(record.mentionBot),
  }

  if (typeof record.eventId === 'string' && record.eventId.trim()) {
    meta.eventId = record.eventId.trim()
  }
  if (typeof record.rootMessageId === 'string' && record.rootMessageId.trim()) {
    meta.rootMessageId = record.rootMessageId.trim()
  }
  if (typeof record.parentMessageId === 'string' && record.parentMessageId.trim()) {
    meta.parentMessageId = record.parentMessageId.trim()
  }
  if (typeof record.threadId === 'string' && record.threadId.trim()) {
    meta.threadId = record.threadId.trim()
  }
  if (typeof record.senderType === 'string' && record.senderType.trim()) {
    meta.senderType = record.senderType.trim()
  }
  if (typeof record.senderName === 'string' && record.senderName.trim()) {
    meta.senderName = record.senderName.trim()
  }
  if (typeof record.createTime === 'string' && record.createTime.trim()) {
    meta.createTime = record.createTime.trim()
  }

  return meta
}

function normalizeMessageContent(value: unknown): SessionMessageContent | null {
  if (typeof value === 'string') {
    return value
  }
  if (!Array.isArray(value)) {
    return null
  }
  const blocks: AgentContentBlock[] = []
  for (const block of value) {
    if (!block || typeof block !== 'object') {
      continue
    }
    const record = block as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') {
      blocks.push({ type: 'text', text: record.text })
      continue
    }
    if (
      record.type === 'tool_use' &&
      typeof record.id === 'string' &&
      typeof record.name === 'string' &&
      record.input &&
      typeof record.input === 'object' &&
      !Array.isArray(record.input)
    ) {
      blocks.push({
        type: 'tool_use',
        id: record.id,
        name: record.name,
        input: record.input as Record<string, unknown>,
      })
      continue
    }
    if (
      record.type === 'tool_result' &&
      typeof record.tool_use_id === 'string' &&
      typeof record.content === 'string'
    ) {
      const resultBlock: AgentContentBlock = {
        type: 'tool_result',
        tool_use_id: record.tool_use_id,
        content: record.content,
        is_error: Boolean(record.is_error),
      }
      if (typeof record.tool_name === 'string') {
        resultBlock.tool_name = record.tool_name
      }
      blocks.push(resultBlock)
    }
  }
  return blocks
}

function messageContentPreview(content: SessionMessageContent): string {
  if (typeof content === 'string') {
    return content
  }
  return content.map((block) => {
    if (block.type === 'text') {
      return block.text
    }
    if (block.type === 'tool_use') {
      return `Tool call ${block.name}: ${JSON.stringify(block.input)}`
    }
    const label = block.tool_name || block.tool_use_id
    return `Tool result ${label}: ${block.content}`
  }).join('\n')
}
