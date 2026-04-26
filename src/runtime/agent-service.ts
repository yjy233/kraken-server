import crypto from 'node:crypto'
import type { ToolDefinition, AgentMessage, EmitFn, RunResult } from '../agent/types.js'
import { ReActAgent } from '../agent/react-agent.js'
import { createToolRegistry, type CreateRegistryOptions } from '../tools/registry.js'
import {
  buildSandboxPromptContext,
  buildSessionSandboxPolicy,
  ensureSandboxLayout,
  normalizeSessionSandboxConfig,
} from '../tools/sandbox.js'
import type { SessionSandboxConfig, SessionSandboxPolicy } from '../tools/types.js'
import { getAvailableSkills } from '../skills/manager.js'
import type { SkillRuntimeState } from '../skills/types.js'
import { extractBaseSystemPrompt, PromptBuilder } from '../agent/prompt-builder.js'
import {
  isRecord,
  sanitizeTitle,
} from '../utils/helpers.js'
import type { SessionMessageRecord, SessionRecord } from './session-store.js'

export interface AgentServiceConfig {
  defaultModel: string
  baseSystemPrompt: string
  maxSteps: number
  maxTokens: number
  timeout: number
  maxContextMessages: number
  defaultWorkspaceRoot: string
  sensitivePaths: string[]
  enablePathSandbox: boolean
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
  message: string
  model?: string
  sandbox?: SessionSandboxConfig | undefined
  loadedSkills?: string[] | undefined
  createNewSession?: boolean
  title?: string
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

  function buildSystemPrompt(basePrompt: string, tools: ToolDefinition[]): string {
    return new PromptBuilder(
      normalizeSystemPrompt(basePrompt),
      tools,
      getAvailableSkills()
    ).build()
  }

  function buildRuntimeSystemPrompt(basePrompt: string, tools: ToolDefinition[], sandboxPolicy: SessionSandboxPolicy): string {
    return [
      buildSystemPrompt(basePrompt, tools),
      '',
      buildSandboxPromptContext(sandboxPolicy),
    ].join('\n')
  }

  async function runRequest(body: unknown, emit: EmitFn | null): Promise<RunAgentServiceResult> {
    const payload = isRecord(body) ? body : {}
    const rawMessage = typeof payload.message === 'string' ? payload.message.trim() : ''
    if (!rawMessage) {
      throw new Error('message is required')
    }

    const request: RunAgentServiceRequest = {
      sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : null,
      message: rawMessage,
    }
    if (typeof payload.systemPrompt === 'string') {
      request.systemPrompt = payload.systemPrompt
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
    if (!rawMessage) {
      throw new Error('message is required')
    }

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
        title: string
        systemPrompt?: string | undefined
        model: string
        sandbox?: SessionSandboxConfig | undefined
        loadedSkills?: string[] | undefined
      } = {
        title: input.title || sanitizeTitle(rawMessage),
        model: requestedModel,
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

    const availableSkills = getAvailableSkills()
    const toolRegistry = createToolRegistry(config.toolRegistryOptions, {
      sessionId: session.id,
      sessionSandbox: session.sandbox,
      availableSkills,
      skillState,
    })

    const userMessage: SessionMessageRecord = {
      id: crypto.randomUUID(),
      role: 'user',
      content: rawMessage,
      createdAt: new Date().toISOString(),
    }
    session.messages.push(userMessage)
    session.updatedAt = new Date().toISOString()
    if (session.messages.filter((message) => message.role === 'user').length === 1) {
      session.title = sanitizeTitle(rawMessage) || session.title
    }

    emit?.('session', {
      session: config.sessionStore.summarizeSession(session),
      state: 'started',
    })

    const agentMessages = buildAgentMessages(session.messages, config.maxContextMessages)

    const result = await agent.run({
      messages: agentMessages,
      model: session.model,
      systemPrompt: buildRuntimeSystemPrompt(session.systemPrompt, toolRegistry, sandboxPolicy),
      tools: toolRegistry,
      skillState,
      emit: emit ?? undefined,
    })

    session.loadedSkills = result.loadedSkills || []

    const finalText = result.reply
    const assistantMessage: SessionMessageRecord = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: finalText,
      createdAt: new Date().toISOString(),
    }
    session.messages.push(assistantMessage)
    session.updatedAt = new Date().toISOString()

    const run = result.run
    run.sessionId = session.id

    await config.sessionStore.saveSession(session)
    emit?.('session', {
      session: config.sessionStore.summarizeSession(session),
      state: 'saved',
    })

    return {
      reply: finalText,
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
