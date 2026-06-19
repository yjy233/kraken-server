# 环境变量总览

完整模板见 [`.env.example`](/Users/bill/code/kraken-server/.env.example)。

## 基础服务

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_TITLE` | `Kraken Agent` | 前端标题和服务日志名称 |
| `HOST` | `0.0.0.0` | HTTP 监听地址 |
| `PORT` | `3011` | HTTP 监听端口 |

## OpenRouter / 模型配置

| 变量 | 说明 |
| --- | --- |
| `OPENROUTER_BASE_URL` | OpenRouter API 地址 |
| `OPENROUTER_API_KEY` | OpenRouter API Key |
| `OPENROUTER_MODEL` | 默认模型 |
| `OPENROUTER_PROMPT_CACHE` | 是否启用 prompt cache 标记 |
| `MAX_TOKENS` | 单次请求输出 token 上限 |
| `MAX_CONTEXT_TOKENS` | 上下文窗口目标上限 |
| `MAX_CONTEXT_MESSAGES` | 会话上下文消息数上限 |
| `MAX_AGENT_STEPS` | agent 最大工具循环步数 |
| `REQUEST_TIMEOUT_MS` | agent 请求超时 |

## 工具权限

| 变量 | 说明 |
| --- | --- |
| `ALLOW_SHELL_TOOL` | 是否允许 shell tool |
| `ALLOW_FILE_WRITE_TOOL` | 是否允许文件写入 tool |
| `ENABLED_TOOLS` | 工具白名单，逗号分隔 |

## Scheduler

| 变量 | 说明 |
| --- | --- |
| `SCHEDULER_ENABLED` | 是否启用定时任务 |
| `SCHEDULER_POLL_INTERVAL_MS` | 定时任务扫描间隔 |
| `SCHEDULER_MAX_CONCURRENCY` | 定时任务最大并发 |

## Market 配置

详见 [Market 环境配置](./market.md)。

## Agent Browser 配置

| 变量 | 说明 |
| --- | --- |
| `ALLOW_AGENT_BROWSER` | 是否启用浏览器工具 |
| `AGENT_BROWSER_BIN` | agent-browser 可执行文件 |
| `AGENT_BROWSER_MAX_OUTPUT` | 浏览器工具最大输出 |
| `AGENT_BROWSER_DEFAULT_TIMEOUT` | 浏览器工具默认超时 |
| `AGENT_BROWSER_ALLOWED_DOMAINS` | 允许访问域名 |
| `AGENT_BROWSER_PROFILE` | 复用 Chrome profile |
| `AGENT_BROWSER_AUTO_CONNECT` | 连接已启动的 Chrome |
| `AGENT_BROWSER_SESSION_NAME` | agent-browser 状态名 |
| `AGENT_BROWSER_STATE` | 已保存的 auth state 文件 |

## Feishu

| 变量 | 说明 |
| --- | --- |
| `FEISHU_ENABLED` | 是否启用飞书机器人 |
| `FEISHU_EVENT_MODE` | 当前生产路径为 `ws` |
| `FEISHU_APP_ID` | 飞书 app id |
| `FEISHU_APP_SECRET` | 飞书 app secret |
| `FEISHU_SESSION_MODE` | `chat` 或 `user` |
| `FEISHU_REPLY_MODE` | `reply` 或 `send` |
| `FEISHU_CHANNEL_SKILL` | 飞书通道默认 skill hint |
