# Kraken 每日新闻摘要推送方案

## 1. 目标

目标是在 Kraken 内实现一条稳定的自动化链路：

```text
每天早上定时触发
  -> 激活新闻摘要 skill
  -> 抓取各大媒体最近一段时间的新闻
  -> 去重、筛选、排序
  -> 生成不超过 20 条的中文新闻摘要
  -> 推送到指定飞书会话
```

其中首批新闻源至少包含：

- 36氪
- 其他中文科技/商业媒体

这项能力的实现原则是：

- 主要通过 `skill` 定义工作流
- 通过增强后的 `scheduler` 做稳定触发
- 保留执行记录，便于审计和补跑

## 2. 推荐路线

这项需求不应实现成一个“裸 prompt + 定时发送”的临时脚本，而应采用：

```text
Enhanced Scheduler
  -> Agent Run
  -> Activate news-digest-feishu skill
  -> Search / Fetch / Browser / Shell workflows
  -> Summarize
  -> Deliver to Feishu
  -> Persist execution history
```

一句话：

> 让 skill 定义“怎么做日报”，让 scheduler 负责“什么时候稳定地做”。

## 3. 为什么要同时用 skill 和增强 scheduler

### 3.1 skill 负责流程知识

skill 更适合承载：

- 新闻源选择策略
- 搜索关键词和抓取顺序
- 去重与筛选原则
- 输出格式约束
- 飞书发送操作规范

这些属于“工作流知识”和“领域约束”，不应该散落在某个长 prompt 或 UI 表单里。

### 3.2 scheduler 负责稳定触发

日报是强时间语义任务，核心要求是：

- 每天固定时间执行
- 重启后不丢任务
- 失败后可追踪
- 可以查看历史执行

这些都不是 skill 能解决的，而是 scheduler 必须负责的基础设施能力。

## 4. 当前仓库现状

### 4.1 已有 skill 基础

当前仓库已经有：

- skill registry
- session 级 `loadedSkills`
- `skill` / `skill_install` 工具
- scheduler job 上可配置 `loadedSkills`

相关位置：

- [`docs/skill-system.md`](/Users/bill/code/kraken-server/docs/skill-system.md)
- [`src/tools/skill.ts`](/Users/bill/code/kraken-server/src/tools/skill.ts)
- [`src/runtime/agent-service.ts`](/Users/bill/code/kraken-server/src/runtime/agent-service.ts)
- [`src/scheduler/service.ts`](/Users/bill/code/kraken-server/src/scheduler/service.ts)

这意味着：

- 可以把“新闻摘要日报”做成一个专门的 skill
- scheduler 触发的 job 可以预装这个 skill

### 4.2 已有 scheduler 基础

当前 scheduler 已具备：

- job 持久化
- execution 记录
- `once`
- `interval`
- 手动运行
- `loadedSkills`
- `sessionTemplateId`

相关位置：

- [`src/scheduler/types.ts`](/Users/bill/code/kraken-server/src/scheduler/types.ts)
- [`src/scheduler/planner.ts`](/Users/bill/code/kraken-server/src/scheduler/planner.ts)
- [`src/scheduler/service.ts`](/Users/bill/code/kraken-server/src/scheduler/service.ts)

### 4.3 当前限制

当前还不够支撑“每日早报”稳定落地的点主要有：

1. `schedule` 只支持 `once` / `interval`
2. 还不支持 `cron + timezone`
3. scheduler 当前倾向复用固定 `targetSessionId`
4. 缺少 job 级“每次执行新建 session”的显式语义
5. 还没有面向日报场景的参数化任务上下文

结论：

- skill 已经够做“流程定义”
- scheduler 还需要增强，尤其是日报场景最关键的时间表达和执行语义

## 5. 这项能力的推荐架构

推荐分成三层：

### 5.1 Scheduler Layer

负责：

- 每天早上固定时间触发
- 持久化 job
- 记录 execution
- 恢复中断任务

### 5.2 Skill Layer

新增一个专用 skill，例如：

```text
skills/news-digest-feishu/
```

这个 skill 负责：

- 选择新闻源
- 规定抓取顺序
- 规定去重和筛选规则
- 规定摘要格式
- 规定飞书发送方式

### 5.3 Tool Layer

skill 在执行时复用现有工具：

- `search`
- `web_fetch`
- `agent_browser`
- `shell_command`
- `skill`

必要时再复用或补充：

- 飞书发送相关脚本或 skill

## 6. 推荐新增的 skill

建议新增：

```text
skills/news-digest-feishu/
├── SKILL.md
├── references/
│   ├── sources.md
│   ├── output-format.md
│   └── feishu-delivery.md
└── scripts/
    └── optional helpers
```

### 6.1 这个 skill 应该做什么

`news-digest-feishu` skill 的职责不是“自己实现一个独立 runtime”，而是告诉 Agent：

1. 先抓哪些源
2. 优先用哪些工具
3. 如何限制抓取时间窗口
4. 如何去重
5. 如何把结果压缩到 20 条以内
6. 如何发送到飞书
7. 哪些情况算失败，应该让 scheduler 记录失败

### 6.2 skill 里应该包含的规则

建议在 skill 里固定这些约束：

- 报告时间窗口默认是“上次成功执行到本次执行”
- 单源抓取数上限
- 最终条数不超过 20
- 每条必须带来源和链接
- 优先总结中文科技/商业新闻
- 遇到重复报道要合并
- 没有足够有效新闻时，允许输出少于 20 条

### 6.3 skill 的工作流建议

skill 内建议明确：

1. 先读取来源清单
2. 先用 `search` 找当天候选入口
3. 对关键页面用 `web_fetch`
4. 静态抓不到时再考虑 `agent_browser`
5. 先做人工可解释的去重和筛选
6. 最后生成日报
7. 最后一步发送到飞书

## 7. scheduler 需要增强的能力

这部分是这项需求的关键，不建议再回避。

### 7.1 支持 `cron`

日报场景的标准表达应该是：

```ts
{
  type: 'cron',
  expression: '30 8 * * *',
  timezone: 'Asia/Shanghai'
}
```

这比 `interval=24h` 更合理，因为：

- 服务重启不会把时间漂移到别的时刻
- “每天早上 8:30”是业务语义，不是纯间隔语义
- 更适合以后扩展周报、工作日任务

### 7.2 支持 `timezone`

日报推送是典型的本地时间语义任务。

例如用户说“每天早上”，这里实际上指的是：

- `Asia/Shanghai` 的早上

而不是：

- 进程所在机器的系统时区
- UTC 自然日

所以 scheduler 应支持：

- job 级 `timezone`
- 计算 `nextRunAt` 时按该时区推算

### 7.3 支持 `createNewSession`

日报任务不应长期复用同一个 session。

建议 job 模型明确支持：

```ts
createNewSession?: boolean
```

对日报任务应默认：

```ts
createNewSession = true
```

原因：

- 避免上下文无限累积
- 避免昨天的摘要污染今天的总结
- execution 和输出结果更容易一一对应

### 7.4 支持 job 级 `loadedSkills`

这部分当前已经有基础，但应该作为 scheduler 的正式能力明确下来。

日报任务至少应支持：

- 固定预装 `news-digest-feishu`
- 可选预装 `feishu-message-media`

这样每次执行不依赖会话里是否刚好手工激活过 skill。

### 7.5 支持 job 级参数化上下文

日报任务往往有稳定参数，例如：

- 推送目标 chat_id
- 最大新闻条数
- 新闻源集合
- 抓取窗口
- 输出风格

如果全部写死在 `message` 里，会很脆弱。

建议 job 模型增加一层轻量参数，例如：

```ts
params?: Record<string, string | number | boolean>
```

日报场景可用：

```json
{
  "targetChatId": "oc_xxx",
  "maxItems": 20,
  "sourceSet": "cn-tech-default",
  "timezone": "Asia/Shanghai"
}
```

这些参数可以在运行时拼进 message 或 system prompt suffix。

### 7.6 支持 catchup 策略

日报任务要考虑服务停机恢复。

建议增加：

```ts
catchupPolicy?: 'none' | 'latest'
```

日报推荐默认：

- `latest`

语义：

- 如果早上错过一次，不把停机期间所有 missed runs 全补一遍
- 只补最近一次日报

### 7.7 支持 retry 但要保守

日报失败后适合自动重试，但不应无限重试。

建议：

```ts
retryPolicy?: {
  maxAttempts: number
  backoffMs: number
}
```

日报建议默认：

- `maxAttempts = 2`
- `backoffMs = 300000`

## 8. 推荐的 job 模型

建议调度模型至少演进到：

```ts
type ScheduledJobSchedule =
  | { type: 'once'; runAt: string }
  | { type: 'interval'; everyMs: number }
  | { type: 'cron'; expression: string; timezone?: string }

interface ScheduledJob {
  id: string
  name: string
  enabled: boolean
  message: string
  schedule: ScheduledJobSchedule
  sessionTemplateId?: string
  model?: string
  systemPrompt?: string
  sandbox?: SessionSandboxConfig
  loadedSkills?: string[]
  createNewSession?: boolean
  params?: Record<string, string | number | boolean>
  overlapPolicy?: 'skip' | 'parallel'
  catchupPolicy?: 'none' | 'latest'
  retryPolicy?: {
    maxAttempts: number
    backoffMs: number
  }
  nextRunAt: string | null
  lastRunAt?: string | null
  lastSuccessAt?: string | null
  lastFailureAt?: string | null
  createdAt: string
  updatedAt: string
}
```

## 9. 日报任务的推荐定义

日报 job 推荐长这样：

```json
{
  "name": "Daily Feishu News Digest",
  "enabled": true,
  "message": "Activate the news-digest-feishu skill, collect important tech and business news from the configured Chinese media sources for the current reporting window, dedupe and rank them, generate a Chinese digest with no more than 20 items, and send the final digest to the configured Feishu chat.",
  "schedule": {
    "type": "cron",
    "expression": "30 8 * * *",
    "timezone": "Asia/Shanghai"
  },
  "loadedSkills": [
    "news-digest-feishu",
    "feishu-message-media"
  ],
  "createNewSession": true,
  "params": {
    "targetChatId": "oc_xxx",
    "maxItems": 20,
    "sourceSet": "cn-tech-default",
    "timezone": "Asia/Shanghai"
  },
  "overlapPolicy": "skip",
  "catchupPolicy": "latest",
  "retryPolicy": {
    "maxAttempts": 2,
    "backoffMs": 300000
  }
}
```

## 10. 新闻源策略

### 10.1 原则

优先级建议：

1. 官方 RSS
2. 官方开放 API
3. 稳定 HTML 列表页
4. 搜索引擎辅助发现入口

### 10.2 首批建议来源类别

- 创投与科技媒体：36氪、虎嗅
- 财经商业媒体：界面、财联社
- 国际科技媒体：TechCrunch 等

### 10.3 抓取窗口

推荐日报窗口为：

```text
上次成功执行时间 -> 本次执行时间
```

如果没有历史成功记录，则回退到：

```text
过去 24 小时
```

## 11. 摘要输出约束

日报输出建议严格限制为：

- 总条数不超过 20
- 每条 2 到 4 句
- 每条带来源
- 每条带链接
- 不补充输入之外的事实

推荐结构：

```markdown
# 今日新闻摘要

## 总览
- 3 到 5 条主题级总览

## 详细条目
1. 标题
   来源：36氪
   时间：2026-05-07 07:40
   摘要：...
   影响：...
   链接：...
```

## 12. 飞书发送设计

这项能力仍建议以“固定群聊 chat_id 推送”为第一目标。

原因：

- 语义最清晰
- 不依赖用户临时触发
- 最适合作为日报订阅出口

如果后续做个人订阅，再扩展到用户级映射。

## 13. 存储与审计

建议为每次日报执行保留：

- 原始候选来源列表
- 去重后结果
- 最终入模内容
- 模型输出文本
- 飞书发送记录

建议目录：

```text
.news-digest/
└── runs/
    └── <executionId>/
        ├── raw.json
        ├── selected.json
        ├── digest.md
        └── delivery.json
```

这里可以和 scheduler 的 execution id 对齐。

## 14. 分阶段实施建议

### Phase 1

- 增强 scheduler，支持 `cron + timezone`
- 增强 scheduler，支持 `createNewSession`
- 增强 scheduler，支持 job 级 `params`
- 新建 `news-digest-feishu` skill
- 先人工创建日报 job

### Phase 2

- 补 catchup / retry 细节
- 补前端 scheduler 表单对 `cron` 的支持
- 补日报执行审计物持久化

### Phase 3

- 更丰富的新闻源集合
- 个性化订阅
- 多个飞书目标
- 主题化日报

## 15. 验收标准

满足下面条件即可视为 MVP 可用：

1. 可以定义一个每天早上固定时刻执行的 job。
2. 该 job 可以预装 `news-digest-feishu` skill。
3. 每次执行都会新建独立 session。
4. 最终输出新闻摘要不超过 20 条。
5. 每条摘要包含来源和链接。
6. 可以稳定推送到一个固定飞书 chat。
7. 可以查看 execution 历史和失败记录。

## 16. 结论

这项需求最合理的路线不是“只靠 scheduler”，也不是“只靠 skill”，而是：

> 用 skill 定义日报工作流，用增强后的 scheduler 提供固定时间、稳定执行和历史审计能力。

对 Kraken 来说，这条路线最贴近现有架构，也最容易长期维护。
