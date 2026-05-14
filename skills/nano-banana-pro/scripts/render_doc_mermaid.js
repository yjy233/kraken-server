#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { deflateSync } from 'node:zlib'

const DOC_PATH = 'docs/self-improving-hermes-inspired.md'
const OUTPUT_DIR = 'docs/images/mermaid'
const KROKI_BASE_URL = 'https://kroki.io/mermaid/png'

const REPLACEMENTS = [
  {
    index: 1,
    filename: 'self-improving-layer-overview.png',
    alt: 'Self-improving layer overview',
  },
  {
    index: 2,
    filename: 'self-improving-system-architecture.png',
    alt: 'Self-improving system architecture',
  },
  {
    index: 3,
    filename: 'channel-intake-layer.png',
    alt: 'Channel Intake layer',
  },
  {
    index: 4,
    filename: 'runtime-orchestration-sequence.png',
    alt: 'Runtime orchestration sequence',
  },
  {
    index: 5,
    filename: 'runtime-orchestration-steps.png',
    alt: 'Runtime orchestration steps',
  },
  {
    index: 6,
    filename: 'context-adaptation-layer.png',
    alt: 'Context Adaptation layer',
  },
  {
    index: 7,
    filename: 'session-memory-write-rules.png',
    alt: 'Session memory write rules',
  },
  {
    index: 8,
    filename: 'persistent-memory-layer.png',
    alt: 'Persistent Memory layer',
  },
  {
    index: 9,
    filename: 'memory-scope-resolution.png',
    alt: 'Memory scope resolution',
  },
  {
    index: 10,
    filename: 'memory-provider-interface.png',
    alt: 'Memory provider interface',
  },
  {
    index: 11,
    filename: 'reflection-extraction-layer.png',
    alt: 'Reflection and Extraction layer',
  },
  {
    index: 12,
    filename: 'reflection-dual-channel.png',
    alt: 'Reflection dual-channel design',
  },
  {
    index: 13,
    filename: 'skill-evolution-layer.png',
    alt: 'Skill Evolution layer',
  },
  {
    index: 14,
    filename: 'skill-evolution-stages.png',
    alt: 'Skill evolution stages',
  },
  {
    index: 15,
    filename: 'governance-layer.png',
    alt: 'Governance layer',
  },
  {
    index: 16,
    filename: 'governance-apply-sequence.png',
    alt: 'Governance apply sequence',
  },
  {
    index: 17,
    filename: 'conversation-adaptation-loop.png',
    alt: 'Conversation adaptation loop',
  },
  {
    index: 18,
    filename: 'cross-session-memory-loop.png',
    alt: 'Cross-session memory loop',
  },
  {
    index: 19,
    filename: 'skill-evolution-state-machine.png',
    alt: 'Skill evolution state machine',
  },
  {
    index: 20,
    filename: 'curator-maintenance-flow.png',
    alt: 'Curator maintenance flow',
  },
  {
    index: 21,
    filename: 'proposal-only-governance-flow.png',
    alt: 'Proposal-only governance flow',
  },
  {
    index: 22,
    filename: 'implementation-roadmap.png',
    alt: 'Implementation roadmap',
  },
  {
    index: 23,
    filename: 'minimum-viable-evolution-loop.png',
    alt: 'Minimum viable evolution loop',
  },
  {
    index: 24,
    filename: 'evolution-sidecar.png',
    alt: 'Evolution sidecar',
  },
  {
    index: 25,
    filename: 'current-mvp-flow.png',
    alt: 'Current MVP flow',
  },
]

function parseArgs(argv) {
  return {
    replace: argv.includes('--replace'),
    renderOnly: argv.includes('--render-only'),
    skipExisting: argv.includes('--skip-existing'),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  await mkdir(OUTPUT_DIR, { recursive: true })

  let markdown = await readFile(DOC_PATH, 'utf8')
  const blocks = collectMermaidBlocks(markdown)
  if (blocks.length !== REPLACEMENTS.length) {
    throw new Error(`Expected ${REPLACEMENTS.length} mermaid blocks, found ${blocks.length}.`)
  }

  for (const block of blocks) {
    const replacement = REPLACEMENTS[block.index - 1]
    const sourcePath = path.join(OUTPUT_DIR, replacement.filename.replace(/\.png$/, '.mmd'))
    const outputPath = path.join(OUTPUT_DIR, replacement.filename)
    await writeFile(sourcePath, block.code)
    if (args.skipExisting && await exists(outputPath)) {
      process.stdout.write(`Skipped ${replacement.filename}\n`)
      continue
    }
    await renderMermaid(sourcePath, outputPath)
    process.stdout.write(`Rendered ${replacement.filename}\n`)
  }

  if (args.replace && !args.renderOnly) {
    markdown = replaceMermaidBlocks(markdown, blocks)
    await writeFile(DOC_PATH, markdown)
    process.stdout.write(`Updated ${DOC_PATH}\n`)
  }
}

function collectMermaidBlocks(markdown) {
  const pattern = /```mermaid\n([\s\S]*?)\n```/g
  const blocks = []
  let match
  let index = 1
  while ((match = pattern.exec(markdown))) {
    blocks.push({
      index,
      fullText: match[0],
      code: match[1],
    })
    index += 1
  }
  return blocks
}

function replaceMermaidBlocks(markdown, blocks) {
  let next = markdown
  for (const block of blocks) {
    const replacement = REPLACEMENTS[block.index - 1]
    const imageMarkdown = `![${replacement.alt}](./images/mermaid/${replacement.filename})`
    next = next.replace(block.fullText, imageMarkdown)
  }
  return next
}

async function renderMermaid(sourcePath, outputPath) {
  const source = await readFile(sourcePath, 'utf8')
  const encoded = encodeKroki(source)
  const url = `${KROKI_BASE_URL}/${encoded}`
  const { stdout } = await run('curl', [
    '--silent',
    '--show-error',
    '--fail-with-body',
    '--max-time',
    '240',
    '--location',
    url,
  ], { encoding: 'buffer' })
  await writeFile(outputPath, stdout)
}

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function encodeKroki(text) {
  return deflateSync(Buffer.from(text)).toString('base64url')
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdoutChunks = []
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(Buffer.from(chunk))
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      const stdoutBuffer = Buffer.concat(stdoutChunks)
      const stdout = options.encoding === 'buffer' ? stdoutBuffer : stdoutBuffer.toString('utf8')
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new Error(stderr || stdoutBuffer.toString('utf8') || `${command} exited with status ${code}`))
    })
  })
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exit(1)
})
