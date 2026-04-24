/**
 * 通用辅助函数集合
 * 被 server、tools、agent 等多个模块共享。
 */

import { existsSync, readFileSync } from 'node:fs'

/** 将未知值解析为整数，失败时返回 fallback */
export function parseInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** 将字符串解析为布尔值，支持 1/true/yes/on */
export function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

/** 解析整数并限制在 [min, max] 范围内 */
export function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number'
    ? value
    : parseInteger(typeof value === 'string' ? value : undefined, fallback)
  return Math.max(min, Math.min(max, parsed))
}

/** 清理标题：压缩空格、截断到 60 字符 */
export function sanitizeTitle(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

/** 将所有连续空白压缩为单个空格 */
export function collapseWhitespace(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

/** 截断字符串，超出长度时用省略号 */
export function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value
}

/** 判断值是否为普通对象（非 null） */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 校验会话 ID 是否只包含安全字符 */
export function isSafeSessionId(value: unknown): boolean {
  return /^[a-zA-Z0-9-]+$/.test(String(value || ''))
}

/** 加载 .env 文件到 process.env（不会覆盖已有环境变量） */
export function loadDotEnv(filePath: string): void {
  if (!existsSync(filePath)) {
    return
  }
  const file = readFileSync(filePath, 'utf8')
  for (const rawLine of file.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const separatorIndex = line.indexOf('=')
    if (separatorIndex === -1) {
      continue
    }
    const key = line.slice(0, separatorIndex).trim()
    const value = stripWrappedQuotes(line.slice(separatorIndex + 1).trim())
    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

/** 去掉字符串首尾的单双引号包裹 */
function stripWrappedQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}
