# Feishu Delivery

Use `scripts/send_text.js` to send the final digest into a Feishu chat.

Preferred usage:

```bash
node skills/news-digest-feishu/scripts/send_text.js \
  --receive-id oc_xxx \
  --title "今日新闻摘要" \
  --text-file /absolute/path/to/digest.md
```

Alternative usage:

```bash
node skills/news-digest-feishu/scripts/send_text.js \
  --receive-id oc_xxx \
  --title "今日新闻摘要" \
  --text "# 今日新闻摘要\n..."
```

Defaults:

- `receive-id-type` defaults to `chat_id`
- credentials come from `FEISHU_APP_ID` and `FEISHU_APP_SECRET`
- direct token also works through `FEISHU_TENANT_ACCESS_TOKEN`

Delivery guidance:

- For daily digest, prefer sending to a fixed group chat.
- Keep the message within practical Feishu length limits.
- If the digest is very long, trim it before sending rather than flooding the chat.
- Feishu interactive card markdown is not full CommonMark. Before sending, headings such as `#` and `##` should be downgraded to bold text blocks for stable rendering.
