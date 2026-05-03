import path from 'node:path'
import { createLarkChannel, type LarkChannel, type NormalizedMessage } from '@larksuiteoapi/node-sdk'
import type { SessionSandboxConfig } from '../../tools/types.js'
import type { SessionRecord } from '../../runtime/session-store.js'
import type { RunAgentServiceResult } from '../../runtime/agent-service.js'
import { buildAgentVisibleMessage, buildConversationKey, buildFeishuMessageMeta, buildFeishuSystemPromptSuffix, buildSessionMessageMeta, normalizeIncomingContent } from './adapter.js'
import { createFeishuDedupeStore } from './dedupe-store.js'
import { createFeishuSessionMap } from './session-map.js'
import type { FeishuConfig, FeishuConversationBinding, FeishuIncomingMessage } from './types.js'

const THINKING_REACTION_EMOJI = 'THINKING' // 🤔

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
    if (message.rawContentType !== 'text') {
      return
    }
    if (message.chatType === 'group' && !message.mentionedBot) {
      return
    }

    const normalizedContent = normalizeIncomingContent(message.content)
    if (!normalizedContent) {
      return
    }

    const dedupeKey = message.messageId || message.eventId || ''
    if (await dedupeStore.has(dedupeKey)) {
      return
    }
    await dedupeStore.remember(dedupeKey)

    const conversationKey = buildConversationKey(params.config, message)
    const binding = await ensureSessionBinding(conversationKey, normalizedContent)
    const feishuMeta = buildFeishuMessageMeta(conversationKey, message)
    const userMessage = buildAgentVisibleMessage({
      ...message,
      content: normalizedContent,
    }, feishuMeta)
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
      const result = await params.agentRunner.run(runInput, null)

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

    const runPromise = params.agentRunner.run(runInput, (event, data) => {
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
    }).then((result) => {
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
        markdown: async (controller) => {
          if (input.sourceMessage.chatType === 'group' || params.config.replyMode === 'reply') {
            await controller.setContent('处理中...')
          }

          while (true) {
            const chunk = await updates.next()
            if (chunk === null) {
              break
            }
            if (chunk.trim()) {
              await controller.setContent(chunk)
            }
          }

          await runPromise.catch(() => undefined)
          if (runError) {
            await controller.setContent(`处理失败：${runError.message}`)
            return
          }
          await controller.setContent(finalReply || '已完成，但没有文本输出。')
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
      await channel.send(message.chatId, { markdown: normalized }, buildSendOptions(message.messageId, message.threadId))
      return
    }
    await channel.send(message.chatId, { markdown: normalized })
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
}

function normalizeMessage(message: NormalizedMessage): FeishuIncomingMessage {
  const incoming: FeishuIncomingMessage = {
    messageId: message.messageId,
    chatId: message.chatId,
    chatType: message.chatType,
    senderId: message.senderId,
    content: message.content,
    rawContentType: message.rawContentType,
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
