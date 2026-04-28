# Agent Browser 集成技术方案

## 1. 背景

当前仓库已有一个轻量 `browser` 工具方向，用 `fetch` 和 HTML 文本解析提供基础网页读取与链接跳转能力。这个方案不能执行真实浏览器行为，也无法覆盖现代 Web 应用里的表单、按钮、SPA 导航、截图、网络请求、登录态、可访问性树和调试信息。

本方案改为使用 `vercel-labs/agent-browser` 作为浏览器自动化后端。`agent-browser` 是面向 AI agent 的原生 Rust CLI，核心模型是“CLI client + 常驻 daemon + Chrome/CDP 浏览器实例”。Kraken Server 只做工具适配和安全边界控制，不重新实现浏览器自动化。

参考资料：

- https://github.com/vercel-labs/agent-browser
- https://agent-browser.dev/schema.json

## 2. 目标

- 为 agent 提供真实浏览器能力：打开页面、获取 snapshot、点击、输入、等待、截图、读取 URL/title/text、查看 console/network。
- 与现有 ReAct 工具体系兼容：工具调用结果继续进入 session 上下文并在前端显示。
- 每个 Kraken session 使用隔离的 agent-browser session，避免不同会话共享页面、cookie、历史和 refs。
- 默认使用安全收敛的命令子集，不暴露任意 shell 命令或高风险浏览器控制。
- 支持后续扩展 live preview、dashboard、登录态复用和移动端测试。

## 3. 非目标

- 本阶段不实现代码。
- 不直接暴露 `agent-browser chat`，Kraken 已有自己的模型循环，browser 只作为工具后端。
- 不默认复用用户本机 Chrome profile。
- 不默认允许 `file://` 或 `--allow-file-access`。
- 不默认开放 `eval`、下载、上传、剪贴板、远程 CDP、auto-connect 等高风险动作。

## 4. 上游能力摘录

`agent-browser` 提供以下能力，适合直接映射为 Kraken 工具动作：

- Core: `open`, `click`, `fill`, `type`, `press`, `hover`, `scroll`, `screenshot`, `snapshot`, `close`
- Info: `get text`, `get html`, `get value`, `get title`, `get url`, `get count`
- Semantic find: `find role`, `find text`, `find label`, `find placeholder`, `find testid`
- Wait: selector、毫秒、文本、URL、load state、JS condition
- Batch: 多命令一次调用，降低进程启动成本
- Tabs: `tab`, `tab new`, `tab <id|label>`, `tab close`
- Network: requests、request detail、HAR、route/mock
- Debug: console、errors、trace、profiler
- State: save/load/list/clear auth state
- Sessions: `--session <name>` 或 `AGENT_BROWSER_SESSION`
- Safety: `--content-boundaries`, `--max-output`, `--allowed-domains`, `--action-policy`, `--confirm-actions`
- Agent mode: `--json` machine-readable output，snapshot refs 如 `@e1`

## 5. 总体架构

```text
Kraken Agent Loop
  |
  | tool_use: agent_browser
  v
src/tools/agent-browser.ts
  |
  | spawnFile("agent-browser", sanitized args, controlled env)
  v
agent-browser CLI
  |
  | IPC
  v
agent-browser daemon
  |
  | CDP/WebDriver
  v
Chrome / Lightpanda / provider
```

关键原则：

- Kraken 不通过 shell 拼接命令；使用 `spawnFile` 或 `execFile` 传数组参数。
- Kraken 只允许 schema 中定义的动作，不提供自由形式 `command`。
- 每次工具调用都带 `--session kraken-<sessionId>`。
- 需要机器输出的命令默认带 `--json`。
- 截图、下载、state、profile 等文件路径必须落在当前 session 的 sandbox 目录下。

## 6. 工具设计

建议新增或替换为一个工具名：

```text
agent_browser
```

保留 `browser` 作为兼容别名也可以，但长期建议使用 `agent_browser`，避免和当前轻量实现混淆。

### 6.1 输入 schema

建议第一阶段支持以下动作：

```ts
type AgentBrowserAction =
  | 'open'
  | 'snapshot'
  | 'click'
  | 'fill'
  | 'type'
  | 'press'
  | 'hover'
  | 'scroll'
  | 'wait'
  | 'get_text'
  | 'get_title'
  | 'get_url'
  | 'screenshot'
  | 'back'
  | 'forward'
  | 'reload'
  | 'tab_list'
  | 'tab_new'
  | 'tab_switch'
  | 'tab_close'
  | 'console'
  | 'errors'
  | 'network_requests'
  | 'close'
```

公共字段：

```ts
interface AgentBrowserInput {
  action: AgentBrowserAction
  url?: string
  selector?: string
  ref?: string
  text?: string
  key?: string
  direction?: 'up' | 'down' | 'left' | 'right'
  pixels?: number
  waitFor?: {
    selector?: string
    text?: string
    url?: string
    load?: 'load' | 'domcontentloaded' | 'networkidle'
    ms?: number
  }
  tab?: string
  label?: string
  fullPage?: boolean
  interactiveOnly?: boolean
  compact?: boolean
  depth?: number
  maxOutput?: number
}
```

选择器规则：

- `ref` 优先，例如 `@e2`。
- `selector` 支持 CSS、text、xpath 和 agent-browser 语义选择器。
- 若二者都传，以 `ref` 为准。
- `click/fill/type/hover/get_text` 必须提供 `ref` 或 `selector`。

### 6.2 动作映射

| Kraken action | agent-browser 命令 |
|---|---|
| `open` | `agent-browser --session <id> open <url> --json` |
| `snapshot` | `agent-browser --session <id> snapshot -i -c --json` |
| `click` | `agent-browser --session <id> click <ref-or-selector> --json` |
| `fill` | `agent-browser --session <id> fill <ref-or-selector> <text> --json` |
| `type` | `agent-browser --session <id> type <ref-or-selector> <text> --json` |
| `press` | `agent-browser --session <id> press <key> --json` |
| `wait` | `agent-browser --session <id> wait ... --json` |
| `get_text` | `agent-browser --session <id> get text <ref-or-selector> --json` |
| `get_title` | `agent-browser --session <id> get title --json` |
| `get_url` | `agent-browser --session <id> get url --json` |
| `screenshot` | `agent-browser --session <id> screenshot <sandbox-path> --json` |
| `back` | `agent-browser --session <id> back --json` |
| `tab_list` | `agent-browser --session <id> tab --json` |
| `close` | `agent-browser --session <id> close --json` |

第二阶段再开放：

- `network request <id>`
- `network har start/stop`
- `trace start/stop`
- `state save/load`
- `find role/text/label ...`
- `screenshot --annotate`

## 7. Session 映射

Kraken session id 到 agent-browser session name：

```text
kraken-<safeSessionId>
```

要求：

- 只允许 `[a-zA-Z0-9._-]`。
- 过长 session id 需要 hash 截断。
- scheduler 任务也使用它自己的 session id 映射，避免和聊天会话混用。

每个 agent-browser session 自带隔离的：

- browser instance
- cookies/storage
- navigation history
- refs/snapshot state

Kraken session 删除时，后续实现应调用：

```bash
agent-browser --session kraken-<id> close
```

全量清理时可以按 session 列表逐个 close，避免误关用户自己启动的其他 agent-browser session。

## 8. 文件与沙箱策略

浏览器相关文件统一放到 session sandbox 下：

```text
<workspaceRoot>/.sandbox/agent-browser/
  sessions/
  profiles/
  screenshots/
  downloads/
  traces/
  har/
  policy/
```

默认策略：

- screenshot 输出路径：`sandboxPolicy.tmpDir` 或专用 `screenshots/`
- download path：专用 `downloads/`
- profile path：不默认开启；需要用户配置后才使用
- state file：不默认开启；需要用户明确保存登录态
- 禁止 `file://`
- 禁止 `--allow-file-access`

如需打开本地 HTML/PDF，必须走显式配置：

```ts
allowLocalFiles: true
```

并通过现有 `resolveSandboxPath` 验证文件路径在可读 roots 内。

## 9. 安全策略

### 9.1 CLI 执行安全

- 禁止 shell 拼接。
- 使用参数数组。
- 对 URL、selector、text 不做命令字符串插值。
- 设置 timeout，默认不超过 `REQUEST_TIMEOUT_MS`。
- 捕获 stdout/stderr，限制最大输出长度。
- agent-browser 未安装时返回可操作错误，不自动安装。

### 9.2 浏览器安全

默认加这些参数或环境变量：

```text
--content-boundaries
--max-output <MAX_BROWSER_OUTPUT>
--session <kraken-session>
```

可选配置：

```text
AGENT_BROWSER_ALLOWED_DOMAINS
AGENT_BROWSER_ACTION_POLICY
AGENT_BROWSER_DEFAULT_TIMEOUT
AGENT_BROWSER_IDLE_TIMEOUT_MS
AGENT_BROWSER_SCREENSHOT_DIR
AGENT_BROWSER_DOWNLOAD_PATH
```

默认禁用或不暴露：

- `eval`
- `clipboard`
- `upload`
- `download`
- `--auto-connect`
- `--profile Default`
- `--cdp`
- `--allow-file-access`
- `auth login`
- `state load` 外部路径

### 9.3 Domain allowlist

推荐新增 session 级配置：

```ts
interface SessionBrowserConfig {
  allowedDomains?: string[]
  headed?: boolean
  profilePath?: string
  persistState?: boolean
}
```

如果 `allowedDomains` 存在：

- 转成 `--allowed-domains "example.com,*.example.com"`
- 同时作为 prompt 中的浏览范围提示

如果不存在：

- 允许公网浏览，但仍保留 `--content-boundaries` 和输出长度限制

## 10. 输出规范

工具输出应返回适合 LLM 和前端显示的结构化文本。

建议包装格式：

```text
Command: agent-browser snapshot -i -c --json
Session: kraken-...
URL: https://...
Title: ...

Result:
<normalized JSON or text>

Artifacts:
- screenshot: .sandbox/agent-browser/screenshots/...
```

对于 JSON 输出：

- 优先解析 JSON。
- 如果 JSON 中有 `success: false`，转成 tool error。
- 对大字段按 `maxOutput` 截断。
- snapshot 保留 refs，refs 是后续 click/fill 的关键上下文。

前端显示：

- 延续现有 tool call 大气泡显示。
- input 显示 Kraken action schema。
- output 显示归一化结果。
- screenshot artifact 后续可渲染为图片缩略图。

## 11. Prompt 设计

`PromptBuilder` 中新增 Agent Browser 指南：

```text
Use agent_browser for real browser automation.
Core workflow:
1. open URL.
2. snapshot with interactiveOnly=true to inspect refs.
3. click/fill/type using refs like @e1.
4. wait after navigation or dynamic UI changes.
5. re-snapshot after page changes.
Use web_fetch for static page text when no interaction is needed.
Do not use browser actions for local project files unless the user asks for browser rendering.
```

关键偏好：

- 需要交互、登录、截图、前端验证时用 `agent_browser`。
- 只读静态文章或文档时优先 `web_fetch`。
- 需要搜索入口时先 `search`，再 `agent_browser open` 目标页。
- 每次页面变化后重新 `snapshot`。
- 优先用 refs，不优先用脆弱 CSS selector。

## 12. 配置项

建议新增环境变量：

```bash
ALLOW_AGENT_BROWSER=true
AGENT_BROWSER_BIN=agent-browser
AGENT_BROWSER_MAX_OUTPUT=50000
AGENT_BROWSER_DEFAULT_TIMEOUT=25000
AGENT_BROWSER_IDLE_TIMEOUT_MS=600000
AGENT_BROWSER_HEADLESS=true
AGENT_BROWSER_DASHBOARD=false
AGENT_BROWSER_ALLOWED_DOMAINS=
```

建议新增 registry option：

```ts
interface CreateRegistryOptions {
  allowAgentBrowserTool: boolean
  agentBrowserBin: string
  agentBrowserMaxOutput: number
}
```

## 13. 安装与启动策略

推荐使用 project-local dependency：

```bash
npm install agent-browser
npx agent-browser install
```

原因：

- 版本可锁定在 `package.json`。
- CI 和部署行为可重复。
- 不依赖用户全局环境。

运行时查找顺序：

1. `AGENT_BROWSER_BIN`
2. `node_modules/.bin/agent-browser`
3. `agent-browser` from PATH

首次健康检查：

```bash
agent-browser doctor --json
```

不在工具执行时自动安装 Chrome。缺依赖时返回错误，引导用户执行安装命令。

## 14. Observability 与前端预览

第一阶段只显示 tool output。

第二阶段可以接入：

- `agent-browser dashboard start --port <port>`
- `agent-browser stream status`
- WebSocket browser preview

Kraken 前端可增加 Browser panel：

- 当前 session URL/title
- live screenshot/frame
- command timeline
- console errors
- artifact list

默认不自动启动 dashboard，避免额外端口和后台进程。

## 15. 实施阶段

### Phase 1: 适配器和基础动作

- 新增 `agent_browser` 工具文件。
- 使用 `spawnFile` 调 `agent-browser`。
- 支持 `open/snapshot/click/fill/type/press/wait/get_url/get_title/screenshot/back/close`。
- 注册工具开关 `ALLOW_AGENT_BROWSER`。
- 更新 prompt。
- 保留 `web_fetch/search`。

验收：

- `agent_browser open https://example.com`
- `agent_browser snapshot`
- `agent_browser click @e...`
- 工具结果进入下一轮上下文。

### Phase 2: 安全与生命周期

- session delete 时 close 对应 browser session。
- clear all 时清理所有 `kraken-*` browser sessions。
- 支持 domain allowlist。
- 支持 output max。
- 支持 screenshot artifact 路径校验。
- 加 `doctor --json` 健康检查 API。

### Phase 3: 高级浏览器能力

- network requests / request detail
- console/errors
- tabs
- annotated screenshot
- HAR/trace
- optional dashboard/stream preview

### Phase 4: 登录态和 profile

- 支持 session-local profile。
- 支持 state save/load 到 sandbox。
- 支持加密 key 配置。
- 明确 UI 提示 state 文件含敏感 token。

## 16. 测试计划

单元测试：

- action 到 argv 映射。
- session id sanitize。
- URL 校验。
- selector/ref 选择。
- 输出截断。
- JSON parse error fallback。

集成测试：

- 未安装 `agent-browser` 时返回可读错误。
- `doctor --json` 成功。
- `open example.com` 后 `snapshot -i --json` 有 refs。
- `click/fill` 使用 ref。
- screenshot 保存到 sandbox 目录。
- session A/B 页面互不影响。

手工 smoke：

```bash
npm run check
npm run build
agent-browser doctor --json
```

通过 Kraken UI：

1. 询问 agent 打开一个页面。
2. 要求读取 title/url。
3. 要求点击页面内链接。
4. 确认 tool call 和 tool result 保存在同一 assistant 大气泡内。
5. 下一轮让 agent 基于上一轮 snapshot ref 继续操作。

## 17. 主要风险

- CLI/daemon 生命周期失控：需要 close hooks 和 idle timeout。
- 登录态泄漏：默认不复用用户 profile，不默认保存 state。
- 输出过大：强制 `--max-output` 并在 wrapper 二次截断。
- 任意命令风险：不暴露 raw command。
- 自动浏览外站风险：支持 domain allowlist。
- 浏览器依赖安装失败：用 doctor 检查并给出明确错误。
- refs 过期：prompt 中要求页面变化后重新 snapshot。

## 18. 当前仓库落点

预计改动文件：

```text
src/tools/agent-browser.ts
src/tools/registry.ts
src/agent/prompt-builder.ts
src/server.ts
src/frontend/types.ts
src/frontend/components/MessageList.tsx
docs/tools.md
package.json
```

如果保留当前 `src/tools/browser.ts`：

- 短期：作为 `web_fetch` 的增强替代或 fallback。
- 长期：删除或改名为 `browser_fetch`，避免和真实浏览器工具混淆。

推荐最终状态：

```text
search       -> 找入口和最新信息
web_fetch    -> 读取静态网页文本
agent_browser -> 真实浏览器交互和前端验证
```
