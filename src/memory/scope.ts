import path from 'node:path'
import type { SessionRecord, SessionMessageMeta } from '../runtime/session-store.js'
import type { SessionSandboxConfig } from '../tools/types.js'
import type { MemoryScope } from './types.js'

export function resolveMemoryScope(input: {
  session: SessionRecord
  sandbox?: SessionSandboxConfig | undefined
  defaultWorkspaceRoot: string
  messageMeta?: SessionMessageMeta | undefined
}): MemoryScope {
  const feishu = input.messageMeta?.feishu
  if (feishu) {
    return {
      type: 'feishu-chat',
      key: `${feishu.chatType}:${feishu.chatId}`,
      label: `feishu:${feishu.chatType}:${feishu.chatId}`,
    }
  }

  if (input.messageMeta?.source === 'scheduler') {
    return {
      type: 'scheduler-job',
      key: input.session.id,
      label: `scheduler-session:${input.session.id}`,
    }
  }

  const workspaceRoot = String(
    input.sandbox?.workspaceRoot ||
    input.session.sandbox?.workspaceRoot ||
    input.defaultWorkspaceRoot ||
    ''
  ).trim()

  if (workspaceRoot) {
    return {
      type: 'workspace',
      key: normalizeWorkspaceKey(workspaceRoot),
      label: `workspace:${normalizeWorkspaceKey(workspaceRoot)}`,
    }
  }

  return {
    type: 'global',
    key: 'global',
    label: 'global',
  }
}

function normalizeWorkspaceKey(value: string): string {
  return path.resolve(value).replace(/\\/g, '/')
}
