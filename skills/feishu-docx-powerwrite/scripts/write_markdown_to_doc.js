#!/usr/bin/env node

import {
  appendMarkdownRobustly,
  buildWriteSummary,
  createFeishuClient,
  fail,
  getDocumentRootBlockId,
  parseArgs,
  printJson,
  readMarkdownInput,
  requireArg,
} from './_common.js'

function printUsage() {
  process.stdout.write(`Usage:
  node scripts/write_markdown_to_doc.js --document-id doccnxxxx --path ./doc.md
  node scripts/write_markdown_to_doc.js --document-id doccnxxxx --markdown "# Title"

Env:
  FEISHU_APP_ID / FEISHU_APP_SECRET
`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printUsage()
    return
  }

  const documentId = requireArg(args, 'document-id')
  const markdown = await readMarkdownInput(args)
  const client = createFeishuClient(args)

  const root = await getDocumentRootBlockId(client, documentId)
  const result = await appendMarkdownRobustly(client, {
    documentId,
    rootBlockId: root.rootBlockId,
    markdown,
  })

  printJson({
    ok: true,
    mode: 'write_markdown_to_doc',
    documentId,
    rootBlockId: root.rootBlockId,
    attemptedChunkCount: result.attemptedChunks,
    writtenChunkCount: result.writtenChunks,
    writtenBlockCount: result.writtenBlocks,
    failedChunkCount: result.failedChunks.length,
    failedChunks: result.failedChunks,
    transformations: result.transformations,
    summary: buildWriteSummary({
      mode: 'write_markdown_to_doc',
      documentId,
      result,
    }),
    docUrl: `https://feishu.cn/docx/${documentId}`,
  })
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
