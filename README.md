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
- **Feishu Robot Channel** — Long-connection Feishu app bot access that reuses the same agent runtime
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

## Feishu Robot

Kraken can connect to a Feishu self-built app bot through Feishu long connection mode. This lets users talk to the same agent runtime from Feishu private chats and group chats.

Current scope:

- Long connection / websocket mode only
- Text messages only
- Group chats require `@` mentioning the bot
- Feishu message meta such as `message_id`, `chat_id`, and `sender_id` is passed to the agent
- The Feishu channel prompt tells the agent to use `dingtakl-feishu-cn` when available

HTTP callback is not part of the current setup and is not documented here.

1. Create a Feishu self-built app and enable bot capability.
2. Subscribe to the `im.message.receive_v1` event.
3. Grant the app permissions for receiving bot messages, reading message content, sending messages, and replying to messages.
4. Fill in the Feishu env vars in `.env`.
5. Start Kraken. The Feishu channel will connect automatically during server startup.

Example `.env`:

```bash
FEISHU_ENABLED=true
FEISHU_EVENT_MODE=ws
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx

# Optional
FEISHU_SESSION_MODE=chat
FEISHU_REPLY_MODE=reply
FEISHU_CHANNEL_SKILL=dingtakl-feishu-cn
FEISHU_INCLUDE_MESSAGE_META=true

# Optional quasi-streaming reply updates
FEISHU_STREAMING_ENABLED=false
FEISHU_STREAMING_MODE=update
FEISHU_STREAMING_FLUSH_INTERVAL_MS=1500
FEISHU_STREAMING_MIN_DELTA_CHARS=80
FEISHU_STREAMING_MAX_UPDATES=20
```

Notes:

- `FEISHU_SESSION_MODE=chat` shares one Kraken session per group chat; `user` isolates by sender within a group.
- `FEISHU_REPLY_MODE=reply` replies to the source message; `send` sends a new message into the chat.
- `FEISHU_CHANNEL_SKILL` defaults to `dingtakl-feishu-cn`.
- Session mappings and dedupe state are persisted under `.feishu-sessions/`.

More design detail is in [docs/feishu-robot-integration.md](/Users/bill/code/kraken-server/docs/feishu-robot-integration.md).

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

### Browser Login State

By default, `agent-browser` starts an isolated browser session and will not automatically share your normal browser login state. Kraken preserves your real `HOME` for `agent-browser`, so the CLI can use its built-in auth options through `.env`.

Pick one strategy:

```bash
# Reuse an existing Chrome profile. Check names with: agent-browser profiles
AGENT_BROWSER_PROFILE=Default

# Or connect to an already-running Chrome that was started with remote debugging.
AGENT_BROWSER_AUTO_CONNECT=true

# Or let agent-browser save/restore cookies and localStorage under a named state.
AGENT_BROWSER_SESSION_NAME=kraken

# Or load a previously saved state file.
AGENT_BROWSER_STATE=/absolute/path/to/auth.json
```

Do not use the same live Chrome profile in two running Chrome instances at once. If Chrome rejects the profile because it is already locked, use `AGENT_BROWSER_AUTO_CONNECT=true` or create a dedicated profile for Kraken.

Recommended dedicated Chrome setup:

```bash
# Create a separate Chrome user data directory for Kraken.
mkdir -p "$HOME/.kraken/chrome-debug-profile"

# Start Chrome with remote debugging enabled and the dedicated profile.
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.kraken/chrome-debug-profile"
```

After Chrome opens, sign in to the sites Kraken should use. Then configure `.env` with only the auto-connect strategy:

```bash
AGENT_BROWSER_AUTO_CONNECT=true
# AGENT_BROWSER_PROFILE=Default
# AGENT_BROWSER_SESSION_NAME=kraken
# AGENT_BROWSER_STATE=
```

Restart Kraken after changing `.env`. Keep this dedicated Chrome window running while using `agent_browser`; a normal Chrome window launched without `--remote-debugging-port=9222` cannot be auto-connected.

## License

MIT
