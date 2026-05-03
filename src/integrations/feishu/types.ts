import type { SessionSandboxConfig } from '../../tools/types.js'
import type { FeishuMessageMeta } from '../../runtime/session-store.js'

export type FeishuEventMode = 'ws' | 'http'
export type FeishuSessionMode = 'chat' | 'user'
export type FeishuStreamingMode = 'none' | 'update'

export interface FeishuConfig {
  enabled: boolean
  eventMode: FeishuEventMode
  appId: string
  appSecret: string
  verificationToken?: string
  encryptKey?: string
  sessionMode: FeishuSessionMode
  replyMode: 'reply' | 'send'
  defaultSystemPrompt?: string
  channelSkill?: string
  maxConcurrency: number
  dedupeTtlMs: number
  includeMessageMeta: boolean
  streamingEnabled: boolean
  streamingMode: FeishuStreamingMode
  streamingFlushIntervalMs: number
  streamingMinDeltaChars: number
  streamingMaxUpdates: number
}

export interface FeishuConversationBinding {
  sessionId: string
  createdAt: string
  updatedAt: string
}

export interface FeishuMappedSessionResult {
  sessionId: string
  created: boolean
}

export interface FeishuIncomingMessage {
  messageId: string
  chatId: string
  chatType: 'p2p' | 'group'
  senderId: string
  senderName?: string
  senderType?: string
  content: string
  rawContentType: string
  mentionedBot: boolean
  rootId?: string
  threadId?: string
  replyToMessageId?: string
  createTime?: string
  eventId?: string
  raw?: unknown
}

export interface FeishuReplyStreamState {
  enabled: boolean
  mode: FeishuStreamingMode
  sourceMessageId: string
  placeholderMessageId?: string
  buffer: string
  lastFlushedText: string
  lastFlushAt: number
  updateCount: number
  closed: boolean
}

export interface FeishuRunContext {
  sessionId: string
  conversationKey: string
  messageMeta: FeishuMessageMeta
  systemPromptSuffix: string
  sandbox?: SessionSandboxConfig | undefined
}
