import path from 'node:path'
import { createLarkChannel, type LarkChannel, type NormalizedMessage } from '@larksuiteoapi/node-sdk'
import type { SessionSandboxConfig } from '../../tools/types.js'
import type { SessionRecord } from '../../runtime/session-store.js'
import type { RunAgentServiceResult } from '../../runtime/agent-service.js'
import { truncate } from '../../utils/helpers.js'
import { buildAgentVisibleMessage, buildConversationKey, buildFeishuMessageMeta, buildFeishuSystemPromptSuffix, buildReplyTargetContext, buildSessionMessageMeta, normalizeIncomingContent } from './adapter.js'
import { createFeishuDedupeStore } from './dedupe-store.js'
import { createFeishuSessionMap } from './session-map.js'
import type { FeishuConfig, FeishuConversationBinding, FeishuIncomingMessage, FeishuResourceDescriptor } from './types.js'

const THINKING_REACTION_EMOJI = 'THINKING' // 🤔
const NEW_SESSION_COMMAND = '/new_session'

export function createFeishuService(params: {
  rootDir: string
  config: FeishuConfig
  sessionStore: {
    createSession: (input: {
      id?: string | undefined
      title: string
      systemPrompt?: string | undefined
      model: string
      sandbox?: SessionSandboxConfig | undefined
      loadedSkills?: string[] | undefined
    }) => SessionRecord
    loadSession: (sessionId: string) => Promise<SessionRecord | null>
    saveSession: (session: SessionRecord) => Promise<void>
  }
  agentRunner: {
    run: (input: {
      sessionId?: string | null
      systemPrompt?: string
      systemPromptSuffix?: string
      message: string
      model?: string
      sandbox?: SessionSandboxConfig | undefined
      loadedSkills?: string[] | undefined
      createNewSession?: boolean
      forceSessionId?: string | undefined
      title?: string
      messageMeta?: {
        source?: 'web' | 'feishu' | 'scheduler'
        feishu?: ReturnType<typeof buildFeishuMessageMeta>
      }
    }, emit: ((event: string, data: unknown) => void) | null) => Promise<RunAgentServiceResult>
  }
  defaultModel: string
  defaultSystemPrompt: string
  logger?: Pick<Console, 'info' | 'warn' | 'error'>
}) {
  const logger = params.logger || console
  const dataDir = path.join(params.rootDir, '.feishu-sessions')
  const sessionMap = createFeishuSessionMap(dataDir)
  const dedupeStore = createFeishuDedupeStore(dataDir, params.config.dedupeTtlMs)
  const queue = createAsyncQueue(params.config.maxConcurrency)
  const channel = createLarkChannel({
    appId: params.config.appId,
    appSecret: params.config.appSecret,
    transport: params.config.eventMode === 'http' ? 'webhook' : 'websocket',
    includeRawInMessage: true,
    source: 'kraken-server',
    outbound: {
      streamThrottleMs: params.config.streamingFlushIntervalMs,
      streamThrottleChars: params.config.streamingMinDeltaChars,
      streamInitialText: '处理中...',
    },
  })
  if (params.config.eventMode === 'http') {
    logger.warn('[feishu] HTTP callback mode is not wired yet; falling back to SDK defaults if configured externally')
  }

  channel.on('error', (error) => {
    logger.error('[feishu] channel error', error)
  })
  channel.on('reconnecting', () => {
    logger.warn('[feishu] reconnecting')
  })
  channel.on('reconnected', () => {
    logger.info('[feishu] reconnected')
  })
  channel.on('message', async (msg) => {
    await queue.push(async () => {
      await handleMessage(normalizeMessage(msg))
    })
  })

  async function start(): Promise<void> {
    if (!params.config.enabled) {
      return
    }
    await channel.connect()
    logger.info('[feishu] channel connected')
  }

  async function stop(): Promise<void> {
    await channel.disconnect()
  }

  return {
    start,
    stop,
  }

  async function handleMessage(message: FeishuIncomingMessage): Promise<void> {
    if (message.chatType === 'group' && !message.mentionedBot) {
      return
    }

    const normalizedContent = normalizeIncomingContent(message.content)
    if (!normalizedContent && message.resources.length === 0) {
      return
    }

    const dedupeKey = message.messageId || message.eventId || ''
    if (await dedupeStore.has(dedupeKey)) {
      return
    }
    await dedupeStore.remember(dedupeKey)

    const conversationKey = buildConversationKey(params.config, message)
    const handled = await handleConversationControlCommand(message, conversationKey, normalizedContent)
    if (handled) {
      return
    }

    const binding = await ensureSessionBinding(conversationKey, normalizedContent)
    const feishuMeta = buildFeishuMessageMeta(conversationKey, message)
    const visibleMessage = buildAgentVisibleMessage({
      ...message,
      content: normalizedContent,
    }, feishuMeta)
    const replyTarget = await loadReplyTargetMessage(message)
    const replyTargetContext = replyTarget ? buildReplyTargetContext(replyTarget) : ''
    const userMessage = replyTargetContext
      ? `${replyTargetContext}\n\n${visibleMessage}`
      : visibleMessage
    const effectiveSystemPrompt = params.config.defaultSystemPrompt || params.defaultSystemPrompt
    const systemPromptSuffix = buildFeishuSystemPromptSuffix(params.config)
    const messageMeta = buildSessionMessageMeta(params.config, feishuMeta)

    await addThinkingReaction(message)

    try {
      if (params.config.streamingEnabled && params.config.streamingMode === 'update') {
        await streamReply({
          binding,
          sourceMessage: message,
          userMessage,
          systemPrompt: effectiveSystemPrompt,
          systemPromptSuffix,
          messageMeta,
        })
        return
      }

      const runInput: Parameters<typeof params.agentRunner.run>[0] = {
        sessionId: binding.sessionId,
        message: userMessage,
        systemPrompt: effectiveSystemPrompt,
        systemPromptSuffix,
        title: normalizedContent,
      }
      if (messageMeta) {
        runInput.messageMeta = messageMeta
      }
      const result = await params.agentRunner.run(runInput, createFeishuToolEventEmitter(message))

      await replyFinal(message, result.reply)
    } finally {
      await removeThinkingReaction(message)
    }
  }

  async function ensureSessionBinding(conversationKey: string, firstMessage: string): Promise<FeishuConversationBinding> {
    const existing = await sessionMap.get(conversationKey)
    if (existing) {
      existing.updatedAt = new Date().toISOString()
      await sessionMap.set(conversationKey, existing)
      return existing
    }

    const session = params.sessionStore.createSession({
      title: firstMessage,
      systemPrompt: params.config.defaultSystemPrompt || params.defaultSystemPrompt,
      model: params.defaultModel,
    })
    await params.sessionStore.saveSession(session)

    const created: FeishuConversationBinding = {
      sessionId: session.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await sessionMap.set(conversationKey, created)
    return created
  }

  async function handleConversationControlCommand(
    message: FeishuIncomingMessage,
    conversationKey: string,
    normalizedContent: string
  ): Promise<boolean> {
    const command = parseConversationControlCommand(normalizedContent)
    if (!command) {
      return false
    }

    if (command.type !== 'new_session') {
      return false
    }

    const previousBinding = await sessionMap.get(conversationKey)
    const title = command.title || 'New Feishu session'
    const session = params.sessionStore.createSession({
      title,
      systemPrompt: params.config.defaultSystemPrompt || params.defaultSystemPrompt,
      model: params.defaultModel,
    })

    await params.sessionStore.saveSession(session)

    const binding: FeishuConversationBinding = {
      sessionId: session.id,
      createdAt: previousBinding?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await sessionMap.set(conversationKey, binding)

    logger.info('[feishu] session switched by command', {
      conversationKey,
      previousSessionId: previousBinding?.sessionId || null,
      nextSessionId: session.id,
      messageId: message.messageId,
      senderId: message.senderId,
    })

    await replyFinal(
      message,
      [
        '已创建并切换到新会话。',
        `session_id: ${session.id}`,
        '后续消息将进入这个新会话。',
      ].join('\n')
    )

    return true
  }

  async function loadReplyTargetMessage(message: FeishuIncomingMessage): Promise<FeishuIncomingMessage | null> {
    if (!message.replyToMessageId) {
      return null
    }

    try {
      const response = await channel.rawClient.im.v1.message.get({
        path: {
          message_id: message.replyToMessageId,
        },
      })

      const items = Array.isArray(response?.data?.items) ? response.data.items : []
      const matched = items.find((item) => {
        const messageId = typeof item?.message_id === 'string' ? item.message_id.trim() : ''
        return messageId === message.replyToMessageId
      }) || items[0]

      if (!matched) {
        return null
      }

      return normalizeReplyTargetMessage(message, matched as {
        message_id?: string | undefined
        root_id?: string | undefined
        parent_id?: string | undefined
        thread_id?: string | undefined
        create_time?: string | undefined
        msg_type?: string | undefined
        body?: {
          content?: string | undefined
        } | undefined
      })
    } catch (error) {
      logger.warn('[feishu] failed to load reply target message', {
        messageId: message.messageId,
        replyToMessageId: message.replyToMessageId,
        error,
      })
      return null
    }
  }

  async function streamReply(input: {
    binding: FeishuConversationBinding
    sourceMessage: FeishuIncomingMessage
    userMessage: string
    systemPrompt: string
    systemPromptSuffix: string
    messageMeta: {
      source?: 'web' | 'feishu' | 'scheduler'
      feishu?: ReturnType<typeof buildFeishuMessageMeta>
    } | undefined
  }): Promise<void> {
    const updates = createTextUpdateQueue()
    let finalReply = ''
    let runError: Error | null = null
    let updateCount = 0

    const runInput: Parameters<typeof params.agentRunner.run>[0] = {
      sessionId: input.binding.sessionId,
      message: input.userMessage,
      systemPrompt: input.systemPrompt,
      systemPromptSuffix: input.systemPromptSuffix,
      title: input.sourceMessage.content,
    }
    if (input.messageMeta) {
      runInput.messageMeta = input.messageMeta
    }

    const emit = createFeishuToolEventEmitter(input.sourceMessage, (event, data) => {
      if (event !== 'assistant:delta') {
        return
      }
      const text = typeof (data as { text?: unknown })?.text === 'string'
        ? String((data as { text: string }).text)
        : ''
      if (!text) {
        return
      }
      finalReply = text
      if (updateCount < params.config.streamingMaxUpdates) {
        updateCount += 1
        updates.push(text)
      }
    })

    const runPromise = params.agentRunner.run(runInput, emit).then((result) => {
      finalReply = result.reply
      updates.finish()
      return result
    }).catch((error: unknown) => {
      runError = error instanceof Error ? error : new Error(String(error))
      updates.finish()
      throw runError
    })

    try {
      await channel.stream(input.sourceMessage.chatId, {
        card: {
          initial: buildReplyCard('处理中...', { title: 'Kraken' }),
          producer: async (controller) => {
            if (input.sourceMessage.chatType === 'group' || params.config.replyMode === 'reply') {
              await controller.update(buildReplyCard('处理中...', { title: 'Kraken' }))
            }

            while (true) {
              const chunk = await updates.next()
              if (chunk === null) {
                break
              }
              if (chunk.trim()) {
                await controller.update(buildReplyCard(chunk, { title: 'Kraken' }))
              }
            }

            await runPromise.catch(() => undefined)
            if (runError) {
              await controller.update(buildReplyCard(`处理失败：${runError.message}`, {
                title: 'Kraken',
                template: 'red',
              }))
              return
            }
            await controller.update(buildReplyCard(finalReply || '已完成，但没有文本输出。', { title: 'Kraken' }))
          },
        },
      }, buildSendOptions(
        params.config.replyMode === 'reply' ? input.sourceMessage.messageId : undefined,
        input.sourceMessage.threadId
      ))
    } catch (error) {
      logger.warn('[feishu] streaming failed, fallback to final reply', error)
      const result = await runPromise
      await replyFinal(input.sourceMessage, result.reply)
    }
  }

  async function replyFinal(message: FeishuIncomingMessage, text: string): Promise<void> {
    const normalized = text.trim() || '已完成，但没有文本输出。'
    if (params.config.replyMode === 'reply') {
      await channel.send(
        message.chatId,
        { card: buildReplyCard(normalized, { title: 'Kraken' }) },
        buildSendOptions(message.messageId, message.threadId)
      )
      return
    }
    await channel.send(message.chatId, { card: buildReplyCard(normalized, { title: 'Kraken' }) })
  }

  async function addThinkingReaction(message: FeishuIncomingMessage): Promise<void> {
    try {
      await channel.addReaction(message.messageId, THINKING_REACTION_EMOJI)
    } catch (error) {
      logger.warn('[feishu] failed to add thinking reaction', {
        messageId: message.messageId,
        emoji: THINKING_REACTION_EMOJI,
        error,
      })
    }
  }

  async function removeThinkingReaction(message: FeishuIncomingMessage): Promise<void> {
    try {
      await channel.removeReactionByEmoji(message.messageId, THINKING_REACTION_EMOJI)
    } catch (error) {
      logger.warn('[feishu] failed to remove thinking reaction', {
        messageId: message.messageId,
        emoji: THINKING_REACTION_EMOJI,
        error,
      })
    }
  }

  function createFeishuToolEventEmitter(
    message: FeishuIncomingMessage,
    onEvent?: ((event: string, data: unknown) => void) | undefined
  ) {
    const announcedToolUseIds = new Set<string>()
    const completedToolUseIds = new Set<string>()

    return (event: string, data: unknown) => {
      onEvent?.(event, data)

      if (!data || typeof data !== 'object') {
        return
      }

      if (event === 'tool:requested') {
        const payload = data as {
          toolUse?: {
            id?: string
            name?: string
            input?: Record<string, unknown>
          }
        }
        const toolUseId = typeof payload.toolUse?.id === 'string' ? payload.toolUse.id : ''
        const toolName = typeof payload.toolUse?.name === 'string' ? payload.toolUse.name : 'unknown_tool'
        if (!toolUseId || announcedToolUseIds.has(toolUseId)) {
          return
        }
        announcedToolUseIds.add(toolUseId)

        const inputPreview = formatToolInputPreview(toolName, payload.toolUse?.input)
        void sendFeishuToolStatusMessage(
          message,
          `🔧 调用工具：\`${toolName}\`${inputPreview ? `\n${inputPreview}` : ''}`
        )
        return
      }

      if (event === 'tool:result') {
        const payload = data as {
          toolUseId?: string
          toolName?: string
          output?: string
          outputPreview?: string
          isError?: boolean
        }
        const toolUseId = typeof payload.toolUseId === 'string' ? payload.toolUseId : ''
        if (!toolUseId || completedToolUseIds.has(toolUseId)) {
          return
        }
        completedToolUseIds.add(toolUseId)

        const toolName = typeof payload.toolName === 'string' ? payload.toolName : 'unknown_tool'
        const body = typeof payload.output === 'string' && payload.output.trim()
          ? payload.output
          : typeof payload.outputPreview === 'string'
            ? payload.outputPreview
            : ''
        const prefix = payload.isError ? '❌ 工具失败' : '✅ 工具完成'
        const preview = body ? `\n\n\`\`\`\n${truncate(body, 1200)}\n\`\`\`` : ''
        void sendFeishuToolStatusMessage(message, `${prefix}：\`${toolName}\`${preview}`)
      }
    }
  }

  async function sendFeishuToolStatusMessage(message: FeishuIncomingMessage, text: string): Promise<void> {
    const normalized = text.trim()
    if (!normalized) {
      return
    }
    try {
      await channel.send(
        message.chatId,
        {
          card: buildReplyCard(limitCardTextLines(normalized, 6), {
            title: 'tools call',
            template: 'grey',
          }),
        },
        buildSendOptions(undefined, message.threadId)
      )
    } catch (error) {
      logger.warn('[feishu] failed to send tool status message', {
        messageId: message.messageId,
        error,
      })
    }
  }
}

function formatToolInputPreview(toolName: string, input: Record<string, unknown> | undefined): string {
  if (!input) {
    return ''
  }
  switch (toolName) {
    case 'shell_command':
      return input.command ? `命令：\`${String(input.command)}\`` : ''
    case 'read_file':
    case 'write_file':
      return input.path ? `路径：\`${String(input.path)}\`` : ''
    case 'agent_browser': {
      const parts = [
        input.action ? String(input.action) : '',
        input.url ? String(input.url) : '',
        input.ref ? String(input.ref) : '',
        input.selector ? String(input.selector) : '',
      ].filter(Boolean)
      return parts.length > 0 ? `参数：\`${parts.join(' ')}\`` : ''
    }
    default:
      return ''
  }
}

function limitCardTextLines(text: string, maxLines: number): string {
  if (maxLines <= 0) {
    return ''
  }
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))

  if (lines.length <= maxLines) {
    return lines.join('\n').trim()
  }

  return lines.slice(0, maxLines).join('\n').trim()
}

function buildReplyCard(
  content: string,
  options: {
    title?: string
    template?: string
  } = {}
) {
  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: options.template || 'blue',
      title: {
        tag: 'plain_text',
        content: options.title || 'Kraken',
      },
    },
    elements: [
      {
        tag: 'markdown',
        content: content.trim() || '已完成，但没有文本输出。',
      },
    ],
  }
}

function normalizeMessage(message: NormalizedMessage): FeishuIncomingMessage {
  const incoming: FeishuIncomingMessage = {
    messageId: message.messageId,
    chatId: message.chatId,
    chatType: message.chatType,
    senderId: message.senderId,
    content: message.content,
    rawContentType: message.rawContentType,
    resources: normalizeResources(message.resources),
    mentionedBot: message.mentionedBot,
  }
  if (message.senderName) {
    incoming.senderName = message.senderName
  }
  if (message.rootId) {
    incoming.rootId = message.rootId
  }
  if (message.threadId) {
    incoming.threadId = message.threadId
  }
  if (message.replyToMessageId) {
    incoming.replyToMessageId = message.replyToMessageId
  }
  if (Number.isFinite(message.createTime)) {
    incoming.createTime = new Date(message.createTime).toISOString()
  }
  if (message.raw !== undefined) {
    incoming.raw = message.raw
  }
  const eventId = extractEventId(message.raw)
  if (eventId) {
    incoming.eventId = eventId
  }
  return incoming
}

function normalizeReplyTargetMessage(
  currentMessage: FeishuIncomingMessage,
  rawItem: {
    message_id?: string | undefined
    root_id?: string | undefined
    parent_id?: string | undefined
    thread_id?: string | undefined
    create_time?: string | undefined
    msg_type?: string | undefined
    body?: {
      content?: string | undefined
    } | undefined
  }
): FeishuIncomingMessage | null {
  const messageId = typeof rawItem.message_id === 'string' ? rawItem.message_id.trim() : ''
  const rawContentType = typeof rawItem.msg_type === 'string' ? rawItem.msg_type.trim() : ''
  if (!messageId || !rawContentType) {
    return null
  }

  const content = typeof rawItem.body?.content === 'string' ? rawItem.body.content : ''
  const normalizedMessage = normalizeFeishuRawContent(content, rawContentType)

  const replyTarget: FeishuIncomingMessage = {
    messageId,
    chatId: currentMessage.chatId,
    chatType: currentMessage.chatType,
    senderId: currentMessage.senderId,
    content: normalizedMessage.content,
    rawContentType,
    resources: normalizedMessage.resources,
    mentionedBot: false,
  }

  if (currentMessage.senderName) {
    replyTarget.senderName = currentMessage.senderName
  }
  if (currentMessage.senderType) {
    replyTarget.senderType = currentMessage.senderType
  }

  if (typeof rawItem.root_id === 'string' && rawItem.root_id.trim()) {
    replyTarget.rootId = rawItem.root_id.trim()
  }
  if (typeof rawItem.parent_id === 'string' && rawItem.parent_id.trim()) {
    replyTarget.replyToMessageId = rawItem.parent_id.trim()
  }
  if (typeof rawItem.thread_id === 'string' && rawItem.thread_id.trim()) {
    replyTarget.threadId = rawItem.thread_id.trim()
  }
  if (typeof rawItem.create_time === 'string' && rawItem.create_time.trim()) {
    const parsed = Number.parseInt(rawItem.create_time, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      replyTarget.createTime = new Date(parsed).toISOString()
    }
  }

  return replyTarget
}

function normalizeFeishuRawContent(
  rawContent: string,
  rawContentType: string
): {
  content: string
  resources: FeishuResourceDescriptor[]
} {
  const parsed = safeParseJson(rawContent)

  if (rawContentType === 'image') {
    const imageKey = typeof parsed?.image_key === 'string' ? parsed.image_key.trim() : ''
    return {
      content: imageKey ? '[image]' : '',
      resources: imageKey
        ? [{ type: 'image', fileKey: imageKey }]
        : [],
    }
  }

  if (rawContentType === 'file') {
    const fileKey = typeof parsed?.file_key === 'string' ? parsed.file_key.trim() : ''
    const fileName = typeof parsed?.file_name === 'string' ? parsed.file_name.trim() : ''
    return {
      content: fileName || '[file]',
      resources: fileKey
        ? [{
          type: 'file',
          fileKey,
          ...(fileName ? { fileName } : {}),
        }]
        : [],
    }
  }

  if (rawContentType === 'audio') {
    const fileKey = typeof parsed?.file_key === 'string' ? parsed.file_key.trim() : ''
    const durationMs = typeof parsed?.duration === 'number' ? parsed.duration : undefined
    return {
      content: '[audio]',
      resources: fileKey
        ? [{
          type: 'audio',
          fileKey,
          ...(typeof durationMs === 'number' ? { durationMs } : {}),
        }]
        : [],
    }
  }

  if (rawContentType === 'media') {
    const fileKey = typeof parsed?.file_key === 'string' ? parsed.file_key.trim() : ''
    const durationMs = typeof parsed?.duration === 'number' ? parsed.duration : undefined
    const coverImageKey = typeof parsed?.image_key === 'string' ? parsed.image_key.trim() : ''
    return {
      content: '[video]',
      resources: fileKey
        ? [{
          type: 'video',
          fileKey,
          ...(typeof durationMs === 'number' ? { durationMs } : {}),
          ...(coverImageKey ? { coverImageKey } : {}),
        }]
        : [],
    }
  }

  if (rawContentType === 'sticker') {
    const fileKey = typeof parsed?.file_key === 'string' ? parsed.file_key.trim() : ''
    return {
      content: '[sticker]',
      resources: fileKey
        ? [{ type: 'sticker', fileKey }]
        : [],
    }
  }

  if (typeof parsed?.text === 'string') {
    return {
      content: parsed.text,
      resources: [],
    }
  }

  return {
    content: typeof rawContent === 'string' ? rawContent : '',
    resources: [],
  }
}

function safeParseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>
    }
  } catch {
    return null
  }
  return null
}

function normalizeResources(resources: NormalizedMessage['resources'] | undefined): FeishuResourceDescriptor[] {
  if (!Array.isArray(resources)) {
    return []
  }

  return resources
    .map((resource) => {
      if (!resource || typeof resource !== 'object') {
        return null
      }
      if (
        resource.type !== 'image' &&
        resource.type !== 'file' &&
        resource.type !== 'audio' &&
        resource.type !== 'video' &&
        resource.type !== 'sticker'
      ) {
        return null
      }
      const fileKey = typeof resource.fileKey === 'string' ? resource.fileKey.trim() : ''
      if (!fileKey) {
        return null
      }
      const normalized: FeishuResourceDescriptor = {
        type: resource.type,
        fileKey,
      }
      if (typeof resource.fileName === 'string' && resource.fileName.trim()) {
        normalized.fileName = resource.fileName.trim()
      }
      if (typeof resource.durationMs === 'number' && Number.isFinite(resource.durationMs)) {
        normalized.durationMs = resource.durationMs
      }
      if (typeof resource.coverImageKey === 'string' && resource.coverImageKey.trim()) {
        normalized.coverImageKey = resource.coverImageKey.trim()
      }
      return normalized
    })
    .filter((resource): resource is FeishuResourceDescriptor => Boolean(resource))
}

function parseConversationControlCommand(
  normalizedContent: string
): {
  type: 'new_session'
  title?: string
} | null {
  const value = normalizedContent.trim()
  if (!value.startsWith(NEW_SESSION_COMMAND)) {
    return null
  }

  const rest = value.slice(NEW_SESSION_COMMAND.length)
  if (rest && !/^\s+/.test(rest)) {
    return null
  }

  const title = rest.trim()
  if (!title) {
    return {
      type: 'new_session',
    }
  }

  return {
    type: 'new_session',
    title,
  }
}

function extractEventId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const eventId = (raw as { event_id?: unknown }).event_id
  return typeof eventId === 'string' && eventId.trim() ? eventId.trim() : undefined
}

function buildSendOptions(replyTo: string | undefined, threadId: string | undefined) {
  const options: {
    replyTo?: string
    replyInThread?: boolean
  } = {}
  if (replyTo) {
    options.replyTo = replyTo
    options.replyInThread = Boolean(threadId)
  }
  return options
}

function createAsyncQueue(maxConcurrency: number) {
  const pending: Array<() => Promise<void>> = []
  let running = 0

  async function push(task: () => Promise<void>): Promise<void> {
    pending.push(task)
    await drain()
  }

  async function drain(): Promise<void> {
    while (running < maxConcurrency && pending.length > 0) {
      const task = pending.shift()
      if (!task) {
        return
      }
      running += 1
      void task()
        .catch(() => undefined)
        .finally(() => {
          running -= 1
          void drain()
        })
    }
  }

  return {
    push,
  }
}

function createTextUpdateQueue() {
  const pending: string[] = []
  const waiters: Array<(value: string | null) => void> = []
  let finished = false

  function push(value: string) {
    if (finished) {
      return
    }
    const next = waiters.shift()
    if (next) {
      next(value)
      return
    }
    pending.push(value)
  }

  function finish() {
    if (finished) {
      return
    }
    finished = true
    while (waiters.length > 0) {
      const next = waiters.shift()
      next?.(null)
    }
  }

  async function next(): Promise<string | null> {
    if (pending.length > 0) {
      return pending.shift() || null
    }
    if (finished) {
      return null
    }
    return new Promise((resolve) => {
      waiters.push(resolve)
    })
  }

  return {
    push,
    finish,
    next,
  }
}
