import { promises as fs } from 'node:fs'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { FeishuConversationBinding } from './types.js'

export function createFeishuSessionMap(rootDir: string) {
  mkdirSync(rootDir, { recursive: true })
  const filePath = path.join(rootDir, 'map.json')

  async function get(conversationKey: string): Promise<FeishuConversationBinding | null> {
    const state = await readState()
    return state[conversationKey] || null
  }

  async function set(conversationKey: string, binding: FeishuConversationBinding): Promise<void> {
    const state = await readState()
    state[conversationKey] = binding
    await writeState(state)
  }

  return {
    get,
    set,
    filePath,
  }

  async function readState(): Promise<Record<string, FeishuConversationBinding>> {
    if (!existsSync(filePath)) {
      return {}
    }
    try {
      const raw = await fs.readFile(filePath, 'utf8')
      const parsed = JSON.parse(raw) as Record<string, FeishuConversationBinding>
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  async function writeState(state: Record<string, FeishuConversationBinding>): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf8')
  }
}
