## Kraken Server

这是一个围绕你个人项目 `Kraken` 搭起来的 Web Server。

后端负责：

- 加载 `Kraken` 的 Agent 核心逻辑
- 提供 HTTP API
- 通过 `text/event-stream` 把 Agent 执行过程推到前端

前端负责：

- 发送用户消息
- 展示多轮会话
- 展示 `thinking / tool_call / tool_result / response`
- 管理 session 和配置状态

## 当前结构

- `src/server.js`
  Web Server 主入口，提供静态资源、`/api/config`、`/api/chat`、`/api/session/clear`、`/api/reload`
- `src/kraken-loader.js`
  运行时加载 `Kraken` 模块，优先从已安装包 `@yjy233/kraken` 读取，读不到时回退到本地 `../Kraken/dist`
- `public/index.html`
  页面骨架
- `public/styles.css`
  页面样式
- `public/app.js`
  前端交互逻辑和 SSE 流处理

## 依赖关系

这个仓库本身是一个薄封装。

核心 Agent 逻辑来自：

- `../Kraken/dist/...`
  或
- `node_modules/@yjy233/kraken/dist/...`

也就是说：

1. 你可以直接把它当成 `Kraken` 的 Web 外壳
2. 如果你更新了 `Kraken` 源码，但 `dist` 没更新，记得先在 `Kraken` 仓库里重新 build

## API

- `GET /api/config`
  返回当前 server 和 agent 的可用状态
- `GET /api/health`
  健康检查
- `POST /api/chat`
  请求体：`{ "sessionId": "...", "message": "..." }`
  返回：SSE 流
- `POST /api/session/clear`
  清空某个 session 的上下文
- `POST /api/reload`
  重新加载 `Kraken` 配置和 Agent

## 运行

```bash
npm run dev
```

默认监听：

```bash
http://localhost:3000
```

## 配置要求

Web Server 最终还是复用 `Kraken` 的配置加载逻辑，所以 API Key 仍然走这些位置：

- 环境变量：`LLM_API_KEY` / `OPENAI_API_KEY`
- `~/.Kraken/Kraken.json`
- `./.Kraken/Kraken.json`

如果没配 API Key，Server 也会启动，但 `/api/config` 会返回 `ready: false`，前端会直接展示问题原因。
