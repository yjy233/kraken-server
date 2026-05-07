#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotEnv } from 'dotenv'

const FEISHU_OPEN_BASE = 'https://open.feishu.cn/open-apis'
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..')

loadDotEnv({ path: path.join(REPO_ROOT, '.env') })
loadDotEnv({ path: path.join(REPO_ROOT, '.env.local'), override: true })

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printUsage()
    return
  }

  const receiveId = requireArg(args, 'receive-id')
  const receiveIdType = valueOr(args['receive-id-type'], 'chat_id')
  const title = valueOr(args.title, 'Kraken News Digest')
  const text = await resolveText(args)
  const token = await getTenantAccessToken(args)

  const content = buildCardContent(title, text)
  const query = new URLSearchParams({ receive_id_type: receiveIdType })
  const response = await fetchJson(`${FEISHU_OPEN_BASE}/im/v1/messages?${query.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: 'interactive',
      content: JSON.stringify(content),
    }),
  })

  const messageId = typeof response?.data?.message_id === 'string'
    ? response.data.message_id
    : ''
  if (!messageId) {
    fail('Message send did not return message_id.', response)
  }

  printJson({
    ok: true,
    mode: 'send_text',
    receiveIdType,
    receiveId,
    messageId,
    response: response.data || response,
  })
}

async function resolveText(args) {
  const directText = valueOr(args.text, '')
  if (directText) {
    return directText
  }

  const textFile = valueOr(args['text-file'], '')
  if (textFile) {
    return (await readFile(textFile, 'utf8')).trim()
  }

  fail('Provide either --text or --text-file.')
}

function buildCardContent(title, text) {
  const normalized = normalizeMarkdownForFeishuCard(text, title)
  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: 'blue',
      title: {
        tag: 'plain_text',
        content: title,
      },
    },
    elements: [
      {
        tag: 'markdown',
        content: normalized || 'No content',
      },
    ],
  }
}

function normalizeMarkdownForFeishuCard(markdown, title) {
  const normalizedTitle = String(title || '').trim()
  const lines = String(markdown || '')
    .replace(/\r\n/g, '\n')
    .split('\n')

  const output = []
  let skippedTitle = false

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/g, '')
    const trimmed = line.trim()

    if (!trimmed) {
      if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('')
      }
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const headingText = headingMatch[2]?.trim() || ''
      if (!skippedTitle && normalizedTitle && headingText === normalizedTitle) {
        skippedTitle = true
        continue
      }

      output.push(`**${headingText}**`)
      output.push('')
      continue
    }

    output.push(line)
  }

  while (output.length > 0 && output[output.length - 1] === '') {
    output.pop()
  }

  return output.join('\n')
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      continue
    }
    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      args[key] = true
      continue
    }
    args[key] = next
    index += 1
  }
  return args
}

function printUsage() {
  process.stdout.write(`Usage:
  node skills/news-digest-feishu/scripts/send_text.js --receive-id oc_xxx --title "今日新闻摘要" --text-file ./digest.md
  node skills/news-digest-feishu/scripts/send_text.js --receive-id oc_xxx --title "今日新闻摘要" --text "# 今日新闻摘要"

Env:
  FEISHU_APP_ID / FEISHU_APP_SECRET
  or FEISHU_TENANT_ACCESS_TOKEN
`)
}

function requireArg(args, name) {
  const value = valueOr(args[name], '')
  if (!value) {
    fail(`Missing required argument --${name}`)
  }
  return value
}

function valueOr(value, fallback) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized || fallback
}

async function getTenantAccessToken(args) {
  const directToken = valueOr(args.token, '') ||
    valueOr(process.env.FEISHU_TENANT_ACCESS_TOKEN, '') ||
    valueOr(process.env.FEISHU_ACCESS_TOKEN, '')
  if (directToken) {
    return directToken
  }

  const appId = valueOr(args['app-id'], '') || valueOr(process.env.FEISHU_APP_ID, '')
  const appSecret = valueOr(args['app-secret'], '') || valueOr(process.env.FEISHU_APP_SECRET, '')
  if (!appId || !appSecret) {
    fail('Missing Feishu credentials. Provide --token or FEISHU_TENANT_ACCESS_TOKEN, or provide --app-id/--app-secret or FEISHU_APP_ID/FEISHU_APP_SECRET.')
  }

  const response = await fetchJson(`${FEISHU_OPEN_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret,
    }),
  })

  const token = typeof response?.tenant_access_token === 'string'
    ? response.tenant_access_token
    : ''
  if (!token) {
    fail('Failed to obtain tenant access token.', response)
  }
  return token
}

async function fetchJson(url, init) {
  const response = await fetch(url, init)
  const text = await response.text()
  let payload = {}
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = { raw: text }
  }
  if (!response.ok || payload?.code) {
    fail(`Request failed: ${response.status} ${response.statusText}`, payload)
  }
  return payload
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function fail(message, details) {
  const payload = { ok: false, error: message }
  if (details !== undefined) {
    payload.details = details
  }
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`)
  process.exit(1)
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
