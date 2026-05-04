#!/usr/bin/env node

import {
  fail,
  getTenantAccessToken,
  parseArgs,
  printJson,
  requireArg,
  sendMessage,
  uploadImage,
} from './_common.js'

function printUsage() {
  process.stdout.write(`Usage:
  node scripts/send_img.js --receive-id oc_xxx --path ./image.png [--receive-id-type chat_id] [--uuid uuid]

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
  const upload = await uploadImage({
    token,
    filePath,
    imageType: 'message',
  })

  const send = await sendMessage({
    token,
    receiveIdType,
    receiveId,
    msgType: 'image',
    content: {
      image_key: upload.imageKey,
    },
    uuid: typeof args.uuid === 'string' ? args.uuid : undefined,
  })

  printJson({
    ok: true,
    mode: 'send_image',
    receiveIdType,
    receiveId,
    imageKey: upload.imageKey,
    messageId: send.data?.message_id || '',
    response: send.data || send,
  })
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
