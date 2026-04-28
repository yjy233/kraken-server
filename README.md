# Kraken Agent

<p align="center">
  <img src="assets/assets/logo.png" width="120" alt="Kraken Agent Logo">
</p>

Kraken Agent is a local AI assistant with tool-use capabilities. It connects to OpenRouter for LLM inference and provides a clean web UI for multi-turn conversations with ReAct-style agent loops.

## Features

- **ReAct Agent Loop** — Multi-step reasoning with tool calls
- **Streaming UI** — Real-time SSE response with tool execution traces
- **Session Management** — Persistent JSON-based conversation history
- **Tool System** — File operations, shell commands, web search, code editing, and more
- **Dynamic System Prompt** — Automatically generated based on enabled tools

## Tech Stack

- Backend: Express 5 + TypeScript + SSE
- Frontend: React 19 + esbuild
- LLM: OpenRouter (Claude, GPT, etc.)
- Runtime: Node.js + tsx

## Quick Start

```bash
# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env and set OPENROUTER_API_KEY

# Start dev server
bun run dev
```

Visit `http://localhost:3011`.

## Tool Configuration

Tools are controlled via environment variables in `.env`:

- `ENABLED_TOOLS` — Comma-separated whitelist (e.g. `list_directory,read_file,todo`)
- `ALLOW_SHELL_TOOL` — Enable shell command execution (`true`/`false`)
- `ALLOW_FILE_WRITE_TOOL` — Enable file modification (`true`/`false`)
- `ALLOW_AGENT_BROWSER` — Enable real browser automation through `agent-browser` (`true`/`false`)

## Agent Browser Setup

Kraken can use [`vercel-labs/agent-browser`](https://github.com/vercel-labs/agent-browser) for real browser automation: rendered pages, snapshots, refs, clicks, form input, navigation, tabs, and screenshots.

This integration uses the `agent-browser` CLI. Kraken does not install browser dependencies automatically.

Install it before enabling the tool:

```bash
# Install the CLI into the project or globally.
npm install agent-browser

# Install/check the browser runtime required by agent-browser.
npx agent-browser install
npx agent-browser doctor --json
```

Then enable it in `.env`:

```bash
ALLOW_AGENT_BROWSER=true

# Optional overrides
AGENT_BROWSER_BIN=agent-browser
AGENT_BROWSER_MAX_OUTPUT=50000
AGENT_BROWSER_DEFAULT_TIMEOUT=25000
AGENT_BROWSER_ALLOWED_DOMAINS=
```

If `AGENT_BROWSER_BIN` is not set, Kraken looks for `node_modules/.bin/agent-browser` first and then falls back to `agent-browser` on `PATH`.

Leave `AGENT_BROWSER_ALLOWED_DOMAINS` empty for unrestricted browsing. `AGENT_BROWSER_ALLOWED_DOMAINS=*` is also treated as unrestricted by Kraken and is not passed to `agent-browser`, because the upstream CLI treats `*` as a literal allowlist entry rather than “all domains”.

When enabled, the agent gets an `agent_browser` tool. Each Kraken session maps to a separate `agent-browser` session named `kraken-<sessionId>`, so browser pages, refs, cookies, and history do not bleed across chats.

If you use `ENABLED_TOOLS`, include `agent_browser` in that comma-separated list.

## License

MIT
