#!/usr/bin/env node

import path from 'node:path'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { config as loadDotEnv } from 'dotenv'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const SKILL_ROOT = path.resolve(SCRIPT_DIR, '..')
const REPO_ROOT = path.resolve(SKILL_ROOT, '../..')
const DEFAULT_PROXY_URL = 'http://127.0.0.1:7897'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL_NAME = 'google/gemini-3-pro-image-preview'

loadDotEnv({ path: path.join(REPO_ROOT, '.env') })
loadDotEnv({ path: path.join(REPO_ROOT, '.env.local'), override: true })

if (!process.env.OPENROUTER_KEY && process.env.OPENROUTER_API_KEY) {
  process.env.OPENROUTER_KEY = process.env.OPENROUTER_API_KEY
}

export function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      continue
    }
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) {
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
  const value = typeof args[name] === 'string' ? args[name].trim() : ''
  if (!value) {
    fail(`Missing required argument --${name}`)
  }
  return value
}

export function normalizeResolution(value, fallback = '1K') {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (normalized === '1K' || normalized === '2K' || normalized === '4K') {
    return normalized
  }
  return fallback
}

export function resolveApiKey(args) {
  return firstNonEmpty(process.env.OPENROUTER_API_KEY, process.env.OPENROUTER_KEY)
}

export function resolveProxyUrl(args) {
  if (args.proxy !== undefined) {
    if (args.proxy === true) {
      fail('Missing value for --proxy. Use --proxy "http://host:port" or --proxy "" to disable proxy for one run.')
    }
    const proxy = String(args.proxy).trim()
    return proxy || null
  }
  const proxy = firstNonEmpty(
    process.env.NANO_BANANA_PROXY,
    DEFAULT_PROXY_URL,
  )
  return proxy || null
}

export function getDefaultOutputDir() {
  return path.join(SKILL_ROOT, 'output_images')
}

export function resolveOutputDir(args) {
  const target = typeof args['output-dir'] === 'string' && args['output-dir'].trim()
    ? args['output-dir'].trim()
    : getDefaultOutputDir()
  return path.resolve(target)
}

export async function ensureOutputDir(dirPath) {
  await mkdir(dirPath, { recursive: true })
}

export async function loadInputImageIfPresent(inputImagePath) {
  if (!inputImagePath) {
    return null
  }

  const absolutePath = path.resolve(inputImagePath)
  const bytes = await readFile(absolutePath)
  return {
    absolutePath,
    bytes,
    mimeType: guessMimeTypeFromPath(absolutePath),
  }
}

export function inferResolutionFromImage(inputImage, fallbackResolution) {
  if (!inputImage || fallbackResolution !== '1K') {
    return fallbackResolution
  }

  return fallbackResolution
}

export async function generateImage({
  prompt,
  filename,
  inputImagePath,
  resolution,
  apiKey,
  outputDir,
  proxyUrl,
}) {
  if (!apiKey) {
    fail('No API key provided. Set OPENROUTER_API_KEY or OPENROUTER_KEY in .env / .env.local.')
  }

  const inputImage = await loadInputImageIfPresent(inputImagePath)
  const outputResolution = inferResolutionFromImage(inputImage, resolution)

  await ensureOutputDir(outputDir)
  const outputPath = path.join(outputDir, filename)

  const payload = {
    model: MODEL_NAME,
    messages: [
      {
        role: 'user',
        content: buildContent(prompt, inputImage),
      },
    ],
    modalities: ['image', 'text'],
    image_config: {
      image_size: outputResolution,
    },
  }

  const response = await postOpenRouter({
    payload,
    apiKey,
    proxyUrl,
  })

  const choice = Array.isArray(response?.choices) ? response.choices[0] : null
  const message = choice?.message || {}
  const images = Array.isArray(message.images) ? message.images : []
  const imageUrl = images[0]?.image_url?.url
  if (!imageUrl || !imageUrl.includes(',')) {
    fail('No image was generated in the response.', response)
  }

  const imageBytes = decodeDataUrl(imageUrl)
  await writeFile(outputPath, imageBytes)

  return {
    outputPath: path.resolve(outputPath),
    resolution: outputResolution,
    modelResponse: typeof message.content === 'string' ? message.content : '',
    usedProxy: proxyUrl,
    edited: Boolean(inputImage),
  }
}

export function generateFilenameFromPrompt(prompt) {
  const timestamp = formatTimestamp(new Date())
  const words = String(prompt)
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((word) => word.toLowerCase().replace(/[^a-z0-9-]/g, ''))
    .filter(Boolean)
  const suffix = words.length > 0 ? words.join('-') : 'generated'
  return `${timestamp}-${suffix}.png`
}

async function postOpenRouter({ payload, apiKey, proxyUrl }) {
  const dispatcher = proxyUrl ? await createProxyDispatcher(proxyUrl) : undefined
  let response
  try {
    response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      dispatcher,
    })
  } catch (error) {
    if (!proxyUrl) {
      throw error
    }
    return postOpenRouterWithCurl({ payload, apiKey, proxyUrl })
  }

  const text = await response.text()
  const data = safeJsonParse(text)
  if (!response.ok) {
    fail(`OpenRouter API error: HTTP ${response.status}`, data || text)
  }
  return data
}

async function postOpenRouterWithCurl({ payload, apiKey, proxyUrl }) {
  const payloadPath = path.join(tmpdir(), `nano-banana-openrouter-${process.pid}-${Date.now()}.json`)
  await writeFile(payloadPath, JSON.stringify(payload))

  const args = [
    '--silent',
    '--show-error',
    '--fail-with-body',
    '--max-time',
    '300',
    '--config',
    '-',
    '--data-binary',
    `@${payloadPath}`,
  ]
  const config = [
    `url = "${OPENROUTER_URL}"`,
    'request = "POST"',
    `proxy = "${proxyUrl}"`,
    `header = "Authorization: Bearer ${apiKey}"`,
    'header = "Content-Type: application/json"',
    '',
  ].join('\n')

  try {
    const { stdout, stderr } = await runCurl(args, config)
    const data = safeJsonParse(stdout)
    if (!data) {
      fail('OpenRouter curl fallback returned non-JSON response.', stderr || stdout)
    }
    return data
  } finally {
    await unlink(payloadPath).catch(() => {})
  }
}

function runCurl(args, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new Error(stderr || `curl exited with status ${code}`))
    })

    child.stdin.end(stdin)
  })
}

function buildContent(prompt, inputImage) {
  if (!inputImage) {
    return prompt
  }

  return [
    {
      type: 'image_url',
      image_url: {
        url: bytesToDataUrl(inputImage.bytes, inputImage.mimeType),
      },
    },
    {
      type: 'text',
      text: prompt,
    },
  ]
}

function bytesToDataUrl(bytes, mimeType) {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`
}

function decodeDataUrl(dataUrl) {
  const parts = String(dataUrl).split(',', 2)
  if (parts.length !== 2) {
    fail('Invalid image data URL returned by model.')
  }
  return Buffer.from(parts[1], 'base64')
}

function guessMimeTypeFromPath(filePath) {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'image/jpeg'
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp'
  }
  if (lower.endsWith('.gif')) {
    return 'image/gif'
  }
  return 'image/png'
}

async function createProxyDispatcher(proxyUrl) {
  try {
    const { ProxyAgent } = await import('undici')
    return new ProxyAgent(proxyUrl)
  } catch (error) {
    fail('Proxy support requires undici. Install it or disable proxy.', error instanceof Error ? error.message : String(error))
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function formatTimestamp(date) {
  const parts = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ]
  return `${parts[0]}-${parts[1]}-${parts[2]}-${parts[3]}-${parts[4]}-${parts[5]}`
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}
