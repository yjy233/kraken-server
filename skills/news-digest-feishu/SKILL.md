---
name: news-digest-feishu
description: 每日新闻摘要到飞书的工作流 skill。用于按配置门户抓取最近新闻，去重筛选，生成不超过 20 条的中文摘要，并推送到指定飞书 chat。
---

# News Digest Feishu

Use this skill when the task is to collect recent news from configured portals, produce a concise Chinese digest, and deliver it to a Feishu chat.

## Required workflow

1. Read `references/sources.json` first to determine which portals are enabled.
2. Prefer the configured feed or listing URL for each enabled source.
3. Use `search` for discovery and `web_fetch` for static article text.
4. Only use `agent_browser` when the page requires rendering or client-side interaction.
5. Limit the reporting window to the current scheduled window or the explicit user request.
6. Deduplicate overlapping stories before summarizing.
7. Keep the final digest to at most 20 items.
8. Include source name and source URL for every item.
9. Deliver the final digest to Feishu using `scripts/send_text.js`.

## References

- Read `references/sources.json` for the source registry.
- Read `references/output-format.md` before writing the final digest.
- Read `references/feishu-delivery.md` before sending to Feishu.

## Output rules

- Write in Chinese.
- Keep the top summary short and scannable.
- Do not invent facts outside the collected source material.
- If there are fewer than 20 meaningful items, output fewer than 20.
- If a source repeatedly covers the same event, merge it into one digest item.

## Delivery rules

- The scheduled job may provide params such as `targetChatId`, `maxItems`, `sourceSet`, and `timezone`.
- Treat those params as authoritative runtime inputs.
- When `targetChatId` is present, send to that Feishu chat.
- Save the final digest text to a workspace file before sending when practical, so the run is auditable.
