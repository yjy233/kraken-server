import type { SessionSandboxConfig } from '../../tools/types.js'
import type { FeishuMessageMeta, SessionMessageMeta } from '../../runtime/session-store.js'
import type { FeishuConfig, FeishuIncomingMessage, FeishuRunContext } from './types.js'

const FEISHU_CHANNEL_ADDITIONAL_PROMPT = [
  '## Feishu Channel Instructions',
  'This request came from the Feishu robot channel.',
  'The final reply will be sent back into a Feishu chat. Prefer concise, direct, chat-friendly answers unless the user clearly asks for a long structured response.',
  'When the request is related to Feishu, Lark, DingTalk, messaging workflows, bot interactions, or Chinese workplace collaboration tools, activate and use the `dingtakl-feishu-cn` skill when it is available.',
  'Use Feishu message meta such as message_id, chat_id, sender_id, and thread_id when it helps preserve context or produce a correct reply.',
  'Do not expose internal Feishu credentials, tokens, app secrets, verification tokens, or encrypt keys.',
].join('\n')

export function buildConversationKey(config: FeishuConfig, message: FeishuIncomingMessage): string {
  if (message.chatType === 'p2p') {
    return `feishu:p2p:${message.senderId}`
  }
  if (config.sessionMode === 'user') {
    return `feishu:group:${message.chatId}:user:${message.senderId}`
  }
  return `feishu:group:${message.chatId}`
}

export function buildFeishuMessageMeta(
  conversationKey: string,
  message: FeishuIncomingMessage
): FeishuMessageMeta {
  const meta: FeishuMessageMeta = {
    provider: 'feishu',
    messageId: message.messageId,
    chatId: message.chatId,
    chatType: message.chatType,
    senderId: message.senderId,
    messageType: message.rawContentType,
    conversationKey,
    mentionBot: message.mentionedBot,
  }
  if (message.eventId) {
    meta.eventId = message.eventId
  }
  if (message.rootId) {
    meta.rootMessageId = message.rootId
  }
  if (message.replyToMessageId) {
    meta.parentMessageId = message.replyToMessageId
  }
  if (message.threadId) {
    meta.threadId = message.threadId
  }
  if (message.senderType) {
    meta.senderType = message.senderType
  }
  if (message.senderName) {
    meta.senderName = message.senderName
  }
  if (message.createTime) {
    meta.createTime = message.createTime
  }
  return meta
}

export function buildSessionMessageMeta(config: FeishuConfig, feishu: FeishuMessageMeta): SessionMessageMeta | undefined {
  if (!config.includeMessageMeta) {
    return {
      source: 'feishu',
    }
  }
  return {
    source: 'feishu',
    feishu,
  }
}

export function buildFeishuSystemPromptSuffix(config: FeishuConfig): string {
  const lines = [FEISHU_CHANNEL_ADDITIONAL_PROMPT]

  if (config.channelSkill && config.channelSkill !== 'dingtakl-feishu-cn') {
    lines.push(`For this Feishu channel, prefer the configured skill \`${config.channelSkill}\` when it is available.`)
  }

  return lines.join('\n')
}

export function buildAgentVisibleMessage(message: FeishuIncomingMessage, meta: FeishuMessageMeta): string {
  const lines = [
    '<external_message provider="feishu">',
    `message_id: ${meta.messageId}`,
  ]

  if (meta.eventId) {
    lines.push(`event_id: ${meta.eventId}`)
  }
  lines.push(`chat_type: ${meta.chatType}`)
  lines.push(`chat_id: ${meta.chatId}`)
  lines.push(`sender_id: ${meta.senderId}`)
  if (meta.senderName) {
    lines.push(`sender_name: ${meta.senderName}`)
  }
  if (meta.threadId) {
    lines.push(`thread_id: ${meta.threadId}`)
  }
  if (meta.createTime) {
    lines.push(`create_time: ${meta.createTime}`)
  }
  lines.push('</external_message>', '', message.content.trim())

  return lines.join('\n')
}

export function buildRunContext(
  config: FeishuConfig,
  message: FeishuIncomingMessage,
  sessionId: string,
  sandbox?: SessionSandboxConfig | undefined
): FeishuRunContext {
  const conversationKey = buildConversationKey(config, message)
  const feishuMeta = buildFeishuMessageMeta(conversationKey, message)
  return {
    sessionId,
    conversationKey,
    messageMeta: feishuMeta,
    systemPromptSuffix: buildFeishuSystemPromptSuffix(config),
    sandbox,
  }
}

export function normalizeIncomingContent(raw: string): string {
  return raw
    .replace(/<at\s+user_id="[^"]+">[^<]*<\/at>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
