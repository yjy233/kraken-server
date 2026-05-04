---
name: feishu-docx-powerwrite
description: 用 JS 脚本把 Markdown 写入飞书新版文档，自动从 dotenv 读取 FEISHU_APP_ID/FEISHU_APP_SECRET，支持新建文档和向现有文档追加内容。
---

# Feishu Docx PowerWrite

This skill focuses on **reliably writing Feishu Docx with bundled Node.js scripts**.

Key idea: prefer the bundled JS scripts over ad hoc API code or manual copy-paste.
The scripts now do chunked writing with fallback handling for markdown tables and problematic ASCII diagrams, so they are safer than a single `convert` call.

## Quick workflow

1) Get `document_id` (Docx token)
- From a Docx URL: `https://.../docx/<document_id>`

2) Decide write mode
- **Append**: add new content below existing content (most common)
- **Replace**: overwrite the entire document (use carefully)

3) Write markdown
- Use headings + lists + short paragraphs
- Avoid huge single paragraphs (harder to read)

## Built-in scripts

### Create a new doc from Markdown

```bash
node scripts/create_doc_from_markdown.js --title "Hermes Agent 自进化" --path ./docs/hermes-agent/self-evolution-doc.md
```

Optional:

```bash
node scripts/create_doc_from_markdown.js --title "Hermes Agent 自进化" --path ./docs/hermes-agent/self-evolution-doc.md --folder-token fldcnxxxx
```

### Append Markdown into an existing doc

```bash
node scripts/write_markdown_to_doc.js --document-id doccnxxxx --path ./docs/hermes-agent/self-evolution-doc.md
```

These scripts automatically load:

- repository root `.env`
- repository root `.env.local`

Required env:

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`

## Reliability behavior

- Large markdown is split into smaller chunks before convert/write.
- Markdown tables are downgraded into bullet-style text before sending to Feishu convert.
- Box-drawing / ASCII flowchart content is downgraded into plain text bullet lines if needed.
- If one chunk still fails, the script retries with smaller chunks instead of aborting the whole document.
- Final JSON output includes `failedChunks` so remaining incompatible content can be diagnosed precisely.

## Recommended defaults

### Append mode (safe)
Use when adding sections, meeting notes, daily logs.

- `mode: append`
- Keep each append chunk <= ~300-600 lines if possible

### Replace mode (destructive)
Use when generating the full doc from scratch.

- `mode: replace`
- MUST set `confirm: true`

## Markdown patterns that render well

### Title + summary
```md
# <Title>

**Summary**
- Point 1
- Point 2

---
```

### Sections
```md
## Section

Short paragraph.

- Bullet
- Bullet

### Subsection

1) Step
2) Step
```

### Code
Use fenced blocks.

```md
```bash
openclaw skills check
```
```

## Templates & references

- Templates: `references/templates.md`
- Troubleshooting: `references/troubleshooting.md`

## Safety / privacy

- Never hardcode tokens, chat_id, open_id, or document links inside this skill.
- Always use the user’s own Feishu app credentials and scopes.
- If writing fails because of permission or credential problems, report the exact API failure clearly instead of silently falling back to “manual copy”.
