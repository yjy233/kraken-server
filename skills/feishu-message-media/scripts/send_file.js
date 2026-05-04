#!/usr/bin/env node

import {
  fail,
  getTenantAccessToken,
  parseArgs,
  printJson,
  requireArg,
  sendMessage,
  uploadFile,
} from './_common.js'

function printUsage() {
  process.stdout.write(`Usage:
  node scripts/send_file.js --receive-id oc_xxx --path ./report.pdf [--receive-id-type chat_id] [--file-type pdf] [--file-name report.pdf] [--duration-ms 3000] [--uuid uuid]

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

  const receiveId = requireArg(args, 'receive-id')
  const filePath = requireArg(args, 'path')
  const receiveIdType = typeof args['receive-id-type'] === 'string' ? args['receive-id-type'] : 'chat_id'

  const token = await getTenantAccessToken(args)
  const upload = await uploadFile({
    token,
    filePath,
    fileType: typeof args['file-type'] === 'string' ? args['file-type'] : undefined,
    fileName: typeof args['file-name'] === 'string' ? args['file-name'] : undefined,
    durationMs: typeof args['duration-ms'] === 'string' ? args['duration-ms'] : undefined,
  })

  const send = await sendMessage({
    token,
    receiveIdType,
    receiveId,
    msgType: 'file',
    content: {
      file_key: upload.fileKey,
    },
    uuid: typeof args.uuid === 'string' ? args.uuid : undefined,
  })

  printJson({
    ok: true,
    mode: 'send_file',
    receiveIdType,
    receiveId,
    fileKey: upload.fileKey,
    uploadFileType: upload.fileType,
    messageId: send.data?.message_id || '',
    response: send.data || send,
  })
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
