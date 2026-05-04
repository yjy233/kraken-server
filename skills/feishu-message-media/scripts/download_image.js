#!/usr/bin/env node

import {
  downloadImageByKey,
  downloadMessageResource,
  fail,
  getTenantAccessToken,
  parseArgs,
  printJson,
} from './_common.js'

function printUsage() {
  process.stdout.write(`Usage:
  node scripts/download_image.js --image-key img_xxx [--output ./image.png] [--output-dir ./downloads]
  node scripts/download_image.js --message-id om_xxx --file-key file_xxx [--output ./image.png] [--output-dir ./downloads]

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

  const token = await getTenantAccessToken(args)
  const outputPath = typeof args.output === 'string' ? args.output : undefined
  const outputDir = typeof args['output-dir'] === 'string' ? args['output-dir'] : undefined

  if (typeof args['image-key'] === 'string' && args['image-key'].trim()) {
    const imageKey = args['image-key'].trim()
    const result = await downloadImageByKey({
      token,
      imageKey,
      outputPath,
      outputDir,
    })
    printJson({
      ok: true,
      mode: 'download_image_by_key',
      imageKey,
      savedTo: result.path,
      contentType: result.contentType,
      size: result.size,
    })
    return
  }

  if (typeof args['message-id'] === 'string' && args['message-id'].trim() &&
      typeof args['file-key'] === 'string' && args['file-key'].trim()) {
    const messageId = args['message-id'].trim()
    const fileKey = args['file-key'].trim()
    const result = await downloadMessageResource({
      token,
      messageId,
      fileKey,
      type: 'image',
      outputPath,
      outputDir,
    })
    printJson({
      ok: true,
      mode: 'download_image_from_message',
      messageId,
      fileKey,
      savedTo: result.path,
      contentType: result.contentType,
      size: result.size,
    })
    return
  }

  fail('Provide either --image-key, or both --message-id and --file-key.')
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
