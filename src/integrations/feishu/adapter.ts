import type { SessionSandboxConfig } from '../../tools/types.js'
import type { FeishuMessageMeta, SessionMessageMeta } from '../../runtime/session-store.js'
import type { FeishuConfig, FeishuIncomingMessage, FeishuRunContext } from './types.js'

const FEISHU_CHANNEL_ADDITIONAL_PROMPT = [
  '## Feishu Channel Instructions',
  'This request came from the Feishu robot channel.',
  'The final reply will be sent back into a Feishu chat. Prefer concise, direct, chat-friendly answers unless the user clearly asks for a long structured response.',
  'When the request is related to Feishu, Lark, DingTalk, messaging workflows, bot interactions, or Chinese workplace collaboration tools, activate and use the `dingtalk-feishu-cn` skill when it is available.',
  'When the task requires sending a Feishu message, replying into a Feishu chat, sending a file, sending an image, uploading media, downloading message media, or delivering content back to a Feishu user or group, activate and use the `feishu-message-media` skill when it is available.',
  'For outbound Feishu delivery tasks and Feishu media download tasks, prefer the `feishu-message-media` workflow over ad hoc code snippets, generic API examples, curl samples, or shell scripts.',
  'If the user wants you to send a file or image in the current Feishu conversation, use the current Feishu message meta such as chat_id, thread_id, and message_id as the default delivery target unless the user explicitly asks for a different target.',
  'Do not stop at explaining how to send Feishu files or images when the available skills can perform the send or save workflow directly.',
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

  if (config.channelSkill && !['dingtalk-feishu-cn', 'feishu-message-media'].includes(config.channelSkill)) {
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
  lines.push(`message_type: ${meta.messageType}`)
  if (message.resources.length > 0) {
    lines.push('resources:')
    for (const resource of message.resources) {
      const parts = [
        `type=${resource.type}`,
        `file_key=${resource.fileKey}`,
      ]
      if (resource.fileName) {
        parts.push(`file_name=${resource.fileName}`)
      }
      if (typeof resource.durationMs === 'number') {
        parts.push(`duration_ms=${resource.durationMs}`)
      }
      if (resource.coverImageKey) {
        parts.push(`cover_image_key=${resource.coverImageKey}`)
      }
      lines.push(`- ${parts.join(', ')}`)
    }
  }
  lines.push('</external_message>', '', message.content.trim())

  return lines.join('\n')
}

export function buildReplyTargetContext(message: FeishuIncomingMessage): string {
  if (!message.replyToMessageId) {
    return ''
  }

  const lines = [
    '<reply_target provider="feishu">',
    `message_id: ${message.replyToMessageId}`,
    `message_type: ${message.rawContentType}`,
  ]

  if (message.resources.length > 0) {
    lines.push('resources:')
    for (const resource of message.resources) {
      const parts = [
        `type=${resource.type}`,
        `file_key=${resource.fileKey}`,
      ]
      if (resource.fileName) {
        parts.push(`file_name=${resource.fileName}`)
      }
      if (typeof resource.durationMs === 'number') {
        parts.push(`duration_ms=${resource.durationMs}`)
      }
      if (resource.coverImageKey) {
        parts.push(`cover_image_key=${resource.coverImageKey}`)
      }
      lines.push(`- ${parts.join(', ')}`)
    }
  }

  lines.push('</reply_target>')

  if (message.content.trim()) {
    lines.push('', message.content.trim())
  }

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
