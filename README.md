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

## License

MIT
