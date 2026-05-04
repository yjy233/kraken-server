#!/usr/bin/env node

import {
  appendMarkdownRobustly,
  buildWriteSummary,
  createDocument,
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
  node scripts/create_doc_from_markdown.js --title "Hermes Agent 自进化" --path ./doc.md [--folder-token fld_xxx]
  node scripts/create_doc_from_markdown.js --title "Hermes Agent 自进化" --markdown "# Title"

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

  const title = requireArg(args, 'title')
  const markdown = await readMarkdownInput(args)
  const client = createFeishuClient(args)

  const created = await createDocument(client, {
    title,
    folderToken: typeof args['folder-token'] === 'string' ? args['folder-token'].trim() : '',
  })
  const root = await getDocumentRootBlockId(client, created.documentId)
  const result = await appendMarkdownRobustly(client, {
    documentId: created.documentId,
    rootBlockId: root.rootBlockId,
    markdown,
  })

  printJson({
    ok: true,
    mode: 'create_doc_from_markdown',
    documentId: created.documentId,
    title,
    rootBlockId: root.rootBlockId,
    attemptedChunkCount: result.attemptedChunks,
    writtenChunkCount: result.writtenChunks,
    writtenBlockCount: result.writtenBlocks,
    failedChunkCount: result.failedChunks.length,
    failedChunks: result.failedChunks,
    transformations: result.transformations,
    summary: buildWriteSummary({
      mode: 'create_doc_from_markdown',
      documentId: created.documentId,
      title,
      result,
    }),
    docUrl: `https://feishu.cn/docx/${created.documentId}`,
  })
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
