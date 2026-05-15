import crypto from 'node:crypto'
import type { ToolDefinition, AgentMessage, AgentContentBlock, EmitFn, RunResult } from '../agent/types.js'
import { ReActAgent } from '../agent/react-agent.js'
import { createToolRegistry, type CreateRegistryOptions } from '../tools/registry.js'
import {
  buildSandboxPromptContext,
  buildSessionSandboxPolicy,
  ensureSandboxLayout,
  normalizeSessionSandboxConfig,
} from '../tools/sandbox.js'
import type { SessionSandboxConfig, SessionSandboxPolicy } from '../tools/types.js'
import { refreshSkills } from '../skills/manager.js'
import { resolveWorkspaceSkillRoot } from '../skills/paths.js'
import type { Skill, SkillRuntimeState } from '../skills/types.js'
import { extractBaseSystemPrompt, PromptBuilder } from '../agent/prompt-builder.js'
import {
  isRecord,
  sanitizeTitle,
} from '../utils/helpers.js'
import type { SessionMessageMeta, SessionMessageRecord, SessionRecord } from './session-store.js'
import { prepareContextWindow, type ContextCompressionConfig } from './context-window.js'
import type { MemoryStore } from '../memory/store.js'
import type { ProposalStore } from '../evolution/proposal-store.js'
import { resolveMemoryScope } from '../memory/scope.js'
import { buildMemoryPromptBlock } from '../memory/prompt.js'
import { updateSessionMemory } from '../memory/short-term.js'
import { extractMemoryCandidates } from '../memory/extractor.js'
import { createPostRunProposals } from '../evolution/reflection.js'

export interface AgentServiceConfig {
  defaultModel: string
  baseSystemPrompt: string
  maxSteps: number
  maxTokens: number
  maxContextTokens: number
  timeout: number
  maxContextMessages: number
  defaultWorkspaceRoot: string
  sensitivePaths: string[]
  enablePathSandbox: boolean
  memoryEnabled: boolean
  memoryStore: MemoryStore
  proposalStore: ProposalStore
  toolRegistryOptions: CreateRegistryOptions
  sessionStore: {
    createSession: (input: {
      title: string
      systemPrompt?: string | undefined
      model: string
      sandbox?: SessionSandboxConfig | undefined
      loadedSkills?: string[] | undefined
    }) => SessionRecord
    loadSession: (sessionId: string) => Promise<SessionRecord | null>
    saveSession: (session: SessionRecord) => Promise<void>
    summarizeSession: (session: SessionRecord) => unknown
  }
}

export interface RunAgentServiceRequest {
  sessionId?: string | null
  systemPrompt?: string
  systemPromptSuffix?: string
  message: string
  content?: AgentContentBlock[] | undefined
  model?: string
  sandbox?: SessionSandboxConfig | undefined
  loadedSkills?: string[] | undefined
  createNewSession?: boolean
  forceSessionId?: string | undefined
  title?: string
  messageMeta?: SessionMessageMeta | undefined
}

export interface RunAgentServiceResult {
  reply: string
  session: SessionRecord
  run: RunResult
}

export function createAgentService(config: AgentServiceConfig) {
  const agent = new ReActAgent({
    defaultModel: config.defaultModel,
    defaultSystemPrompt: config.baseSystemPrompt,
    maxSteps: config.maxSteps,
    maxTokens: config.maxTokens,
    timeout: config.timeout,
    toolRegistry: [],
  })

  function normalizeSystemPrompt(systemPrompt: string | undefined): string {
    const normalized = extractBaseSystemPrompt(systemPrompt || '').trim()
    return normalized || config.baseSystemPrompt
  }

  function buildSystemPrompt(basePrompt: string, tools: ToolDefinition[], availableSkills: Skill[]): string {
    return new PromptBuilder(
      normalizeSystemPrompt(basePrompt),
      tools,
      availableSkills
    ).build()
  }

  function buildRuntimeSystemPrompt(input: {
    basePrompt: string
    tools: ToolDefinition[]
    availableSkills: Skill[]
    sandboxPolicy: SessionSandboxPolicy
    memoryPromptBlock?: string
  }): string {
    const parts = [
      buildSystemPrompt(input.basePrompt, input.tools, input.availableSkills),
      '',
      buildRuntimeDateContext(),
      '',
      buildSandboxPromptContext(input.sandboxPolicy),
    ]
    if (input.memoryPromptBlock) {
      parts.push('', input.memoryPromptBlock)
    }
    return parts.join('\n')
  }

  function buildContextCompressionConfig(): ContextCompressionConfig {
    return {
      maxTokens: config.maxContextTokens,
      softThresholdRatio: 0.5,
      hardThresholdRatio: 0.8,
      partialKeepRecentTurns: 5,
      fullKeepRecentTurns: 1,
    }
  }

  async function runRequest(body: unknown, emit: EmitFn | null): Promise<RunAgentServiceResult> {
    const payload = isRecord(body) ? body : {}
    const rawMessage = typeof payload.message === 'string' ? payload.message.trim() : ''
    const content = normalizeRequestContent(payload.content, rawMessage)
    if (!rawMessage && !contentHasUserInput(content)) {
      throw new Error('message is required')
    }

    const request: RunAgentServiceRequest = {
      sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : null,
      message: rawMessage,
    }
    if (content) {
      request.content = content
    }
    if (typeof payload.systemPrompt === 'string') {
      request.systemPrompt = payload.systemPrompt
    }
    if (typeof payload.systemPromptSuffix === 'string' && payload.systemPromptSuffix.trim()) {
      request.systemPromptSuffix = payload.systemPromptSuffix.trim()
    }
    if (typeof payload.model === 'string' && payload.model.trim()) {
      request.model = payload.model.trim()
    }
    const sandbox = normalizeSessionSandboxConfig(payload.sandbox)
    if (sandbox !== undefined) {
      request.sandbox = sandbox
    }

    return run(request, emit)
  }

  async function run(input: RunAgentServiceRequest, emit: EmitFn | null): Promise<RunAgentServiceResult> {
    const rawMessage = String(input.message || '').trim()
    const inputContent = normalizeRequestContent(input.content, rawMessage)
    if (!rawMessage && !contentHasUserInput(inputContent)) {
      throw new Error('message is required')
    }
    const userContent = inputContent || rawMessage
    const titleText = rawMessage || contentPreview(userContent)

    const requestedModel = typeof input.model === 'string' && input.model.trim()
      ? input.model.trim()
      : config.defaultModel

    const requestSandbox = normalizeSessionSandboxConfig(input.sandbox)
    let session: SessionRecord | null = null

    if (!input.createNewSession && typeof input.sessionId === 'string' && input.sessionId) {
      session = await config.sessionStore.loadSession(input.sessionId)
    }

    if (!session) {
      const sessionInput: {
        id?: string | undefined
        title: string
        systemPrompt?: string | undefined
        model: string
        sandbox?: SessionSandboxConfig | undefined
        loadedSkills?: string[] | undefined
      } = {
        title: input.title || sanitizeTitle(titleText),
        model: requestedModel,
      }
      if (input.forceSessionId) {
        sessionInput.id = input.forceSessionId
      }
      if (typeof input.systemPrompt === 'string') {
        sessionInput.systemPrompt = input.systemPrompt
      }
      if (requestSandbox !== undefined) {
        sessionInput.sandbox = requestSandbox
      }
      if (Array.isArray(input.loadedSkills)) {
        sessionInput.loadedSkills = input.loadedSkills
      }
      session = config.sessionStore.createSession(sessionInput)
    }

    if (typeof input.systemPrompt === 'string') {
      session.systemPrompt = normalizeSystemPrompt(input.systemPrompt)
    }
    if (requestSandbox !== undefined) {
      session.sandbox = requestSandbox
    }
    if (Array.isArray(input.loadedSkills)) {
      session.loadedSkills = input.loadedSkills.map((item) => String(item).trim()).filter(Boolean)
    }
    session.model = requestedModel

    const sandboxPolicy = buildSessionSandboxPolicy({
      sessionId: session.id,
      sessionSandbox: session.sandbox,
      defaultWorkspaceRoot: config.defaultWorkspaceRoot,
      sensitivePaths: config.sensitivePaths,
      enablePathSandbox: config.enablePathSandbox,
    })

    await ensureSandboxLayout(sandboxPolicy)

    const skillState: SkillRuntimeState = {
      loadedSkillNames: new Set(session.loadedSkills || []),
    }

    const availableSkills = refreshSkills([resolveWorkspaceSkillRoot(sandboxPolicy.workspaceRoot)])
    const toolRegistry = createToolRegistry(config.toolRegistryOptions, {
      sessionId: session.id,
      sessionSandbox: session.sandbox,
      availableSkills,
      skillState,
    })

    const memoryScope = resolveMemoryScope({
      session,
      sandbox: requestSandbox,
      defaultWorkspaceRoot: config.defaultWorkspaceRoot,
      messageMeta: input.messageMeta,
    })
    const memoryQuery = contentPreview(userContent)
    const relevantMemories = config.memoryEnabled
      ? await config.memoryStore.search({
        scope: memoryScope,
        query: memoryQuery,
        limit: 6,
      })
      : []
    const memoryPromptBlock = config.memoryEnabled
      ? buildMemoryPromptBlock({
        sessionMemory: session.memory,
        memories: relevantMemories,
      })
      : ''

    const userMessage: SessionMessageRecord = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userContent,
      createdAt: new Date().toISOString(),
      meta: input.messageMeta,
    }
    session.messages.push(userMessage)
    session.updatedAt = new Date().toISOString()
    if (session.messages.filter((message) => message.role === 'user').length === 1) {
      session.title = sanitizeTitle(titleText) || session.title
    }

    emit?.('session', {
      session: config.sessionStore.summarizeSession(session),
      state: 'started',
    })

    const effectiveSystemPrompt = appendSystemPromptSuffix(session.systemPrompt, input.systemPromptSuffix)
    const runtimeSystemPrompt = buildRuntimeSystemPrompt({
      basePrompt: effectiveSystemPrompt,
      tools: toolRegistry,
      availableSkills,
      sandboxPolicy,
      memoryPromptBlock,
    })
    const contextMessages = session.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }))
    const contextPreparation = prepareContextWindow({
      messages: contextMessages,
      systemPrompt: runtimeSystemPrompt,
      tools: toolRegistry,
      config: buildContextCompressionConfig(),
    })
    const agentMessages = contextPreparation.messages
    session.contextWindow = contextPreparation.state

    emit?.('context:state', {
      sessionId: session.id,
      contextWindow: contextPreparation.state,
    })

    const result = await agent.run({
      messages: agentMessages,
      model: session.model,
      systemPrompt: runtimeSystemPrompt,
      tools: toolRegistry,
      skillState,
      emit: emit ?? undefined,
    })

    session.loadedSkills = result.loadedSkills || []

    const newMessages = result.finalMessages.slice(agentMessages.length)
    const persistedNewMessages = newMessages.map((message): SessionMessageRecord => ({
      id: crypto.randomUUID(),
      role: message.role,
      content: message.content,
      createdAt: new Date().toISOString(),
    }))
    session.messages.push(...persistedNewMessages)
    session.updatedAt = new Date().toISOString()

    const run = result.run
    run.sessionId = session.id
    run.contextWindow = contextPreparation.state

    if (config.memoryEnabled) {
      const completedRun = {
        sessionId: session.id,
        runId: run.id,
        userMessage,
        assistantMessages: persistedNewMessages.filter((message) => message.role === 'assistant'),
        toolExecutions: run.toolExecutions,
        sandbox: session.sandbox,
        source: input.messageMeta?.source,
        scope: memoryScope,
      }
      session.memory = updateSessionMemory({
        current: session.memory,
        completedRun,
      })
      const candidates = extractMemoryCandidates(completedRun)
      for (const candidate of candidates.filter((item) => item.confidence >= 0.72)) {
        await config.memoryStore.addCandidate(candidate)
      }
      await createPostRunProposals({
        completedRun,
        candidates,
        proposalStore: config.proposalStore,
      })
    }

    await config.sessionStore.saveSession(session)
    emit?.('session', {
      session: config.sessionStore.summarizeSession(session),
      state: 'saved',
    })

    return {
      reply: result.reply,
      session,
      run,
    }
  }

  function buildAgentMessages(sessionMessages: SessionMessageRecord[], maxMessages: number): AgentMessage[] {
    return sessionMessages.slice(-maxMessages).map((message) => ({
      role: message.role,
      content: message.content,
    }))
  }

  return {
    runRequest,
    run,
    normalizeSystemPrompt,
    buildSystemPrompt,
  }
}

function appendSystemPromptSuffix(basePrompt: string, suffix: string | undefined): string {
  const trimmedSuffix = String(suffix || '').trim()
  if (!trimmedSuffix) {
    return basePrompt
  }
  return `${basePrompt.trim()}\n\n${trimmedSuffix}`
}

function normalizeRequestContent(value: unknown, fallbackText: string): AgentContentBlock[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
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
    if (record.type === 'image' && typeof record.image === 'string') {
      const image = record.image.trim()
      if (!isAllowedImageSource(image)) {
        continue
      }
      const imageBlock: AgentContentBlock = {
        type: 'image',
        image,
      }
      if (typeof record.mediaType === 'string' && isAllowedImageMediaType(record.mediaType)) {
        imageBlock.mediaType = record.mediaType.trim().toLowerCase()
      }
      if (typeof record.filename === 'string' && record.filename.trim()) {
        imageBlock.filename = record.filename.trim().slice(0, 160)
      }
      blocks.push(imageBlock)
    }
  }

  if (!blocks.some((block) => block.type === 'text') && fallbackText) {
    blocks.unshift({ type: 'text', text: fallbackText })
  }

  return blocks.length > 0 ? blocks : undefined
}

function contentHasUserInput(content: AgentContentBlock[] | undefined): boolean {
  return Boolean(content?.some((block) => {
    if (block.type === 'text') {
      return block.text.trim().length > 0
    }
    return block.type === 'image'
  }))
}

function contentPreview(content: string | AgentContentBlock[]): string {
  if (typeof content === 'string') {
    return content
  }
  return content.map((block) => {
    if (block.type === 'text') {
      return block.text
    }
    if (block.type === 'image') {
      return `[image${block.filename ? `: ${block.filename}` : ''}]`
    }
    if (block.type === 'tool_use') {
      return `Tool call ${block.name}`
    }
    return `Tool result ${block.tool_name || block.tool_use_id}`
  }).join(' ').trim()
}

function isAllowedImageSource(value: string): boolean {
  return /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(value)
    || /^https?:\/\//i.test(value)
}

function isAllowedImageMediaType(value: string): boolean {
  return /^image\/(png|jpe?g|webp|gif)$/i.test(value.trim())
}

function buildRuntimeDateContext(now = new Date()): string {
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const day = now.getDate()

  return [
    '## Runtime Context',
    `- Current date: ${year}年${month}月${day}日`,
  ].join('\n')
}
