#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotEnv } from 'dotenv'

const FEISHU_OPEN_BASE = 'https://open.feishu.cn/open-apis'
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..')

loadDotEnv({ path: path.join(REPO_ROOT, '.env') })
loadDotEnv({ path: path.join(REPO_ROOT, '.env.local'), override: true })

export function parseArgs(argv) {
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

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

export function fail(message, details) {
  const payload = { ok: false, error: message }
  if (details !== undefined) {
    payload.details = details
  }
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`)
  process.exit(1)
}

export function requireArg(args, name) {
  const value = typeof args[name] === 'string' ? String(args[name]).trim() : ''
  if (!value) {
    fail(`Missing required argument --${name}`)
  }
  return value
}

export async function getTenantAccessToken(args) {
  const directToken = firstNonEmpty(
    args.token,
    process.env.FEISHU_TENANT_ACCESS_TOKEN,
    process.env.FEISHU_ACCESS_TOKEN
  )
  if (directToken) {
    return directToken
  }

  const appId = firstNonEmpty(args['app-id'], process.env.FEISHU_APP_ID)
  const appSecret = firstNonEmpty(args['app-secret'], process.env.FEISHU_APP_SECRET)
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

export async function uploadImage({ token, filePath, imageType = 'message' }) {
  const fileName = path.basename(filePath)
  const mimeType = inferMimeType(fileName)
  const buffer = await readFile(filePath)
  const form = new FormData()
  form.set('image_type', imageType)
  form.set('image', new Blob([buffer], { type: mimeType }), fileName)

  const response = await fetchJson(`${FEISHU_OPEN_BASE}/im/v1/images`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  })

  const imageKey = typeof response?.data?.image_key === 'string'
    ? response.data.image_key
    : ''
  if (!imageKey) {
    fail('Image upload did not return image_key.', response)
  }
  return { imageKey, response }
}

export async function uploadFile({ token, filePath, fileType, fileName, durationMs }) {
  const resolvedFileName = fileName || path.basename(filePath)
  const resolvedFileType = fileType || inferFeishuFileType(resolvedFileName)
  const mimeType = inferMimeType(resolvedFileName)
  const buffer = await readFile(filePath)
  const form = new FormData()
  form.set('file_type', resolvedFileType)
  form.set('file_name', resolvedFileName)
  if (durationMs) {
    form.set('duration', String(durationMs))
  }
  form.set('file', new Blob([buffer], { type: mimeType }), resolvedFileName)

  const response = await fetchJson(`${FEISHU_OPEN_BASE}/im/v1/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  })

  const fileKey = typeof response?.data?.file_key === 'string'
    ? response.data.file_key
    : ''
  if (!fileKey) {
    fail('File upload did not return file_key.', response)
  }
  return { fileKey, response, fileType: resolvedFileType, fileName: resolvedFileName }
}

export async function sendMessage({ token, receiveIdType, receiveId, msgType, content, uuid }) {
  const query = new URLSearchParams({
    receive_id_type: receiveIdType,
  })
  const body = {
    receive_id: receiveId,
    msg_type: msgType,
    content: JSON.stringify(content),
  }
  if (uuid) {
    body.uuid = uuid
  }

  const response = await fetchJson(`${FEISHU_OPEN_BASE}/im/v1/messages?${query.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  })

  const messageId = typeof response?.data?.message_id === 'string'
    ? response.data.message_id
    : ''
  if (!messageId) {
    fail('Message send did not return message_id.', response)
  }
  return response
}

export async function downloadMessageResource({ token, messageId, fileKey, type, outputPath, outputDir }) {
  const query = new URLSearchParams({ type })
  const url = `${FEISHU_OPEN_BASE}/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}?${query.toString()}`
  return downloadBinary({ token, url, outputPath, outputDir, fallbackName: fileKey })
}

export async function downloadImageByKey({ token, imageKey, outputPath, outputDir }) {
  const url = `${FEISHU_OPEN_BASE}/im/v1/images/${encodeURIComponent(imageKey)}`
  return downloadBinary({ token, url, outputPath, outputDir, fallbackName: imageKey })
}

async function downloadBinary({ token, url, outputPath, outputDir, fallbackName }) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    const details = await readErrorPayload(response)
    fail(`Request failed: ${response.status} ${response.statusText}`, details)
  }

  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const contentType = response.headers.get('content-type') || 'application/octet-stream'
  const targetPath = await resolveOutputPath({
    outputPath,
    outputDir,
    headers: response.headers,
    contentType,
    fallbackName,
  })

  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, buffer)

  return {
    path: targetPath,
    contentType,
    size: buffer.length,
  }
}

async function resolveOutputPath({ outputPath, outputDir, headers, contentType, fallbackName }) {
  if (outputPath) {
    return path.resolve(outputPath)
  }

  const fileName = extractFileName(headers) || `${fallbackName}${extensionFromContentType(contentType)}`
  const baseDir = outputDir ? path.resolve(outputDir) : process.cwd()
  return path.join(baseDir, fileName)
}

async function fetchJson(url, options) {
  const response = await fetch(url, options)
  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = { raw: text }
  }

  if (!response.ok) {
    fail(`Request failed: ${response.status} ${response.statusText}`, payload)
  }

  if (payload && typeof payload.code === 'number' && payload.code !== 0) {
    fail(`Feishu API error: ${payload.msg || 'unknown error'}`, payload)
  }

  return payload
}

async function readErrorPayload(response) {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : { status: response.status }
  } catch {
    return {
      status: response.status,
      raw: text,
    }
  }
}

function extractFileName(headers) {
  const disposition = headers.get('content-disposition') || ''
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1])
  }
  const basicMatch = disposition.match(/filename="?([^"]+)"?/i)
  if (basicMatch?.[1]) {
    return basicMatch[1]
  }
  return ''
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (normalized) {
      return normalized
    }
  }
  return ''
}

export function inferFeishuFileType(fileName) {
  const extension = path.extname(fileName).replace(/^\./, '').toLowerCase()
  switch (extension) {
    case 'opus':
      return 'opus'
    case 'mp4':
      return 'mp4'
    case 'pdf':
      return 'pdf'
    case 'doc':
      return 'doc'
    case 'xls':
      return 'xls'
    case 'ppt':
      return 'ppt'
    default:
      return 'stream'
  }
}

export function inferMimeType(fileName) {
  const extension = path.extname(fileName).replace(/^\./, '').toLowerCase()
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    case 'ico':
      return 'image/x-icon'
    case 'tiff':
      return 'image/tiff'
    case 'heic':
      return 'image/heic'
    case 'pdf':
      return 'application/pdf'
    case 'doc':
      return 'application/msword'
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'xls':
      return 'application/vnd.ms-excel'
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'ppt':
      return 'application/vnd.ms-powerpoint'
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    case 'mp4':
      return 'video/mp4'
    case 'mp3':
      return 'audio/mpeg'
    case 'opus':
      return 'audio/ogg'
    case 'txt':
      return 'text/plain'
    case 'json':
      return 'application/json'
    default:
      return 'application/octet-stream'
  }
}

function extensionFromContentType(contentType) {
  const normalized = String(contentType || '').split(';')[0].trim().toLowerCase()
  switch (normalized) {
    case 'image/jpeg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/gif':
      return '.gif'
    case 'image/webp':
      return '.webp'
    case 'application/pdf':
      return '.pdf'
    case 'video/mp4':
      return '.mp4'
    case 'audio/mpeg':
      return '.mp3'
    case 'audio/ogg':
      return '.opus'
    case 'text/plain':
      return '.txt'
    case 'application/json':
      return '.json'
    default:
      return ''
  }
}
