# Feishu Message Media API Workflows

This reference is for reliable Feishu/Lark message media handling based on the official Feishu IM APIs.

## Scope

This reference covers:

- upload file for IM messaging
- upload image for IM messaging
- send image/file messages
- download a resource from a message
- download a previously uploaded image by `image_key`

## Core send patterns

### Send image to Feishu chat

1. Upload image to IM image API
2. Get `image_key`
3. Send message with `msg_type=image`

Request shape:

- upload image endpoint: `POST /open-apis/im/v1/images`
- form field `image_type=message`
- result field: `data.image_key`

Send message payload:

```json
{
  "receive_id": "oc_xxx",
  "msg_type": "image",
  "content": "{\"image_key\":\"img_v2_xxx\"}"
}
```

Notes:

- Image upload is limited to 10 MB.
- Supported formats include JPG, JPEG, PNG, WEBP, GIF, BMP, ICO, TIFF, HEIC.
- GIF max resolution is 2000x2000. Other images max 12000x12000.
- If the image is too large or too high-resolution for image upload, upload it as a file instead.

### Send file to Feishu chat

1. Upload file to IM file API
2. Get `file_key`
3. Send message with `msg_type=file`

Request shape:

- upload file endpoint: `POST /open-apis/im/v1/files`
- required form fields:
  - `file_type`
  - `file_name`
  - `file`
- optional:
  - `duration` for audio/video

Send message payload:

```json
{
  "receive_id": "oc_xxx",
  "msg_type": "file",
  "content": "{\"file_key\":\"file_xxx\"}"
}
```

Notes:

- File upload is limited to 30 MB.
- If uploading an image as a generic file, use file upload and send as `msg_type=file`.
- If uploading media for video/audio-style message types, make sure the upload type and send type are compatible. Feishu returns `230055` when they do not match.
- The message API explicitly says audio/video/file need IM file upload first; do not use a Drive media token in place of IM `file_key`.

## Download patterns

### Download a resource from a message

Use this when the resource came from a user message or a historical message, and you have the message context.

Endpoint:

- `GET /open-apis/im/v1/messages/:message_id/resources/:file_key?type=image|file`

Use:

- `type=image` for message images or rich-text embedded images
- `type=file` for files, audio, video

Important constraints:

- Bot and target message must be in the same chat.
- Download size limit is 100 MB.
- Not supported for stickers.
- Not supported for merged-forward child messages or card message resources.
- `message_id` and `file_key` must match the same message resource.

Recommended local workflow:

1. Determine target save path inside workspace
2. Download binary stream
3. Infer extension from `Content-Type` when possible
4. Save with a deterministic filename
5. Report saved path back to the user

### Download by `image_key`

Use this only for images uploaded by the current bot via the image upload API.

Endpoint:

- `GET /open-apis/im/v1/images/:image_key`

Important constraints:

- Only downloadable if uploaded by the current bot
- Only supports images uploaded for message use
- Avatar uploads are not downloadable from this API
- If the user wants a message resource download, prefer the message resource API instead

## Required permissions and capability notes

### Upload file / upload image

Either of:

- `im:resource`
- `im:resource:upload`

Bot capability must be enabled.

### Send message

One of:

- `im:message`
- `im:message:send_as_bot`
- `im:message:send`

Bot capability must be enabled.

### Download resource from message

One of:

- `im:message`
- `im:message:readonly`
- `im:message.history:readonly`

Bot capability must be enabled.

## Common pitfalls

- Do not confuse `image_key` with `file_key`.
- Do not send `msg_type=file` with an `image_key`.
- Do not send `msg_type=image` with a `file_key`.
- Do not assume Drive upload tokens can be used as IM `file_key`.
- Do not ignore message target defaults when the request came from the current Feishu chat.
- Do not leave file/image delivery as a theoretical answer when the user clearly asked to actually send or save the media.

## Official source summary

These workflows were derived from official Feishu docs for:

- IM file upload
- IM image upload
- IM message create
- IM message resource download
- IM image download by `image_key`
