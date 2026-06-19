# Kraken Agent

<p align="center">
  <img src="assets/assets/logo.png" width="120" alt="Kraken Agent Logo">
</p>

Kraken Agent 是一个本地 AI 助手服务，支持工具调用、多轮会话、定时任务、飞书机器人通道，以及本地网页工作台。模型请求走 OpenRouter，前端提供聊天、文件、定时任务、用量统计、Market 投研台等入口。

## 功能概览

- **Agent 工具循环**：支持多步工具调用。
- **流式前端**：实时展示回答和工具执行过程。
- **会话管理**：用 JSON 文件持久化本地会话。
- **工具系统**：支持文件、Shell、网页、代码编辑等工具。
- **飞书机器人通道**：通过飞书长连接复用同一套 agent runtime。
- **Market 投研台**：本地股票盯盘、真实行情 bridge、技术面分析和研究型提醒。

## 技术栈

- 后端：Express 5 + TypeScript + SSE
- 前端：React 19 + esbuild
- 模型：OpenRouter
- 运行时：Node.js + tsx
- Market bridge：Python + AKShare / 新浪 / 腾讯公开源

## 快速启动

```bash
# 安装 Node 依赖
bun install

# 创建本地环境文件
cp .env.example .env
# 编辑 .env，至少填 OPENROUTER_API_KEY

# 启动开发服务
bun run dev
```

打开 `http://localhost:3011`。

## Market 安装和启动

仓库内置了一个本地 A 股投研台，对应前端 `Market` tab。行情数据通过单独的 Python bridge 获取。

快速启动：

```bash
# 安装 Node 依赖
bun install

# 安装 Python 行情 bridge 依赖
uv sync

# 创建环境文件
cp .env.example .env

# 启动 AKShare bridge
uv run python scripts/market/akshare_http_bridge.py --host 127.0.0.1 --port 8000

# 启动 Kraken
PATH=/opt/homebrew/bin:$PATH ./node_modules/.bin/tsx src/server.ts
```

推荐 Market 环境变量：

```bash
MARKET_PROVIDER=akshare-http
MARKET_ALLOW_MOCK_FALLBACK=false
AKSHARE_BASE_URL=http://127.0.0.1:8000
AKSHARE_TIMEOUT_MS=15000
```

Market 相关文档：

- [docs/market/README.md](/Users/bill/code/kraken-server/docs/market/README.md)
- [docs/market/akshare-setup.md](/Users/bill/code/kraken-server/docs/market/akshare-setup.md)
- [docs/market/data-sources.md](/Users/bill/code/kraken-server/docs/market/data-sources.md)
- [docs/market/runbook.md](/Users/bill/code/kraken-server/docs/market/runbook.md)
- [docs/env/market.md](/Users/bill/code/kraken-server/docs/env/market.md)

## 工具配置

工具通过 `.env` 控制：

- `ENABLED_TOOLS`：工具白名单，逗号分隔，例如 `list_directory,read_file,todo`。
- `ALLOW_SHELL_TOOL`：是否允许执行 shell 命令。
- `ALLOW_FILE_WRITE_TOOL`：是否允许写文件。
- `ALLOW_AGENT_BROWSER`：是否启用真实浏览器自动化工具 `agent-browser`。

## 飞书机器人

Kraken 可以通过飞书自建应用的长连接模式接入机器人。用户可以在飞书私聊或群聊中访问同一套 agent runtime。

当前范围：

- 只支持长连接 / websocket 模式。
- 只支持文本消息。
- 群聊需要 `@` 机器人。
- 飞书消息元信息会传给 agent，例如 `message_id`、`chat_id`、`sender_id`。
- 飞书通道 prompt 会提示 agent 优先使用 `dingtakl-feishu-cn` skill。

当前不包含 HTTP callback 模式。

1. 创建飞书自建应用，并启用机器人能力。
2. 订阅 `im.message.receive_v1` 事件。
3. 给应用授权接收机器人消息、读取消息内容、发送消息、回复消息。
4. 在 `.env` 填写飞书相关环境变量。
5. 启动 Kraken，飞书通道会在服务启动时自动连接。

`.env` 示例：

```bash
FEISHU_ENABLED=true
FEISHU_EVENT_MODE=ws
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx

# 可选
FEISHU_SESSION_MODE=chat
FEISHU_REPLY_MODE=reply
FEISHU_CHANNEL_SKILL=dingtakl-feishu-cn
FEISHU_INCLUDE_MESSAGE_META=true

# 可选：近似流式回复更新
FEISHU_STREAMING_ENABLED=false
FEISHU_STREAMING_MODE=update
FEISHU_STREAMING_FLUSH_INTERVAL_MS=1500
FEISHU_STREAMING_MIN_DELTA_CHARS=80
FEISHU_STREAMING_MAX_UPDATES=20
```

说明：

- `FEISHU_SESSION_MODE=chat` 表示每个群聊共用一个 Kraken session；`user` 表示同一群聊内按发送者隔离。
- `FEISHU_REPLY_MODE=reply` 表示回复原消息；`send` 表示往会话里发送新消息。
- `FEISHU_CHANNEL_SKILL` 默认是 `dingtakl-feishu-cn`。
- 会话映射和去重状态保存在 `.feishu-sessions/`。

更完整设计见 [docs/feishu-robot-integration.md](/Users/bill/code/kraken-server/docs/feishu-robot-integration.md)。

## Agent Browser 配置

Kraken 可以通过 [`vercel-labs/agent-browser`](https://github.com/vercel-labs/agent-browser) 使用真实浏览器自动化能力，包括页面渲染、快照、点击、表单输入、导航、标签页和截图。

该集成依赖 `agent-browser` CLI。Kraken 不会自动安装浏览器运行环境。

启用工具前先安装：

```bash
# 安装 CLI 到项目或全局环境
npm install agent-browser

# 安装并检查 agent-browser 需要的浏览器运行环境
npx agent-browser install
npx agent-browser doctor --json
```

然后在 `.env` 启用：

```bash
ALLOW_AGENT_BROWSER=true

# 可选覆盖项
AGENT_BROWSER_BIN=agent-browser
AGENT_BROWSER_MAX_OUTPUT=50000
AGENT_BROWSER_DEFAULT_TIMEOUT=25000
AGENT_BROWSER_ALLOWED_DOMAINS=
```

如果没有设置 `AGENT_BROWSER_BIN`，Kraken 会先找 `node_modules/.bin/agent-browser`，再找 `PATH` 里的 `agent-browser`。

`AGENT_BROWSER_ALLOWED_DOMAINS` 留空表示不限制域名。`AGENT_BROWSER_ALLOWED_DOMAINS=*` 在 Kraken 内也会被当作不限制处理。

启用后，agent 会获得 `agent_browser` 工具。每个 Kraken session 会映射到单独的 `agent-browser` session，名称为 `kraken-<sessionId>`，避免页面、refs、cookies 和历史在不同聊天间串用。

如果使用 `ENABLED_TOOLS` 白名单，需要把 `agent_browser` 加进去。

### 浏览器登录态

默认情况下，`agent-browser` 会启动隔离浏览器 session，不会自动共享你的普通浏览器登录态。Kraken 会保留真实 `HOME`，所以可以通过 `.env` 使用 `agent-browser` 自带的登录态选项。

选择一种方式：

```bash
# 复用已有 Chrome profile，可用 agent-browser profiles 查看名称
AGENT_BROWSER_PROFILE=Default

# 或连接一个已用 remote debugging 启动的 Chrome
AGENT_BROWSER_AUTO_CONNECT=true

# 或让 agent-browser 以指定名称保存/恢复 cookies 和 localStorage
AGENT_BROWSER_SESSION_NAME=kraken

# 或加载已经保存好的 auth state 文件
AGENT_BROWSER_STATE=/absolute/path/to/auth.json
```

不要在两个正在运行的 Chrome 实例里同时使用同一个 profile。如果 Chrome 因 profile 被锁拒绝启动，请使用 `AGENT_BROWSER_AUTO_CONNECT=true`，或给 Kraken 创建专用 profile。

推荐专用 Chrome 配置：

```bash
# 为 Kraken 创建独立 Chrome 用户数据目录
mkdir -p "$HOME/.kraken/chrome-debug-profile"

# 启动带 remote debugging 的专用 Chrome
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.kraken/chrome-debug-profile"
```

Chrome 打开后，登录 Kraken 需要访问的网站。然后只保留自动连接策略：

```bash
AGENT_BROWSER_AUTO_CONNECT=true
# AGENT_BROWSER_PROFILE=Default
# AGENT_BROWSER_SESSION_NAME=kraken
# AGENT_BROWSER_STATE=
```

修改 `.env` 后重启 Kraken。使用 `agent_browser` 时保持这个专用 Chrome 窗口运行；没有 `--remote-debugging-port=9222` 的普通 Chrome 窗口无法被自动连接。

## 许可证

MIT
