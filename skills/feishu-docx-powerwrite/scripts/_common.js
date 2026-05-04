#!/usr/bin/env node

import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { config as loadDotEnv } from 'dotenv'
import * as lark from '@larksuiteoapi/node-sdk'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..')
const HEADING_RE = /^#{1,6}\s+/
const TABLE_DIVIDER_RE = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+(?:\s*:?-{3,}:?\s*)\|?\s*$/
const BOX_DRAWING_RE = /[┌┐└┘├┤┬┴┼│─━╭╮╯╰▼▲▶◀]/u

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

export async function readMarkdownInput(args) {
  if (typeof args.markdown === 'string' && args.markdown.trim()) {
    return args.markdown
  }
  if (typeof args.path === 'string' && args.path.trim()) {
    return readFile(path.resolve(args.path.trim()), 'utf8')
  }
  fail('Provide either --markdown or --path')
}

export function createFeishuClient(args) {
  const appId = firstNonEmpty(args['app-id'], process.env.FEISHU_APP_ID)
  const appSecret = firstNonEmpty(args['app-secret'], process.env.FEISHU_APP_SECRET)

  if (!appId || !appSecret) {
    fail('Missing Feishu credentials. Provide --app-id/--app-secret or FEISHU_APP_ID/FEISHU_APP_SECRET.')
  }

  return new lark.Client({
    appId,
    appSecret,
  })
}

export async function createDocument(client, { title, folderToken }) {
  const response = await client.docx.v1.document.create({
    data: {
      ...(folderToken ? { folder_token: folderToken } : {}),
      ...(title ? { title } : {}),
    },
  })

  const documentId = response?.data?.document?.document_id
  if (!documentId) {
    throw withDetails('Failed to create Feishu docx document.', response)
  }
  return {
    documentId,
    response,
  }
}

export async function convertMarkdown(client, markdown) {
  const response = await client.docx.v1.document.convert({
    data: {
      content_type: 'markdown',
      content: markdown,
    },
  })

  const blocks = Array.isArray(response?.data?.blocks) ? response.data.blocks : []
  const firstLevelBlockIds = Array.isArray(response?.data?.first_level_block_ids)
    ? response.data.first_level_block_ids.filter((item) => typeof item === 'string' && item.trim())
    : []

  if (blocks.length === 0 || firstLevelBlockIds.length === 0) {
    throw withDetails('Markdown conversion returned no blocks.', response)
  }

  return {
    blocks,
    firstLevelBlockIds,
    response,
  }
}

export async function getDocumentRootBlockId(client, documentId) {
  const response = await client.docx.v1.documentBlock.list({
    path: {
      document_id: documentId,
    },
    params: {
      page_size: 10,
    },
  })

  const items = Array.isArray(response?.data?.items) ? response.data.items : []
  const root = items.find((item) => !item?.parent_id && item?.block_id)
  const rootBlockId = typeof root?.block_id === 'string' ? root.block_id.trim() : ''
  if (!rootBlockId) {
    throw withDetails('Failed to resolve document root block.', response)
  }
  return {
    rootBlockId,
    response,
  }
}

export async function appendConvertedBlocks(client, { documentId, rootBlockId, blocks, firstLevelBlockIds }) {
  const response = await client.docx.v1.documentBlockDescendant.create({
    data: {
      children_id: firstLevelBlockIds,
      descendants: blocks,
    },
    path: {
      document_id: documentId,
      block_id: rootBlockId,
    },
  })

  return response
}

export async function appendMarkdownRobustly(client, {
  documentId,
  rootBlockId,
  markdown,
  maxChunkChars = 2200,
  minChunkChars = 450,
}) {
  const normalized = normalizeMarkdown(markdown)
  const chunks = buildMarkdownChunks(normalized, { maxChunkChars })
  const summary = {
    normalized,
    totalChunks: chunks.length,
    attemptedChunks: 0,
    writtenChunks: 0,
    writtenBlocks: 0,
    failedChunks: [],
    transformations: summarizeTransformations(normalized),
  }

  for (const chunk of chunks) {
    summary.attemptedChunks += 1
    const result = await appendMarkdownChunkWithFallback(client, {
      documentId,
      rootBlockId,
      markdown: chunk,
      maxChunkChars,
      minChunkChars,
      depth: 0,
    })

    summary.writtenChunks += result.writtenChunks
    summary.writtenBlocks += result.writtenBlocks
    summary.failedChunks.push(...result.failedChunks)
  }

  return summary
}

export function buildWriteSummary({
  mode,
  documentId,
  title,
  result,
}) {
  const base = [
    `${mode} completed`,
    `document_id=${documentId}`,
    `attempted_chunks=${result.attemptedChunks}`,
    `written_chunks=${result.writtenChunks}`,
    `written_blocks=${result.writtenBlocks}`,
  ]

  if (title) {
    base.splice(1, 0, `title=${title}`)
  }

  if (result.failedChunks.length === 0) {
    base.push('failed_chunks=0')
    return base.join(' | ')
  }

  const failedPreviews = result.failedChunks
    .slice(0, 3)
    .map((item, index) => `#${index + 1} ${item.reason}; preview=${JSON.stringify(item.preview)}`)

  base.push(`failed_chunks=${result.failedChunks.length}`)
  base.push(`failures=${failedPreviews.join(' || ')}`)
  return base.join(' | ')
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

async function appendMarkdownChunkWithFallback(client, {
  documentId,
  rootBlockId,
  markdown,
  maxChunkChars,
  minChunkChars,
  depth,
}) {
  try {
    const converted = await convertMarkdown(client, markdown)
    await appendConvertedBlocks(client, {
      documentId,
      rootBlockId,
      blocks: converted.blocks,
      firstLevelBlockIds: converted.firstLevelBlockIds,
    })

    return {
      writtenChunks: 1,
      writtenBlocks: converted.blocks.length,
      failedChunks: [],
    }
  } catch (error) {
    if (depth >= 4) {
      return {
        writtenChunks: 0,
        writtenBlocks: 0,
        failedChunks: [buildFailureRecord(markdown, error)],
      }
    }

    const degraded = degradeProblematicChunk(markdown)
    if (degraded !== markdown) {
      return appendMarkdownChunkWithFallback(client, {
        documentId,
        rootBlockId,
        markdown: degraded,
        maxChunkChars,
        minChunkChars,
        depth: depth + 1,
      })
    }

    const nextMaxChunkChars = Math.max(minChunkChars, Math.floor(maxChunkChars / 2))
    const smallerChunks = buildMarkdownChunks(markdown, { maxChunkChars: nextMaxChunkChars })
    if (smallerChunks.length > 1) {
      const aggregate = {
        writtenChunks: 0,
        writtenBlocks: 0,
        failedChunks: [],
      }

      for (const chunk of smallerChunks) {
        const result = await appendMarkdownChunkWithFallback(client, {
          documentId,
          rootBlockId,
          markdown: chunk,
          maxChunkChars: nextMaxChunkChars,
          minChunkChars,
          depth: depth + 1,
        })
        aggregate.writtenChunks += result.writtenChunks
        aggregate.writtenBlocks += result.writtenBlocks
        aggregate.failedChunks.push(...result.failedChunks)
      }

      return aggregate
    }

    return {
      writtenChunks: 0,
      writtenBlocks: 0,
      failedChunks: [buildFailureRecord(markdown, error)],
    }
  }
}

function buildMarkdownChunks(markdown, { maxChunkChars }) {
  const blocks = splitMarkdownIntoBlocks(sanitizeMarkdownForFeishu(markdown))
  const chunks = []
  let current = ''

  for (const block of blocks) {
    if (block.length > maxChunkChars) {
      if (current) {
        chunks.push(current)
        current = ''
      }
      chunks.push(...splitOversizedBlock(block, maxChunkChars))
      continue
    }

    if (!current) {
      current = block
      continue
    }

    const candidate = `${current}\n\n${block}`
    const shouldSplitOnHeading = HEADING_RE.test(block) && current.length > Math.floor(maxChunkChars * 0.55)
    if (candidate.length > maxChunkChars || shouldSplitOnHeading) {
      chunks.push(current)
      current = block
      continue
    }

    current = candidate
  }

  if (current) {
    chunks.push(current)
  }

  return chunks.filter(Boolean)
}

function splitMarkdownIntoBlocks(markdown) {
  const lines = normalizeMarkdown(markdown).split('\n')
  const blocks = []
  let current = []
  let inFence = false
  let fenceMarker = ''

  const pushCurrent = () => {
    const block = current.join('\n').trim()
    if (block) {
      blocks.push(block)
    }
    current = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()

    if (inFence) {
      current.push(line)
      if (trimmed.startsWith(fenceMarker)) {
        inFence = false
        fenceMarker = ''
      }
      continue
    }

    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      if (current.length > 0) {
        pushCurrent()
      }
      inFence = true
      fenceMarker = trimmed.startsWith('~~~') ? '~~~' : '```'
      current.push(line)
      continue
    }

    if (isMarkdownTableStart(lines, index)) {
      if (current.length > 0) {
        pushCurrent()
      }
      const tableLines = [line, lines[index + 1]]
      index += 2
      while (index < lines.length && isMarkdownTableRow(lines[index])) {
        tableLines.push(lines[index])
        index += 1
      }
      index -= 1
      blocks.push(convertTableBlockToMarkdown(tableLines))
      continue
    }

    if (!trimmed) {
      if (current.length > 0) {
        pushCurrent()
      }
      continue
    }

    if (HEADING_RE.test(trimmed) && current.length > 0) {
      pushCurrent()
    }

    current.push(line)
  }

  if (current.length > 0) {
    pushCurrent()
  }

  return blocks
}

function splitOversizedBlock(block, maxChunkChars) {
  const lines = block.split('\n')
  const chunks = []
  let current = ''

  const flush = () => {
    const trimmed = current.trim()
    if (trimmed) {
      chunks.push(trimmed)
    }
    current = ''
  }

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line
    if (candidate.length > maxChunkChars && current) {
      flush()
    }

    if (line.length > maxChunkChars) {
      const fragmented = fragmentLongLine(line, maxChunkChars)
      for (const piece of fragmented) {
        const nestedCandidate = current ? `${current}\n${piece}` : piece
        if (nestedCandidate.length > maxChunkChars && current) {
          flush()
        }
        current = current ? `${current}\n${piece}` : piece
        if (current.length >= maxChunkChars) {
          flush()
        }
      }
      continue
    }

    current = current ? `${current}\n${line}` : line
  }

  flush()
  return chunks
}

function fragmentLongLine(line, maxChunkChars) {
  const fragments = []
  let remaining = line

  while (remaining.length > maxChunkChars) {
    let splitAt = remaining.lastIndexOf(' ', maxChunkChars)
    if (splitAt <= 0) {
      splitAt = maxChunkChars
    }
    fragments.push(remaining.slice(0, splitAt).trimEnd())
    remaining = remaining.slice(splitAt).trimStart()
  }

  if (remaining) {
    fragments.push(remaining)
  }
  return fragments
}

function sanitizeMarkdownForFeishu(markdown) {
  return normalizeMarkdown(markdown)
}

function normalizeMarkdown(markdown) {
  return String(markdown)
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isMarkdownTableStart(lines, index) {
  return isMarkdownTableRow(lines[index]) && isMarkdownTableDivider(lines[index + 1])
}

function isMarkdownTableRow(line) {
  const value = typeof line === 'string' ? line.trim() : ''
  return value.startsWith('|') && value.endsWith('|') && value.includes('|')
}

function isMarkdownTableDivider(line) {
  const value = typeof line === 'string' ? line.trim() : ''
  return TABLE_DIVIDER_RE.test(value)
}

function convertTableBlockToMarkdown(lines) {
  const headerCells = parseTableCells(lines[0])
  const rowLines = lines.slice(2)
  const rows = rowLines.map(parseTableCells)
  const parts = ['**表格内容：**']

  if (rows.length === 0) {
    parts.push(`- ${headerCells.filter(Boolean).join('；')}`)
    return parts.join('\n')
  }

  rows.forEach((row, rowIndex) => {
    const columns = headerCells.map((header, columnIndex) => {
      const label = header || `列${columnIndex + 1}`
      const value = row[columnIndex] || ''
      return `${label}: ${value || '-'}`.trim()
    })
    parts.push(`- 第 ${rowIndex + 1} 行：${columns.join('；')}`)
  })

  return parts.join('\n')
}

function parseTableCells(line) {
  return String(line)
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function degradeProblematicChunk(markdown) {
  if (!BOX_DRAWING_RE.test(markdown)) {
    return markdown
  }

  const lines = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    return markdown
  }

  const result = ['**原始流程/图示（按纯文本保留）：**']
  for (const line of lines) {
    result.push(`- ${line}`)
  }
  return result.join('\n')
}

function summarizeTransformations(markdown) {
  return {
    tableCount: countMarkdownTables(markdown),
    containsBoxDrawing: BOX_DRAWING_RE.test(markdown),
  }
}

function countMarkdownTables(markdown) {
  const lines = normalizeMarkdown(markdown).split('\n')
  let count = 0
  for (let index = 0; index < lines.length; index += 1) {
    if (isMarkdownTableStart(lines, index)) {
      count += 1
      index += 1
    }
  }
  return count
}

function buildFailureRecord(markdown, error) {
  return {
    preview: markdown.slice(0, 160),
    reason: describeError(error),
  }
}

function describeError(error) {
  const message = error instanceof Error ? error.message : String(error)
  const details = error && typeof error === 'object' ? error.response?.data || error.details : undefined
  const apiMessage = typeof details?.msg === 'string' ? details.msg : ''
  const apiCode = details?.code !== undefined ? String(details.code) : ''
  const logId = typeof details?.log_id === 'string' ? details.log_id : ''

  return [message, apiCode && `code=${apiCode}`, apiMessage, logId && `log_id=${logId}`]
    .filter(Boolean)
    .join(' | ')
}

function withDetails(message, details) {
  const error = new Error(message)
  error.details = details
  return error
}
