#!/usr/bin/env node

import {
  downloadMessageResource,
  fail,
  getTenantAccessToken,
  parseArgs,
  printJson,
  requireArg,
} from './_common.js'

function printUsage() {
  process.stdout.write(`Usage:
  node scripts/download_file.js --message-id om_xxx --file-key file_xxx [--output ./saved.bin] [--output-dir ./downloads]

Env:
  FEISHU_APP_ID / FEISHU_APP_SECRET
  or FEISHU_TENANT_ACCESS_TOKEN
`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printUsage()
    return
  }

  const messageId = requireArg(args, 'message-id')
  const fileKey = requireArg(args, 'file-key')
  const token = await getTenantAccessToken(args)

  const result = await downloadMessageResource({
    token,
    messageId,
    fileKey,
    type: 'file',
    outputPath: typeof args.output === 'string' ? args.output : undefined,
    outputDir: typeof args['output-dir'] === 'string' ? args['output-dir'] : undefined,
  })

  printJson({
    ok: true,
    mode: 'download_file',
    messageId,
    fileKey,
    savedTo: result.path,
    contentType: result.contentType,
    size: result.size,
  })
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
