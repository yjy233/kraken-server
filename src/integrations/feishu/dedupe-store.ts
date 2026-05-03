import { promises as fs } from 'node:fs'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export function createFeishuDedupeStore(rootDir: string, ttlMs: number) {
  mkdirSync(rootDir, { recursive: true })
  const filePath = path.join(rootDir, 'dedupe.json')

  async function has(key: string): Promise<boolean> {
    if (!key) {
      return false
    }
    const state = await readState()
    const now = Date.now()
    let changed = false

    for (const [entryKey, expiresAt] of Object.entries(state)) {
      if (!Number.isFinite(expiresAt) || expiresAt <= now) {
        delete state[entryKey]
        changed = true
      }
    }

    if (changed) {
      await writeState(state)
    }

    return typeof state[key] === 'number' && state[key] > now
  }

  async function remember(key: string): Promise<void> {
    if (!key) {
      return
    }
    const state = await readState()
    state[key] = Date.now() + ttlMs
    await writeState(state)
  }

  return {
    has,
    remember,
    filePath,
  }

  async function readState(): Promise<Record<string, number>> {
    if (!existsSync(filePath)) {
      return {}
    }
    try {
      const raw = await fs.readFile(filePath, 'utf8')
      const parsed = JSON.parse(raw) as Record<string, number>
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  async function writeState(state: Record<string, number>): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf8')
  }
}
