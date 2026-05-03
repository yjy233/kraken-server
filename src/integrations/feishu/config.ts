import { clampInteger, parseBoolean } from '../../utils/helpers.js'
import type { FeishuConfig } from './types.js'

export function readFeishuConfig(env: NodeJS.ProcessEnv = process.env): FeishuConfig {
  const eventMode = env.FEISHU_EVENT_MODE === 'http' ? 'http' : 'ws'
  const sessionMode = env.FEISHU_SESSION_MODE === 'user' ? 'user' : 'chat'
  const streamingEnabled = parseBoolean(env.FEISHU_STREAMING_ENABLED, false)
  const streamingMode = streamingEnabled && env.FEISHU_STREAMING_MODE !== 'none' ? 'update' : 'none'

  const config: FeishuConfig = {
    enabled: parseBoolean(env.FEISHU_ENABLED, false),
    eventMode,
    appId: String(env.FEISHU_APP_ID || '').trim(),
    appSecret: String(env.FEISHU_APP_SECRET || '').trim(),
    sessionMode,
    replyMode: env.FEISHU_REPLY_MODE === 'send' ? 'send' : 'reply',
    maxConcurrency: clampInteger(env.FEISHU_MAX_CONCURRENCY, 1, 1, 8),
    dedupeTtlMs: clampInteger(env.FEISHU_DEDUPE_TTL_MS, 600_000, 60_000, 24 * 60 * 60 * 1000),
    includeMessageMeta: parseBoolean(env.FEISHU_INCLUDE_MESSAGE_META, true),
    streamingEnabled,
    streamingMode,
    streamingFlushIntervalMs: clampInteger(env.FEISHU_STREAMING_FLUSH_INTERVAL_MS, 1500, 500, 10_000),
    streamingMinDeltaChars: clampInteger(env.FEISHU_STREAMING_MIN_DELTA_CHARS, 80, 1, 4000),
    streamingMaxUpdates: clampInteger(env.FEISHU_STREAMING_MAX_UPDATES, 20, 1, 200),
  }

  const verificationToken = optionalString(env.FEISHU_VERIFICATION_TOKEN)
  if (verificationToken) {
    config.verificationToken = verificationToken
  }
  const encryptKey = optionalString(env.FEISHU_ENCRYPT_KEY)
  if (encryptKey) {
    config.encryptKey = encryptKey
  }
  const defaultSystemPrompt = optionalString(env.FEISHU_DEFAULT_SYSTEM_PROMPT)
  if (defaultSystemPrompt) {
    config.defaultSystemPrompt = defaultSystemPrompt
  }
  const channelSkill = optionalString(env.FEISHU_CHANNEL_SKILL) || 'dingtakl-feishu-cn'
  if (channelSkill) {
    config.channelSkill = channelSkill
  }

  return config
}

export function validateFeishuConfig(config: FeishuConfig): string[] {
  const errors: string[] = []
  if (!config.enabled) {
    return errors
  }
  if (!config.appId) {
    errors.push('FEISHU_APP_ID is required when FEISHU_ENABLED=true')
  }
  if (!config.appSecret) {
    errors.push('FEISHU_APP_SECRET is required when FEISHU_ENABLED=true')
  }
  if (config.eventMode === 'http' && !config.verificationToken) {
    errors.push('FEISHU_VERIFICATION_TOKEN is required when FEISHU_EVENT_MODE=http')
  }
  return errors
}

function optionalString(value: unknown): string | undefined {
  const normalized = String(value || '').trim()
  return normalized || undefined
}
