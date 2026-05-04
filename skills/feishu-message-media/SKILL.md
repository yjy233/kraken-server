---
name: feishu-message-media
description: 飞书消息媒体工作流，用于发送文件、发送图片、下载消息中的文件或图片，以及将飞书媒体保存到本地工作区。
---

# Feishu Message Media

Use this skill for Feishu message media operations, especially when the task is about:

- sending a file into a Feishu chat
- sending an image into a Feishu chat
- uploading media first, then sending by `file_key` or `image_key`
- downloading a file or image from a Feishu message
- saving downloaded Feishu media into the local workspace

## Required workflow

1. Confirm whether the target is the current Feishu conversation or a different user/chat.
2. If sending an image:
   - prefer `scripts/send_img.js`
   - upload via the image API
   - send with `msg_type=image`
3. If sending a file, audio, or video:
   - prefer `scripts/send_file.js`
   - upload via the file API
   - send with the correct `msg_type`
4. If downloading user-visible media from a message:
   - prefer `scripts/download_file.js` or `scripts/download_image.js`
   - use `message_id + file_key + type`
   - save the binary to the workspace with a clear filename

## Built-in scripts

- `node scripts/send_file.js --receive-id oc_xxx --path ./report.pdf`
- `node scripts/send_img.js --receive-id oc_xxx --path ./image.png`
- `node scripts/download_file.js --message-id om_xxx --file-key file_xxx --output-dir ./downloads`
- `node scripts/download_image.js --message-id om_xxx --file-key file_xxx --output-dir ./downloads`
- `node scripts/download_image.js --image-key img_xxx --output ./saved-image.png`

By default, these scripts read credentials from:

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`

These scripts automatically load the repository root `.env` and `.env.local` through `dotenv`.

They also accept a direct token through:

- `FEISHU_TENANT_ACCESS_TOKEN`

## Important rules

- For Feishu message delivery, do not stop at explaining the API if the task is to actually send or save media.
- Use the current Feishu `chat_id`, `thread_id`, and `message_id` as the default target when the user is talking in the current Feishu conversation and does not specify another target.
- For images, prefer the image upload API. Only fall back to file upload when the image exceeds image upload limits or the user explicitly wants it sent as a file.
- For files, the file upload `file_type` must match the intended message type expectations from Feishu.
- A `file_key` from Drive media upload is not interchangeable with IM file upload for message sending.
- Save downloaded binaries inside the current workspace unless the user asks for another path.

## When to read references

- Read [references/api-workflows.md](references/api-workflows.md) before building or reviewing Feishu file/image send or download flows.
- Read it again when you need the exact payload shape for `msg_type=image` or `msg_type=file`, or when you need the limits, scopes, or message resource download behavior.
- Prefer running the bundled scripts directly instead of rewriting the same upload/send/download logic inline.
