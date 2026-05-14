#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { config as loadDotEnv } from 'dotenv'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..')
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL_NAME = 'google/gemini-3-pro-image-preview'

loadDotEnv({ path: path.join(REPO_ROOT, '.env'), quiet: true })
loadDotEnv({ path: path.join(REPO_ROOT, '.env.local'), override: true, quiet: true })

const DIAGRAMS = [
  {
    id: 'overview',
    filename: 'kraken-self-improving-overview.png',
    prompt: [
      'Create a clean technical architecture diagram for a software design document.',
      'Title: Kraken Self-Improving Agent Architecture.',
      'White background, crisp vector-like engineering diagram, readable English labels.',
      'Show seven horizontal layers stacked top-to-bottom:',
      'L0 Channel Intake: Web UI, Feishu, Scheduler.',
      'L1 Runtime Orchestration: agentService.run, Session Store, Tool Runner, Sandbox, ReAct Loop.',
      'L2 Context Adaptation: Session Memory, Long-term Retrieval, Runtime Prompt.',
      'L3 Persistent Memory: JSONL Store, Scope Resolver, Keyword Index.',
      'L4 Reflection Extraction: Transcript Analyzer, Memory Candidates, Proposal Candidates.',
      'L5 Skill Evolution: Usage Telemetry, Skill Curator, Skill Proposal.',
      'L6 Governance: Proposal Review, Human Approval, Audit Log.',
      'Use arrows showing runtime flow downward and learning feedback upward.',
      'Minimal colors, no gradients, no logos, no watermark, avoid tiny text.',
    ].join(' '),
  },
  {
    id: 'runtime',
    filename: 'kraken-runtime-memory-injection.png',
    prompt: [
      'Create a clean box-and-arrow architecture diagram as a polished software design image.',
      'Title: Runtime Memory Injection Flow.',
      'White background, readable English labels, engineering document style.',
      'Left-to-right flow with boxes: Channel Entry, agentService.run, Session Store, Memory Store, Prompt Builder, ReActAgent, Post-run Extractor, Proposal Store.',
      'Arrows: load session, resolve scope, search scoped memory, build memory-context prompt, run agent with tools and image attachments, persist messages, update SessionMemoryState, write memories, create pending proposals.',
      'Highlight that retrieval failure degrades gracefully and proposal apply is not automatic.',
      'No decorative gradients, no logos, no watermark, avoid tiny text.',
    ].join(' '),
  },
  {
    id: 'memory',
    filename: 'kraken-memory-provider-layer.png',
    prompt: [
      'Create a clean technical architecture diagram.',
      'Title: Memory Provider Layer.',
      'White background, crisp boxes and arrows, readable English labels.',
      'Center: MemoryProvider Interface with methods initialize, search, write, update, forget.',
      'Left: Scope Resolver with workspace, Feishu p2p, Feishu group, scheduler, global.',
      'Bottom: Local JSONL Provider with memories.jsonl and keyword index.',
      'Right upgrade path: SQLite FTS5 Provider, Embedding Provider, Team Memory Provider.',
      'Top: Runtime Prompt Builder receives Relevant Long-term Memory.',
      'Show safety gates before write: secret filter, scope policy, confidence threshold.',
      'Use restrained colors, no logos, no watermark, avoid tiny text.',
    ].join(' '),
  },
  {
    id: 'reflection',
    filename: 'kraken-reflection-extraction.png',
    prompt: [
      'Create a clean pipeline diagram for an agent self-improvement system.',
      'Title: Post-run Reflection and Extraction.',
      'White background, engineering style, readable English labels.',
      'Left inputs: Completed Run, User Messages, Assistant Messages, Tool Executions, Attachments.',
      'Pipeline: Deterministic Extractor, Optional LLM Reviewer, Safety Filter, Deduplicator.',
      'Outputs split into three lanes: SessionMemoryState update, High-confidence Memory Records, Pending Evolution Proposals.',
      'Add warning boundary: no API keys, no private chat leakage, low confidence becomes proposal.',
      'Show that this pipeline runs after final reply and should not block user response.',
      'No decorative gradients, no logos, no watermark, avoid tiny text.',
    ].join(' '),
  },
  {
    id: 'skill',
    filename: 'kraken-skill-evolution-curator.png',
    prompt: [
      'Create a clean architecture diagram.',
      'Title: Skill Evolution and Curator.',
      'White background, readable English labels, crisp vector-like style.',
      'Show cycle: Skill Activation, Usage Telemetry, Success or Failure Attribution, Workflow Clustering, Skill Proposal Draft, Human Review, Skill Install or Patch.',
      'Include curator side lane: Daily Scheduler loads memories, proposals, skill usage, failures; then dedupe, stale detection, umbrella skill suggestion, report generation.',
      'Show governance boundary: curator can propose but cannot silently modify skills.',
      'Use concise text, restrained colors, no logos, no watermark, avoid tiny text.',
    ].join(' '),
  },
  {
    id: 'governance',
    filename: 'kraken-proposal-governance.png',
    prompt: [
      'Create a clean state machine and workflow diagram.',
      'Title: Proposal-only Governance.',
      'White background, readable English labels, technical document style.',
      'Main states: pending, accepted, rejected, applied.',
      'Flow: Agent or Curator creates proposal, Risk Classifier, Human Review, Accept or Reject, Apply Service, Validation, Audit Log.',
      'Show proposal types and risk levels in a compact side panel: memory_write low, memory_merge low, prompt_patch high, skill_patch high, tool_policy high, code_followup high.',
      'Emphasize: accepted does not mean applied; validation failure keeps proposal unapplied.',
      'No decorative gradients, no logos, no watermark, avoid tiny text.',
    ].join(' '),
  },
]

function parseArgs(argv) {
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

function getApiKey() {
  return firstNonEmpty(process.env.OPENROUTER_API_KEY, process.env.OPENROUTER_KEY)
}

function getProxy(args) {
  if (args.proxy !== undefined) {
    if (args.proxy === true) {
      fail('Missing value for --proxy.')
    }
    return String(args.proxy).trim()
  }
  return firstNonEmpty(
    process.env.OPENROUTER_PROXY,
    process.env.NANO_BANANA_PROXY,
    process.env.HTTPS_PROXY,
    process.env.HTTP_PROXY,
    'http://127.0.0.1:7897',
  )
}

function getResolution(args) {
  const value = typeof args.resolution === 'string' ? args.resolution.trim().toUpperCase() : '2K'
  if (value === '1K' || value === '2K' || value === '4K') {
    return value
  }
  fail('Invalid --resolution. Use 1K, 2K, or 4K.')
}

function getTargetDiagrams(args) {
  if (!args.only || args.only === true) {
    return DIAGRAMS
  }
  const wanted = new Set(String(args.only).split(',').map((item) => item.trim()).filter(Boolean))
  const selected = DIAGRAMS.filter((diagram) => wanted.has(diagram.id))
  if (selected.length !== wanted.size) {
    const valid = DIAGRAMS.map((diagram) => diagram.id).join(', ')
    fail(`Unknown --only value. Valid ids: ${valid}`)
  }
  return selected
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printUsage()
    return
  }

  const apiKey = getApiKey()
  if (!apiKey) {
    fail('No API key found. Set OPENROUTER_API_KEY or OPENROUTER_KEY in .env.')
  }

  const proxy = getProxy(args)
  const resolution = getResolution(args)
  const outputDir = path.resolve(typeof args['output-dir'] === 'string' ? args['output-dir'] : 'docs/images')
  const diagrams = getTargetDiagrams(args)

  await mkdir(outputDir, { recursive: true })

  const outputs = []
  for (const diagram of diagrams) {
    process.stdout.write(`Generating ${diagram.id} -> ${diagram.filename}\n`)
    const outputPath = path.join(outputDir, diagram.filename)
    await generateDiagram({
      prompt: diagram.prompt,
      outputPath,
      apiKey,
      proxy,
      resolution,
    })
    outputs.push(outputPath)
    process.stdout.write(`Saved ${outputPath}\n`)
  }

  process.stdout.write(JSON.stringify({ ok: true, outputs }, null, 2) + '\n')
}

async function generateDiagram({ prompt, outputPath, apiKey, proxy, resolution }) {
  const payload = {
    model: MODEL_NAME,
    max_tokens: 768,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    modalities: ['image', 'text'],
    image_config: {
      image_size: resolution,
    },
  }
  const response = await postOpenRouter({ payload, apiKey, proxy })
  const imageUrl = response?.choices?.[0]?.message?.images?.[0]?.image_url?.url
  if (!imageUrl || !imageUrl.includes(',')) {
    fail('OpenRouter response did not include an image.', response)
  }
  await writeFile(outputPath, decodeDataUrl(imageUrl))
}

async function postOpenRouter({ payload, apiKey, proxy }) {
  const payloadPath = path.join(tmpdir(), `kraken-diagram-${process.pid}-${Date.now()}.json`)
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
    proxy ? `proxy = "${proxy}"` : '',
    `header = "Authorization: Bearer ${apiKey}"`,
    'header = "Content-Type: application/json"',
    '',
  ].filter(Boolean).join('\n')

  try {
    const { stdout, stderr } = await runCurl(args, config)
    const data = safeJsonParse(stdout)
    if (!data) {
      fail('OpenRouter returned non-JSON output.', stderr || stdout)
    }
    return data
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  } finally {
    await unlink(payloadPath).catch(() => {})
  }
}

function runCurl(args, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', args, { stdio: ['pipe', 'pipe', 'pipe'] })
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
      const message = [stderr, stdout].filter(Boolean).join('\n')
      reject(new Error(message || `curl exited with status ${code}`))
    })
    child.stdin.end(stdin)
  })
}

function decodeDataUrl(dataUrl) {
  const parts = String(dataUrl).split(',', 2)
  if (parts.length !== 2) {
    fail('Invalid image data URL returned by OpenRouter.')
  }
  return Buffer.from(parts[1], 'base64')
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

function fail(message, details) {
  const payload = { ok: false, error: message }
  if (details !== undefined) {
    payload.details = details
  }
  process.stderr.write(JSON.stringify(payload, null, 2) + '\n')
  process.exit(1)
}

function printUsage() {
  process.stdout.write(`Usage:
  node skills/nano-banana-pro/scripts/generate_self_improving_diagrams.js [--only overview,runtime] [--resolution 1K|2K|4K] [--output-dir docs/images] [--proxy http://127.0.0.1:7897]

Environment:
  OPENROUTER_API_KEY or OPENROUTER_KEY
  OPENROUTER_PROXY, NANO_BANANA_PROXY, HTTPS_PROXY, or HTTP_PROXY
`)
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
