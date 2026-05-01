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
FEISHU_INCLUDE_MESSAGE_META=true

# quasi-streaming for Feishu replies
FEISHU_STREAMING_ENABLED=false
FEISHU_STREAMING_MODE=update
FEISHU_STREAMING_FLUSH_INTERVAL_MS=1500
FEISHU_STREAMING_MIN_DELTA_CHARS=80
FEISHU_STREAMING_MAX_UPDATES=20
```

配置说明：

- `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 用于获取 tenant access token。
- `FEISHU_VERIFICATION_TOKEN` 用于 HTTP Callback 事件校验。
- `FEISHU_ENCRYPT_KEY` 用于飞书事件加密解密，第一阶段可先不启用加密。
- `FEISHU_SESSION_MODE=chat` 时，群聊所有人共享上下文。
- `FEISHU_SESSION_MODE=user` 时，群聊里每个用户独立上下文。
- `FEISHU_INCLUDE_MESSAGE_META=true` 时，会把经过筛选的飞书消息元信息传给 agent，便于 agent 理解消息来源和引用关系。
- `FEISHU_STREAMING_ENABLED=true` 时，启用飞书准流式回复。默认建议先关闭，MVP 稳定后再开启。
- `FEISHU_STREAMING_MODE=update` 时，先发送一条占位消息，再定时编辑同一条机器人消息。
- `FEISHU_STREAMING_FLUSH_INTERVAL_MS` 控制最短更新间隔，避免触发飞书接口频控。
- `FEISHU_STREAMING_MAX_UPDATES` 控制单条回复最多编辑次数，超过后只在最终完成时更新一次。

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

建议给消息加少量来源上下文和安全筛选后的 meta 信息：

```text
[Feishu message]
message_id: om_xxx
event_id: ev_xxx
chat_type: group
chat_id: oc_xxx
sender_id: ou_xxx
sender_name: 张三
thread_id: omt_xxx
create_time: 2026-05-01T09:30:00.000Z

用户原文...
```

注意：不要把飞书 access token、app secret 等敏感信息写入 agent 上下文。

### 9.4 消息 meta 设计

飞书来源的消息建议保留两层信息：

1. 传给 agent 的可见 meta：帮助 agent 理解消息上下文。
2. 存在 session record 里的内部 meta：帮助系统做回复、审计、幂等和排障。

建议新增本地结构：

```ts
interface FeishuMessageMeta {
  provider: 'feishu'
  eventId?: string
  messageId: string
  rootMessageId?: string
  parentMessageId?: string
  threadId?: string
  chatId: string
  chatType: 'p2p' | 'group'
  senderId: string
  senderType?: 'user' | 'app'
  senderName?: string
  messageType: string
  createTime?: string
  conversationKey: string
  mentionBot: boolean
}
```

传给 agent 的 meta 字段建议保持最小化：

- `message_id`
- `event_id`
- `chat_type`
- `chat_id`
- `sender_id`
- `sender_name`
- `thread_id`
- `create_time`

不传给 agent 的字段：

- `tenant_access_token`
- `app_secret`
- `verification_token`
- `encrypt_key`
- 原始飞书 HTTP headers
- 未脱敏的手机号、邮箱等用户 profile 扩展字段

### 9.5 Agent 消息包装格式

为了让 agent 可以稳定识别外部来源，adapter 不应该只拼一句自然语言。建议统一生成如下文本：

```text
<external_message provider="feishu">
message_id: om_xxx
event_id: ev_xxx
chat_type: group
chat_id: oc_xxx
sender_id: ou_xxx
sender_name: 张三
thread_id: omt_xxx
create_time: 2026-05-01T09:30:00.000Z
</external_message>

用户消息正文...
```

实现时仍然作为普通 `message: string` 传给 `agentService.run(...)`，这样不需要第一阶段改 agent message schema。后续如果要让 UI 或上下文压缩更精确，可以再把 `SessionMessageRecord` 扩展出 `meta` 字段。

### 9.6 Session message meta 扩展建议

当前 `SessionMessageRecord` 只有：

```ts
interface SessionMessageRecord {
  id: string
  role: 'user' | 'assistant'
  content: SessionMessageContent
  createdAt: string
}
```

为了保留外部通道信息，建议扩展为：

```ts
interface SessionMessageRecord {
  id: string
  role: 'user' | 'assistant'
  content: SessionMessageContent
  createdAt: string
  meta?: {
    source?: 'web' | 'feishu' | 'scheduler'
    feishu?: FeishuMessageMeta
  }
}
```

第一阶段可以先不改历史压缩逻辑，只在保存 session 时保留 meta。压缩时仍只压缩 `role/content`，但摘要内容里已经有外部消息 wrapper，所以 agent 不会丢失关键来源信息。

后续可以优化：

- context 压缩时保留最近消息的 `meta`。
- 前端 message bubble 展示来源标签。
- Files/Session 详情里显示外部 message id。
- 出错时通过 `message_id` 快速定位飞书原消息。

### 9.7 message_id 的用途

`message_id` 至少用于四件事：

- 回复：`reply message` API 需要用原始 `message_id`。
- 幂等：飞书重试时同一 `message_id` 不重复执行 agent。
- 审计：session message 可以追溯到飞书原消息。
- 文件目录：后续下载图片/文件时，可以存到 `.feishu-sessions/files/{message_id}/`。

推荐规则：

```text
dedupe key = message_id || event_id
reply target = message_id
session user message meta.feishu.messageId = message_id
file bucket = .feishu-sessions/files/{message_id}/
```

### 9.8 回复飞书

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

### 10.1 飞书准流式回复

飞书消息通道不等价于 WebSocket，不能像 Web 前端一样把 token 逐个推给用户。推荐实现“准流式”：

```text
receive event
  -> enqueue background task
  -> send/reply placeholder message: "处理中..."
  -> run agent with emit callback
  -> aggregate assistant deltas into buffer
  -> update the same Feishu bot message every N ms
  -> final update with complete answer
```

默认策略：

- 不发送多条增量消息，避免群聊刷屏。
- 优先编辑同一条机器人自己发出的消息。
- 只在内容变化足够大时更新，例如新增超过 `FEISHU_STREAMING_MIN_DELTA_CHARS`。
- 更新间隔不低于 `FEISHU_STREAMING_FLUSH_INTERVAL_MS`。
- 超过 `FEISHU_STREAMING_MAX_UPDATES` 后停止中间更新，只保留最终更新。
- 如果飞书更新消息接口失败，降级为“处理中...” + 最终回复。

### 10.2 Streaming 状态机

建议给每个飞书后台任务维护一个 `FeishuReplyStreamState`：

```ts
interface FeishuReplyStreamState {
  enabled: boolean
  mode: 'update' | 'none'
  sourceMessageId: string
  placeholderMessageId?: string
  buffer: string
  lastFlushedText: string
  lastFlushAt: number
  updateCount: number
  closed: boolean
}
```

执行流程：

1. 收到飞书消息后，后台任务先调用回复或发送接口生成占位消息。
2. 记录占位消息返回的 `message_id` 为 `placeholderMessageId`。
3. 调用 `agentService.run(...)` 时传入 `emit` 回调。
4. 在 `emit` 中监听 `assistant:delta`，把文本追加或覆盖到 `buffer`。
5. 定时 flush：把 `buffer` 转成飞书可接受的文本/富文本，然后更新 `placeholderMessageId`。
6. agent 完成后，强制最后 flush 一次完整 `result.reply`。
7. agent 失败时，把占位消息更新为失败提示。

伪代码：

```ts
const stream = await feishuReplyStream.createPlaceholder(sourceMessageId)

const result = await agentService.run(input, (event, data) => {
  if (event !== 'assistant:delta') return
  stream.appendDelta(data)
  void stream.flushIfNeeded()
})

await stream.close(result.reply)
```

### 10.3 更新消息 API 兼容策略

飞书存在多种“更新消息”能力，不同消息类型和 SDK 版本支持范围不同。实现时不要把准流式绑定死在某一种消息格式上。

推荐顺序：

1. 优先使用普通消息编辑能力更新机器人自己发送的文本消息。
2. 如果文本消息编辑不满足当前飞书租户/API 能力，改用可更新的消息卡片。
3. 如果更新接口返回权限、类型或次数限制错误，降级为最终一次回复。

封装接口建议：

```ts
interface FeishuClient {
  replyText(sourceMessageId: string, text: string): Promise<{ messageId: string }>
  sendText(chatId: string, text: string): Promise<{ messageId: string }>
  updateText(messageId: string, text: string): Promise<void>
  updateCard?(messageId: string, card: unknown): Promise<void>
}
```

`FeishuReplyStream` 不直接依赖飞书 SDK 细节，只依赖这个 client interface。

### 10.4 与 Agent Runtime 的关系

准流式只消费 agent runtime 已经发出的事件，不要求 agent 直接知道飞书。

```text
agent emit assistant:delta
  -> FeishuReplyStream buffer
  -> timed update message
```

agent 最终仍只返回 `result.reply`。即使中间 streaming 全部失败，也必须保证最终回复路径可用。

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
- 准流式回复：通过编辑同一条机器人消息更新内容。
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
- `FEISHU_STREAMING_ENABLED=true` 时，先出现占位消息，随后同一条消息被更新为部分内容和最终内容。
- 更新消息接口失败时，不重复刷屏，最终回复仍可送达。
- agent 报错时，飞书收到错误提示。

回归：

- Web 前端聊天仍正常。
- scheduler 仍正常。
- Files tab 和 workspace 图片渲染不受影响。
