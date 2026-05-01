# 飞书机器人接入技术方案

## 1. 背景

当前 Kraken Server 已经具备 Web 前端、WebSocket 对话、session 持久化、工具调用、scheduler 和 workspace sandbox 能力。飞书机器人接入的目标是新增一个外部消息通道，让用户可以在飞书私聊机器人或群聊 @ 机器人时复用同一套 Agent Runtime。

本方案只新增 Feishu Channel，不改 Agent 核心循环。飞书消息进入后被转换成现有 `AgentService.run(...)` 请求，执行完成后再通过飞书消息 API 回复。

参考资料：

- 飞书接收消息事件：`im.message.receive_v1`
- 飞书回复消息接口：`/im/v1/messages/{message_id}/reply`
- 飞书 tenant access token：`/auth/v3/tenant_access_token/internal`
- 飞书事件订阅：HTTP Callback 或长连接
- 飞书 Node SDK：`@larksuiteoapi/node-sdk`

## 2. 目标

- 支持飞书私聊机器人对话。
- 支持飞书群聊中 @ 机器人后触发对话。
- 复用现有 Kraken session、system prompt、sandbox、tool registry 和 agent loop。
- 每个飞书会话可以持续保留上下文。
- 支持异步处理，避免飞书事件超时导致重复执行。
- 支持幂等去重，避免飞书事件重试造成重复回复。
- 配置写入 `.env.example` 和 README，便于部署。

## 3. 非目标

- 第一阶段不支持飞书自定义 webhook 机器人作为主要对话入口。
- 第一阶段不支持飞书图片、文件、语音、富文本卡片输入。
- 第一阶段不实现 Markdown 到飞书富文本的完整转换。
- 第一阶段不实现多实例分布式锁。
- 第一阶段不把飞书机器人做成独立服务，仍随 Kraken Server 进程启动。

## 4. 接入方式

推荐使用：

```text
飞书自建应用机器人 + 长连接事件订阅
```

原因：

- 长连接不要求 Kraken Server 暴露公网 HTTPS 回调地址。
- 适合部署在个人 Mac、内网机器或局域网服务器。
- 可以接收用户私聊、群聊 @ 机器人等事件。
- 可以通过官方 SDK 管理事件、token 和消息 API。

备用方案：

```text
飞书自建应用机器人 + HTTP Callback
```

适合已经有公网 HTTPS 域名的部署方式。HTTP Callback 需要实现飞书 URL verification、签名校验和可选加密解密。

不推荐第一阶段使用：

```text
群自定义 webhook 机器人
```

它更适合通知推送，不适合作为完整双向对话入口。

## 5. 总体架构

```text
Feishu App Bot
  |
  | im.message.receive_v1
  v
src/integrations/feishu/service.ts
  |
  | normalize event
  v
src/integrations/feishu/adapter.ts
  |
  | resolve session
  v
src/runtime/agent-service.ts
  |
  | run existing Kraken agent
  v
src/integrations/feishu/client.ts
  |
  | reply message API
  v
Feishu Chat
```

关键原则：

- Feishu Channel 只做消息入口和出口。
- Agent Runtime 不感知飞书协议。
- session 映射在 Feishu Channel 内部维护。
- 飞书事件处理必须快速返回，实际 agent 执行进入后台任务。
- 回复失败只影响飞书通道，不污染 agent session。

## 6. 建议目录结构

```text
src/integrations/feishu/
  config.ts          # 读取和校验 FEISHU_* 配置
  client.ts          # 飞书 OpenAPI 封装：token、reply、send
  service.ts         # 事件订阅、事件分发、后台任务
  adapter.ts         # 飞书消息 <-> Kraken message 转换
  session-map.ts     # 飞书会话与 Kraken session 映射
  dedupe-store.ts    # event/message 幂等去重
  types.ts           # 本地类型
```

`src/server.ts` 只在启动时做条件初始化：

```text
if FEISHU_ENABLED=true:
  createFeishuService(...).start()
```

## 7. 配置设计

建议新增 `.env.example`：

```env
FEISHU_ENABLED=false

# ws: 飞书长连接事件订阅，推荐
# http: 飞书 HTTP Callback，适合公网 HTTPS 部署
FEISHU_EVENT_MODE=ws

FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_VERIFICATION_TOKEN=
FEISHU_ENCRYPT_KEY=

# chat: 群聊共享一个 Kraken session
# user: 群聊按用户隔离 session
FEISHU_SESSION_MODE=chat

# reply: 回复原消息
# send: 主动向会话发送新消息
FEISHU_REPLY_MODE=reply

FEISHU_DEFAULT_SYSTEM_PROMPT=
FEISHU_MAX_CONCURRENCY=1
FEISHU_DEDUPE_TTL_MS=600000
```

配置说明：

- `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 用于获取 tenant access token。
- `FEISHU_VERIFICATION_TOKEN` 用于 HTTP Callback 事件校验。
- `FEISHU_ENCRYPT_KEY` 用于飞书事件加密解密，第一阶段可先不启用加密。
- `FEISHU_SESSION_MODE=chat` 时，群聊所有人共享上下文。
- `FEISHU_SESSION_MODE=user` 时，群聊里每个用户独立上下文。

## 8. 飞书后台配置

需要创建飞书自建应用：

1. 开启机器人能力。
2. 获取 `App ID` 和 `App Secret`。
3. 订阅事件：`im.message.receive_v1`。
4. 申请并发布权限：
   - 接收用户发给机器人的单聊消息
   - 接收群聊中 @ 机器人的消息
   - 读取消息内容
   - 发送消息
   - 回复消息
5. 如果使用长连接，开启长连接事件订阅。
6. 如果使用 HTTP Callback，配置请求 URL、verification token 和 encrypt key。

## 9. 消息处理流程

### 9.1 接收事件

收到 `im.message.receive_v1` 后：

1. 读取 `event_id`、`message_id`、`chat_id`、`chat_type`、`sender`、`message_type`。
2. 检查幂等去重。
3. 过滤机器人自己发出的消息。
4. 只处理文本消息。
5. 私聊直接处理。
6. 群聊只处理 @ 当前机器人的消息。
7. 去除 @ 机器人 mention 文本。
8. 空消息直接忽略。

### 9.2 映射 session

根据飞书事件生成 conversation key：

```text
p2p:
  feishu:p2p:{open_id}

group + FEISHU_SESSION_MODE=chat:
  feishu:group:{chat_id}

group + FEISHU_SESSION_MODE=user:
  feishu:group:{chat_id}:user:{open_id}
```

查询 `.feishu-sessions/map.json`：

- 如果存在映射，复用已有 Kraken session。
- 如果不存在，创建新 session，并保存映射。

### 9.3 调用 Agent

转换后的请求：

```ts
agentService.run({
  sessionId,
  message,
  systemPrompt,
  sandbox,
  model,
})
```

建议给消息加少量来源上下文：

```text
[Feishu message]
chat_type: group
sender_name: 张三

用户原文...
```

注意：不要把飞书 access token、app secret 等敏感信息写入 agent 上下文。

### 9.4 回复飞书

MVP 使用回复原消息：

```text
POST /im/v1/messages/{message_id}/reply
```

回复策略：

- 成功：回复 agent final answer。
- 失败：回复简短错误，例如“处理失败，请稍后重试。”
- 超长回复：按飞书长度限制拆分多条。
- 空回复：回复“已完成，但没有文本输出。”

## 10. 异步执行

飞书事件回调不应该等待完整 agent 执行。推荐流程：

```text
receive event
  -> verify
  -> dedupe
  -> enqueue background task
  -> return success to Feishu

background task
  -> optional "处理中..."
  -> run agent
  -> reply final answer
```

可以先用进程内队列实现：

```text
FEISHU_MAX_CONCURRENCY=1
```

后续如果需要多实例部署，再引入 Redis / database queue。

## 11. 幂等与状态存储

建议新增目录：

```text
.feishu-sessions/
  map.json
  dedupe.json
```

`map.json`：

```json
{
  "feishu:p2p:ou_xxx": {
    "sessionId": "xxx",
    "createdAt": "2026-05-01T00:00:00.000Z",
    "updatedAt": "2026-05-01T00:00:00.000Z"
  }
}
```

`dedupe.json`：

```json
{
  "message_id_or_event_id": 1777628734466
}
```

去重 TTL 默认 10 分钟。每次写入时顺手清理过期记录。

## 12. 权限与安全

- 不把飞书 token、secret、encrypt key 传入 agent 上下文。
- 日志中不要打印完整 access token。
- 群聊中只响应 @ 机器人，避免误触发。
- 可以增加 allowlist：

```env
FEISHU_ALLOWED_CHAT_IDS=
FEISHU_ALLOWED_OPEN_IDS=
```

- 可以增加敏感命令限制：飞书来源默认禁止高风险 shell / write_file，或使用更严格 sandbox。
- 对飞书消息做长度限制，防止超长输入撑爆上下文。

## 13. 错误处理

常见错误：

- 飞书 token 获取失败：启动时报错或 channel disabled。
- 权限不足：回复失败，日志记录飞书 API code。
- 消息类型不支持：忽略或提示“暂不支持该消息类型”。
- agent 执行超时：回复超时提示，session 保留。
- 飞书事件重试：dedupe 命中后忽略。

建议日志字段：

```text
event_id
message_id
chat_id
chat_type
sender_id
session_id
duration_ms
status
error_code
```

## 14. Markdown 与富文本

MVP 先纯文本回复。原因：

- Kraken final answer 是 Markdown。
- 飞书 text 消息能直接承载主要信息。
- Markdown 到飞书富文本/卡片转换需要处理代码块、列表、链接、图片和长度限制，适合作为第二阶段。

第二阶段转换规则：

- 标题、列表、粗体：转飞书 post 富文本。
- 代码块：保留等宽文本，必要时拆分。
- 链接：转飞书富文本链接。
- 图片：如果是本地图片，先上传飞书图片，再发送 image 或卡片。

## 15. 文件与图片扩展

后续支持：

- 用户发图片：下载到当前 workspace，例如 `.feishu-sessions/files/{message_id}/image.png`。
- 用户发文件：下载到 workspace，并把路径加入 agent 消息。
- agent 生成图片：通过飞书上传图片 API 发回。
- 飞书文档链接：通过飞书文档 API 或 web_fetch 读取内容。

第一阶段不做这些，避免权限和文件安全边界扩大。

## 16. 实现阶段

### Phase 1: 文本对话 MVP

- 添加 Feishu 配置。
- 添加长连接事件订阅。
- 支持文本私聊。
- 支持群聊 @ 机器人。
- session 映射。
- 幂等去重。
- 调用 `AgentService.run(...)`。
- 回复纯文本。
- 更新 README 和 `.env.example`。

### Phase 2: 体验完善

- “处理中...”即时反馈。
- 长回复拆分。
- Markdown 基础转换。
- 群聊按用户隔离配置。
- allowlist。
- 更完整日志。

### Phase 3: 多模态

- 图片输入。
- 文件输入。
- 图片输出。
- 飞书卡片。
- 飞书文档读取。

### Phase 4: 生产化

- Redis / database queue。
- 分布式 dedupe。
- 多实例协调。
- 管理后台展示 Feishu channel 状态。

## 17. 测试计划

本地测试：

- `FEISHU_ENABLED=false` 时，不影响现有 Web 前端。
- 配置缺失时给出明确错误。
- session-map 能正确创建和复用 session。
- dedupe 命中时不重复执行 agent。

飞书联调：

- 私聊发送 `hi`，机器人回复。
- 群聊直接发消息，不触发。
- 群聊 @ 机器人，触发。
- 重复投递同一 `message_id`，只回复一次。
- agent 报错时，飞书收到错误提示。

回归：

- Web 前端聊天仍正常。
- scheduler 仍正常。
- Files tab 和 workspace 图片渲染不受影响。

