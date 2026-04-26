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

export interface SessionMessageRecord {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface SessionRecord {
  id: string
  title: string
  model: string
  systemPrompt: string
  sandbox?: SessionSandboxConfig | undefined
  loadedSkills?: string[] | undefined
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
    title: string
    systemPrompt?: string | undefined
    model: string
    sandbox?: SessionSandboxConfig | undefined
    loadedSkills?: string[] | undefined
  }): SessionRecord {
    const timestamp = new Date().toISOString()
    return {
      id: crypto.randomUUID(),
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
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
      preview: lastMessage ? truncate(collapseWhitespace(lastMessage.content), 100) : '',
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
    session.messages = Array.isArray(session.messages) ? session.messages : []
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
