# 飞书会话内 Session 切换方案

## 1. 背景

当前飞书通道的会话绑定是：

- 一个飞书 conversation key
- 映射到一个固定的 Kraken `sessionId`
- 存在 `.feishu-sessions/map.json`

这意味着：

- 同一个飞书私聊会持续复用同一个 Kraken session
- 同一个群聊或群聊用户作用域也会持续复用同一个 Kraken session

这个默认行为适合连续对话，但不适合用户在飞书里主动“开新话题”。

用户提出的目标是：

```text
当用户发送 /new_session 这类命令时，主动切换到一个新的 Kraken sessionId
```

这个需求本质上不是让 agent 自己决定切换，而是让 Feishu Channel 在进入 agent 之前，先执行一层“会话控制命令”。

## 2. 目标

- 支持用户在飞书对话中主动创建并切换到新 session
- 切换动作不进入 agent，不消耗模型调用
- 切换后后续消息自动写入新的 Kraken session
- 保留旧 session，不删除历史
- 支持明确反馈当前切换结果

## 3. 非目标

- 第一阶段不支持 agent 自己决定切换 session
- 第一阶段不支持跨用户随意绑定别人的 session
- 第一阶段不支持复杂的命令 DSL
- 第一阶段不做多实例分布式一致性保证

## 4. 推荐交互协议

第一阶段建议只支持一个明确命令：

```text
/new_session
```

可选扩展参数：

```text
/new_session 新话题标题
```

或：

```text
/new_session title=新话题标题
```

第一阶段建议优先采用最简单版本：

```text
/new_session
```

理由：

- 解析稳定
- 用户记忆成本低
- 不容易和自然语言混淆
- 很适合在飞书消息里直接输入

## 5. 行为定义

### 5.1 命令命中规则

只有当消息内容满足下面条件时，才视为控制命令：

- 去掉首尾空白后，以 `/new_session` 开头
- 整条消息只包含该命令，或后面只带少量参数文本

例如：

- `/new_session`
- `/new_session 产品需求讨论`

不建议把下面这种文本识别为命令：

- `请帮我执行 /new_session`
- `文档里写上 /new_session`

也就是说，命令匹配应当采用：

```text
line-level exact command
```

而不是全文模糊包含。

### 5.2 命令执行时机

执行顺序应当是：

1. Feishu 收到消息
2. 完成去重
3. 判断是否为会话控制命令
4. 如果是，直接在 Feishu service 层处理
5. 更新 session 映射
6. 回复用户“已切换到新会话”
7. 不再调用 `agentRunner.run(...)`

也就是说，这个逻辑应当发生在：

- `src/integrations/feishu/service.ts`
- 且在 `agentRunner.run(...)` 之前

## 6. 设计原则

### 6.1 Session 切换属于 Channel Control

`/new_session` 不应进入 agent。

原因：

- 它是通道级控制命令，不是业务问题
- 如果交给 agent，模型可能误解、忽略或输出不稳定
- 切 session 应该是确定性动作，不应该依赖模型推理

### 6.2 只修改映射，不修改旧 session 内容

执行 `/new_session` 时：

- 创建新的 Kraken session
- 更新当前 conversation key 对应的 `sessionId`
- 保留旧 session 文件

不应做：

- 清空旧 session
- 覆盖旧 session
- 复制旧 session 消息到新 session

### 6.3 切换应立即生效

一旦 `/new_session` 成功处理：

- 当前消息本身不进入 agent
- 下一条普通消息直接走新 session

## 7. 数据模型调整

当前 `.feishu-sessions/map.json` 结构大致是：

```json
{
  "feishu:p2p:ou_xxx": {
    "sessionId": "3869e817-d6c6-402c-ab06-e881441a2391",
    "createdAt": "2026-05-04T10:00:00.000Z",
    "updatedAt": "2026-05-04T10:20:00.000Z"
  }
}
```

第一阶段最小改法：

- 结构不变
- 仅在 `/new_session` 时替换 `sessionId`
- 同时刷新 `updatedAt`

例如：

```json
{
  "feishu:p2p:ou_xxx": {
    "sessionId": "9e8d8a63-1f12-46f0-a8c0-cd6f91c5308d",
    "createdAt": "2026-05-04T10:00:00.000Z",
    "updatedAt": "2026-05-04T11:05:00.000Z"
  }
}
```

这里的 `createdAt` 建议保留“首次建立绑定时间”，而不是每次切换都改。

### 7.1 推荐扩展结构

如果希望后续支持“回切旧 session”或“查看最近 session”，建议升级为：

```json
{
  "feishu:p2p:ou_xxx": {
    "sessionId": "9e8d8a63-1f12-46f0-a8c0-cd6f91c5308d",
    "createdAt": "2026-05-04T10:00:00.000Z",
    "updatedAt": "2026-05-04T11:05:00.000Z",
    "previousSessionIds": [
      "3869e817-d6c6-402c-ab06-e881441a2391"
    ]
  }
}
```

第一阶段这个字段不是必须，但建议在文档层面保留扩展位。

## 8. 服务端处理流程

建议新增一个通道内命令处理函数，例如：

```text
handleConversationControlCommand(message, conversationKey)
```

职责：

1. 判断是否为 `/new_session`
2. 如果不是，返回 `not_handled`
3. 如果是：
   - 创建新 session
   - 更新 `.feishu-sessions/map.json`
   - 回复确认消息
   - 返回 `handled`

### 8.1 伪流程

```text
handleMessage(message):
  normalize content
  dedupe

  conversationKey = buildConversationKey(...)

  if isSessionControlCommand(content):
    handled = handleSessionControlCommand(...)
    if handled:
      return

  binding = ensureSessionBinding(conversationKey, ...)
  run agent normally
```

### 8.2 新 session 的创建方式

建议复用现有：

- `sessionStore.createSession(...)`
- `sessionStore.saveSession(...)`

创建参数建议：

- `title`: 优先使用命令附带标题，否则使用固定值
- `systemPrompt`: 仍使用 Feishu 默认 system prompt
- `model`: 使用当前默认模型

建议默认标题：

```text
Feishu new session
```

或者：

```text
New Feishu session
```

如果用户提供 `/new_session 产品讨论`，则标题可写为：

```text
产品讨论
```

## 9. 回复文案设计

命令成功后，Feishu 应直接回复一条确认消息。

建议文案：

```text
已创建并切换到新会话。
session_id: 9e8d8a63-1f12-46f0-a8c0-cd6f91c5308d
后续消息将进入这个新会话。
```

如果不希望暴露完整 UUID，可以简化为：

```text
已切换到新会话，后续消息将使用新的上下文。
```

但从调试和可观测性角度，建议保留 `session_id`，至少在第一阶段保留。

## 10. 错误处理

### 10.1 创建 session 失败

返回：

```text
创建新会话失败，请稍后重试。
```

并记录日志：

- conversation key
- message id
- sender id
- error stack

### 10.2 map.json 写入失败

这类失败必须视为命令失败，不能只创建 session 不更新映射，否则用户以为已切换，实际仍会写入旧 session。

处理原则：

- 如果 session 已创建但 map 写入失败：
  - 记录错误
  - 回复用户失败
  - 不切换 active mapping

第一阶段可接受“残留一个未绑定的 session 文件”，因为它不会污染旧会话。

## 11. 并发与幂等

### 11.1 幂等

同一条飞书消息仍然依赖现有：

- `messageId`
- `eventId`
- dedupe store

这样 `/new_session` 被飞书重试时，不会创建多个 session。

### 11.2 顺序问题

如果用户极短时间连续发送：

```text
/new_session
你好
```

当前 Feishu service 已有单通道 queue，通常能保证顺序处理。

因此只要 `/new_session` 在同一 conversation key 上先完成，下一条消息就会自动进入新 session。

## 12. 安全边界

### 12.1 只允许操作当前 conversation key

`/new_session` 只能切换当前飞书会话绑定，不允许指定别人的 `conversationKey`。

### 12.2 不允许用户自定义任意 sessionId

第一阶段不建议支持：

```text
/switch_session some-session-id
```

原因：

- 用户可能切到不属于当前上下文的 session
- 容易导致跨会话串话
- 需要额外鉴权和可见性约束

第一阶段只支持：

```text
系统创建一个新的 sessionId，并切换过去
```

## 13. 推荐后续扩展

在 `/new_session` 稳定后，可以继续扩展：

### 13.1 `/current_session`

查看当前飞书 conversation 绑定的 sessionId：

```text
/current_session
```

返回：

```text
当前会话 session_id: 9e8d8a63-1f12-46f0-a8c0-cd6f91c5308d
```

### 13.2 `/recent_sessions`

查看最近切换过的几个 session。

### 13.3 `/switch_session <id>`

显式切回某个历史 session。

这个功能必须建立在：

- 保存 `previousSessionIds`
- 做可见性校验
- 只允许切换到当前 conversation key 历史里出现过的 session

### 13.4 `/reset_session`

如果后续不想新建 session 文件，只想清空上下文，也可以单独设计：

```text
/reset_session
```

但这和 `/new_session` 语义不同，不建议第一阶段混在一起。

## 14. 推荐实现顺序

第一阶段按下面顺序做：

1. 支持 `/new_session`
2. 在 `service.ts` 中做命令拦截
3. 复用 `sessionStore.createSession(...)`
4. 更新 `session-map.ts`
5. 回复确认消息
6. 补一条日志，记录旧 `sessionId` 和新 `sessionId`

第二阶段再做：

1. `/current_session`
2. `previousSessionIds`
3. `/switch_session <id>`

## 15. 最终建议

你的想法是对的，而且这是最稳的方案：

- 不让 agent 自己理解“换 session”
- 直接把 `/new_session` 作为 Feishu Channel 控制命令
- 在进入 agent 前完成切换

这样改动范围小、行为确定、调试简单，也和当前 `.feishu-sessions/map.json` 的结构相容。

第一阶段结论：

```text
推荐把 /new_session 设计为 Feishu 通道内建命令。
命中后直接创建新 Kraken session，并把当前 conversation key 的绑定切到新的 sessionId。
该命令不进入 agent，不消耗模型调用。
```
