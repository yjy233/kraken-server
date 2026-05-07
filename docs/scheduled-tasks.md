# Kraken 定时任务方案

## 1. 目标

为 `kraken-server` 增加一套可持久化、可审计、可与现有 sandbox / agent runtime 复用的定时任务系统。

第一阶段目标不是做分布式任务平台，而是满足下面这些真实需求：

- 用户配置一个定时任务，到点后自动触发一次 agent 执行
- 每次触发都创建一个新的 session，而不是复用旧 session
- 每次执行都能复用预设的 sandbox、system prompt、model、skills
- 执行结果可追踪，可查看历史，可失败重试
- 服务重启后任务不会丢
- 尽量少改现有架构，不先引入 Redis / MQ / 外部 worker

## 2. 为什么这个仓库适合先做内置 scheduler

当前仓库已经具备这几个关键条件：

1. 有稳定的 agent 执行入口
   - [`src/server.ts`](/Users/bill/code/kraken-server/src/server.ts)
   - 核心入口是 `runAgentRequest(...)`

2. 有 session 持久化能力
   - 当前保存在 `.sessions/<sessionId>.json`

3. 有可复用的 session 级 sandbox 配置
   - `workspaceRoot`
   - `readRoots`

4. 有统一的运行记录和 SSE 事件模型
   - `run:start`
   - `run:step`
   - `tool:requested`
   - `tool:running`
   - `tool:result`

因此，最务实的方案是：

- 在服务端内置一个调度器
- 用文件持久化任务与执行记录
- 到点后直接调用现有 agent 执行逻辑

而不是现在就拆成：

- 独立 worker
- 队列系统
- 分布式调度服务

那样会明显超过当前仓库复杂度。

## 3. 推荐方案概览

推荐 Phase 1 采用：

- 单进程内置 scheduler
- JSON 文件持久化
- 轮询扫描 + nextRunAt 调度
- 同进程内执行 agent 任务
- 每个 job 运行时生成独立 execution 记录
- 默认串行或小并发执行

一句话：

> 先把“可靠触发 + 持久化 + 历史可查 + 可恢复”做对，再考虑分布式和高并发。

## 4. 能力边界

### 4.1 第一阶段支持

- 一次性任务
- 间隔任务
- cron 表达式任务
- 指定 session 模板执行
- 指定 prompt/message 执行
- 可启停
- 可手动立即执行
- 保留执行历史
- 失败重试
- 服务重启恢复

### 4.2 第一阶段不做

- 多实例分布式一致性调度
- 秒级高精度调度保证
- DAG / 工作流编排
- 外部 webhook 触发器
- 复杂依赖队列
- 优先级抢占
- 多租户隔离体系

## 5. 核心设计原则

### 5.1 每次执行创建新 session

定时任务不应把历史持续追加到同一个 session。

推荐模型是：

- job 保存一份“执行模板”
- 每次触发时，基于模板创建一个新的 session
- execution 记录明确指向这次新建的 session

模板中可以包含：

- `sessionTemplateId`
- `systemPrompt`
- `model`
- `sandbox`
- `loadedSkills`

这样好处更明确：

- 历史隔离
- 不会无限膨胀旧 session
- 每次执行上下文一致
- execution 和 session 的对应关系更清晰

### 5.2 调度与执行解耦

需要区分两类对象：

- `ScheduledJob`
  - 用户定义的计划
- `ScheduledExecution`
  - 某一次真实运行记录

不要把“任务定义”和“执行历史”混在一个 JSON 里。

### 5.3 nextRunAt 是主索引

第一阶段不需要复杂时间轮。

只要每个 job 维护：

- `enabled`
- `schedule`
- `nextRunAt`

调度器每隔几秒扫描一次，捞出 `nextRunAt <= now` 的任务执行即可。

### 5.4 幂等和互斥比功能更多更重要

定时任务系统最怕：

- 多次重复触发
- 崩溃后状态不一致
- 长任务重叠执行

所以要先定义：

- 是否允许并发执行同一个 job
- 是否允许跳过 overlap
- 崩溃恢复怎么处理

## 6. 推荐目录结构

建议新增：

```text
.scheduled-jobs/
├── jobs/
│   └── <jobId>.json
├── executions/
│   └── <executionId>.json
└── scheduler-state.json
```

对应源码建议：

```text
src/scheduler/
├── types.ts
├── store.ts
├── cron.ts
├── planner.ts
├── runner.ts
├── service.ts
└── lock.ts
```

职责建议：

- `types.ts`
  - 类型定义
- `store.ts`
  - 读写 job / execution JSON
- `cron.ts`
  - cron 解析与下次触发时间计算
- `planner.ts`
  - 根据 schedule 计算 `nextRunAt`
- `runner.ts`
  - 真正执行一次 job
- `service.ts`
  - 后台调度循环
- `lock.ts`
  - 进程级/文件级互斥

## 7. 数据模型

### 7.1 Job 定义

建议：

```ts
type JobSchedule =
  | { type: 'once'; runAt: string }
  | { type: 'interval'; everyMs: number }
  | { type: 'cron'; expression: string; timezone?: string }

interface ScheduledJob {
  id: string
  name: string
  enabled: boolean
  sessionTemplateId?: string
  model?: string
  systemPrompt?: string
  sandbox?: SessionSandboxConfig
  loadedSkills?: string[]
  message: string
  schedule: JobSchedule
  nextRunAt: string | null
  lastRunAt?: string
  lastSuccessAt?: string
  lastFailureAt?: string
  retryPolicy?: {
    maxAttempts: number
    backoffMs: number
  }
  overlapPolicy?: 'skip' | 'queue' | 'parallel'
  createdAt: string
  updatedAt: string
}
```

说明：

- `message` 是最核心的任务输入
- `sessionTemplateId` 是可选模板来源
- `systemPrompt/model/sandbox/loadedSkills` 是执行模板的一部分
- `nextRunAt` 持久化保存，避免每次重启都重新推算不一致

### 7.2 Execution 记录

建议：

```ts
interface ScheduledExecution {
  id: string
  jobId: string
  sessionId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  triggerType: 'schedule' | 'manual' | 'retry' | 'catchup'
  startedAt?: string
  finishedAt?: string
  attempt: number
  error?: string
  result?: {
    reply: string
    runId: string
    toolExecutionCount: number
  }
  createdAt: string
  updatedAt: string
}
```

### 7.3 为什么不用把历史塞进 job 文件

因为执行历史会膨胀很快：

- 每天一次，一年 365 条
- 每小时一次，一周就 168 条

拆成独立 execution 文件更适合：

- 单独查询
- 单独裁剪
- 不会导致 job 文件频繁变大

## 8. 调度模型

### 8.1 Service 生命周期

服务启动时：

1. 初始化 scheduler store 目录
2. 读取全部 job
3. 恢复“running 中断”的 execution
4. 启动轮询 loop

轮询 loop 每 `N` 秒执行一次：

1. 读取到期 jobs
2. 过滤 disabled
3. 根据 overlapPolicy 决定是否执行
4. 创建 execution 记录
5. 调 `runner.runJob(job)`
6. 回写 execution 状态和 job 的 `last*` / `nextRunAt`

### 8.2 推荐轮询周期

建议：

- `SCHEDULER_POLL_INTERVAL_MS=5000`

不需要更激进。

原因：

- 当前系统不是高频交易
- 文件存储 + 单进程模型下，5 秒足够
- 可以接受轻微触发延迟

### 8.3 overlapPolicy

推荐默认：

- `skip`

含义：

- 如果一个 job 上一轮还没跑完，新一轮到点时跳过

这是第一阶段最安全的默认值。

其他策略：

- `queue`
  - 记一次待执行，当前完成后立刻补跑
- `parallel`
  - 允许重叠执行

第一阶段可以只实现：

- `skip`
- `parallel`

`queue` 可以后补。

## 9. 调度表达式支持建议

### 9.1 三种 schedule

#### A. `once`

```json
{ "type": "once", "runAt": "2026-04-27T09:00:00+08:00" }
```

适合：

- 明天早上提醒跑一次
- 某个定点执行一次分析

#### B. `interval`

```json
{ "type": "interval", "everyMs": 3600000 }
```

适合：

- 每小时跑一次
- 每 10 分钟扫一次

#### C. `cron`

```json
{ "type": "cron", "expression": "0 9 * * *", "timezone": "Asia/Shanghai" }
```

适合：

- 每天早上 9 点
- 每周一 10 点

### 9.2 cron 实现建议

不要自己手写 cron 解析器。

建议直接引入成熟库，例如：

- `cron-parser`

理由：

- 表达式边界多
- 时区和 DST 容易写错
- 自己写没有收益

## 10. 任务执行如何复用现有 agent

### 10.1 最重要的结论

不要让 scheduler 自己拼一套新的执行逻辑。

应把当前：

- session 创建/读取
- sandbox policy
- tool registry
- skill state
- agent.run(...)

抽成一个可复用的 service 层。

### 10.2 现状问题

当前 `runAgentRequest(...)` 在 [`src/server.ts`](/Users/bill/code/kraken-server/src/server.ts) 内部，是 HTTP handler 的内部函数。

这会让 scheduler 复用不方便。

建议重构为：

```text
src/runtime/agent-request.ts
```

导出：

```ts
interface AgentRunInput {
  message: string
  createNewSession?: boolean
  sessionTemplateId?: string | null
  model?: string
  systemPrompt?: string
  sandbox?: SessionSandboxConfig
  loadedSkills?: string[]
  trigger?: 'user' | 'schedule' | 'manual'
}

async function runAgentRequest(input: AgentRunInput, emit?: EmitFn | null): Promise<...>
```

这样：

- `/api/chat`
  可以调它
- `/api/chat/stream`
  可以调它
- scheduler
  也可以调它

### 10.3 定时任务执行时的 session 策略

推荐只支持一种策略：

- 每次执行创建一个新的 session

具体方式：

1. job 可选引用 `sessionTemplateId`
2. 触发时读取模板 session 的静态配置
   - `systemPrompt`
   - `model`
   - `sandbox`
   - `loadedSkills`
   - 不复制历史 `messages`
3. 用这些配置创建一个新的 session
4. 将本次 job 的 `message` 作为第一条 user message
5. 运行 agent
6. execution 记录保存本次新 session 的 `sessionId`

### 10.4 为什么不复用原 session

因为复用旧 session 的问题很明显：

- 长期任务会无限堆积上下文
- 一次异常执行会污染后续上下文
- execution 历史和聊天历史混在一起
- 前端不容易区分“用户对话”与“后台任务”

所以对这个仓库来说，“每次执行新开 session”更合理，也更容易维护。

## 11. 持久化策略

### 11.1 Job store

- 每个 job 一个 JSON 文件
- 文件名：`<jobId>.json`
- 更新策略：整体写入 + 原子替换

建议：

1. 写临时文件
2. `rename()`

避免中途写坏。

### 11.2 Execution store

- 每个 execution 一个 JSON 文件
- 便于审计
- 可后续按时间清理

### 11.3 清理策略

建议配置：

- `SCHEDULER_EXECUTION_RETENTION_DAYS=30`
- `SCHEDULER_MAX_EXECUTIONS_PER_JOB=200`

后台定期清理旧 execution。

## 12. 并发与锁

### 12.1 单进程模式

如果当前服务就是单实例部署，那么调度器可以先在本进程内直接跑。

### 12.2 多实例问题

如果未来部署成多实例，所有实例都跑 scheduler 会导致重复执行。

第一阶段建议加一个简单选项：

- `SCHEDULER_ENABLED=true|false`

只有一个实例开启。

### 12.3 稍强一点的方案

如果希望单机多进程也安全，可以加文件锁：

- `scheduler-state.json.lock`

只有拿到 leader lock 的进程负责调度。

这是可选增强，不一定要第一天就做。

## 13. 失败恢复

### 13.1 服务重启时

如果某个 execution 状态还是 `running`，说明进程中断了。

启动恢复时建议：

- 把它标记为 `failed`
- `error = "Process terminated before execution completed"`

### 13.2 missed run 处理

比如服务停机 6 小时，期间错过 6 次间隔任务。

第一阶段建议支持一个简单配置：

- `catchupPolicy: 'none' | 'latest' | 'all'`

默认：

- `none`

理由：

- 最安全
- 避免服务恢复后瞬间打爆模型调用

后续再支持：

- `latest`
  - 只补最近一次

不要第一阶段就默认 `all`。

## 14. API 设计

建议新增：

### 14.1 Job CRUD

```http
GET    /api/scheduled-jobs
POST   /api/scheduled-jobs
GET    /api/scheduled-jobs/:jobId
PATCH  /api/scheduled-jobs/:jobId
DELETE /api/scheduled-jobs/:jobId
```

### 14.2 Job actions

```http
POST /api/scheduled-jobs/:jobId/run
POST /api/scheduled-jobs/:jobId/enable
POST /api/scheduled-jobs/:jobId/disable
```

### 14.3 Execution 查询

```http
GET /api/scheduled-jobs/:jobId/executions
GET /api/scheduled-executions/:executionId
```

### 14.4 Scheduler 状态

```http
GET /api/scheduler/status
```

返回示例：

```json
{
  "ok": true,
  "enabled": true,
  "pollIntervalMs": 5000,
  "runningJobs": 1,
  "jobCount": 8,
  "nextWakeAt": "2026-04-26T21:30:00.000Z"
}
```

## 15. 前后端数据传递方案

这是这个仓库里最重要的落地问题之一。

定时任务不应该复用聊天 SSE 接口，也不应该混进 `/api/sessions`。推荐做法是：

1. `/api/config` 只传“前端是否启用定时任务 UI”的能力开关
2. job / execution 走独立 REST API
3. 第一阶段前端通过轮询刷新任务状态
4. 真正需要实时推送时，再补专用 scheduler SSE

### 15.1 `/api/config` 传什么

当前前端启动时已经会调用：

- [`src/frontend/api.ts`](/Users/bill/code/kraken-server/src/frontend/api.ts) 的 `fetchConfig()`

因此最自然的做法是在现有 config 响应里增加：

```ts
interface Config {
  appTitle: string
  configured: boolean
  model: string
  defaultSystemPrompt: string
  maxAgentSteps: number
  defaultWorkspaceRoot: string
  sandboxEnabled: boolean
  seatbeltEnabled: boolean
  schedulerEnabled: boolean
  schedulerMaxConcurrency: number
  schedulerPollIntervalMs: number
}
```

前端用途：

- `schedulerEnabled=false`
  - 不显示 Scheduled Jobs UI
- `schedulerEnabled=true`
  - 显示任务入口

这部分建议改：

- [`src/server.ts`](/Users/bill/code/kraken-server/src/server.ts)
- [`src/frontend/types.ts`](/Users/bill/code/kraken-server/src/frontend/types.ts)

### 15.2 Job 数据怎么传

不要把 job 塞进 session 返回体里。

原因：

- session 和 scheduled job 不是一个资源
- 生命周期不同
- 查询模式不同

应走独立接口：

```http
GET    /api/scheduled-jobs
POST   /api/scheduled-jobs
GET    /api/scheduled-jobs/:jobId
PATCH  /api/scheduled-jobs/:jobId
DELETE /api/scheduled-jobs/:jobId
```

返回示例：

```json
{
  "ok": true,
  "jobs": [
    {
      "id": "job_123",
      "name": "Daily Repo Summary",
      "enabled": true,
      "sessionTemplateId": "session_template_abc",
      "message": "Summarize repository changes since yesterday.",
      "schedule": {
        "type": "cron",
        "expression": "0 9 * * *",
        "timezone": "Asia/Shanghai"
      },
      "nextRunAt": "2026-04-27T01:00:00.000Z",
      "lastRunAt": "2026-04-26T01:00:03.000Z",
      "lastSuccessAt": "2026-04-26T01:00:15.000Z",
      "createdAt": "2026-04-25T12:00:00.000Z",
      "updatedAt": "2026-04-26T08:00:00.000Z"
    }
  ]
}
```

### 15.3 Execution 数据怎么传

execution 也应独立查询：

```http
GET /api/scheduled-jobs/:jobId/executions
GET /api/scheduled-executions/:executionId
```

返回示例：

```json
{
  "ok": true,
  "executions": [
    {
      "id": "exec_123",
      "jobId": "job_123",
      "sessionId": "session_run_20260426_1",
      "status": "succeeded",
      "triggerType": "schedule",
      "attempt": 1,
      "startedAt": "2026-04-26T01:00:03.000Z",
      "finishedAt": "2026-04-26T01:00:15.000Z",
      "createdAt": "2026-04-26T01:00:03.000Z",
      "updatedAt": "2026-04-26T01:00:15.000Z",
      "result": {
        "reply": "Summary complete.",
        "runId": "run_abc",
        "toolExecutionCount": 2
      }
    }
  ]
}
```

### 15.4 前端创建 job 时传什么

前端不要传运行时对象。

只传“任务定义”：

```json
{
  "name": "Daily Repo Summary",
  "sessionTemplateId": "session_template_abc",
  "message": "Summarize repository changes since yesterday.",
  "schedule": {
    "type": "cron",
    "expression": "0 9 * * *",
    "timezone": "Asia/Shanghai"
  },
  "enabled": true
}
```

后端收到后自己负责：

- 读取 template session（如果提供）
- 组装这次运行的配置模板
- 创建一个新的 session
- 构造 sandbox policy
- 构造 tool registry
- 恢复 loaded skills
- 调 agent runtime

这和当前 chat 请求的责任边界一致。

### 15.5 手动运行如何传

建议：

```http
POST /api/scheduled-jobs/:jobId/run
```

返回：

```json
{
  "ok": true,
  "execution": {
    "id": "exec_456",
    "jobId": "job_123",
    "status": "queued",
    "triggerType": "manual"
  }
}
```

前端随后轮询 execution 列表或详情。

## 16. 前端类型设计建议

建议在 [`src/frontend/types.ts`](/Users/bill/code/kraken-server/src/frontend/types.ts) 中新增：

```ts
export type ScheduledJobSchedule =
  | { type: 'once'; runAt: string }
  | { type: 'interval'; everyMs: number }
  | { type: 'cron'; expression: string; timezone?: string }

export interface ScheduledJob {
  id: string
  name: string
  enabled: boolean
  sessionTemplateId?: string
  message: string
  schedule: ScheduledJobSchedule
  nextRunAt: string | null
  lastRunAt?: string
  lastSuccessAt?: string
  lastFailureAt?: string
  createdAt: string
  updatedAt: string
}

export interface ScheduledExecution {
  id: string
  jobId: string
  sessionId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  triggerType: 'schedule' | 'manual' | 'retry' | 'catchup'
  attempt: number
  startedAt?: string
  finishedAt?: string
  error?: string
  createdAt: string
  updatedAt: string
  result?: {
    reply: string
    runId: string
    toolExecutionCount: number
  }
}

export interface SchedulerStatus {
  enabled: boolean
  pollIntervalMs: number
  runningJobs: number
  jobCount: number
  nextWakeAt: string | null
}
```

## 17. 前端 API 层建议

建议在 [`src/frontend/api.ts`](/Users/bill/code/kraken-server/src/frontend/api.ts) 里新增：

```ts
export async function fetchScheduledJobs(): Promise<ScheduledJob[]>
export async function fetchScheduledJob(jobId: string): Promise<ScheduledJob>
export async function createScheduledJob(body: CreateScheduledJobInput): Promise<{ job: ScheduledJob }>
export async function updateScheduledJob(jobId: string, body: UpdateScheduledJobInput): Promise<{ job: ScheduledJob }>
export async function deleteScheduledJob(jobId: string): Promise<void>
export async function runScheduledJob(jobId: string): Promise<{ execution: ScheduledExecution }>
export async function fetchJobExecutions(jobId: string): Promise<ScheduledExecution[]>
export async function fetchSchedulerStatus(): Promise<SchedulerStatus>
```

第一阶段不建议把这些逻辑混进 `useChat` 或 `useSessions`。

建议新增独立 hook：

```text
src/frontend/hooks/useScheduledJobs.ts
```

职责：

- 拉任务列表
- 新建/更新/删除
- 轮询刷新
- 拉 execution 历史

## 18. 前端刷新策略

### 18.1 第一阶段建议：轮询

对这个仓库，第一阶段不要为了定时任务状态上来就引入 SSE。

原因：

- job/execution 更新频率远低于聊天流
- 聊天是 token 级流式，scheduler 不是
- 轮询更简单，更好调试

建议：

- job 列表页：每 10 秒轮询一次
- job 详情页 execution 列表：每 5 秒轮询一次
- 手动点击 `Run now` 后：短时间内加快轮询频率

### 18.2 什么时候再做 SSE

如果后面发现这几个问题，再补：

- 用户需要实时看到 execution 状态变化
- 需要多页面同步更新
- 轮询请求明显太多

那时再加：

```http
GET /api/scheduler/stream
```

事件可以定义为：

- `job:created`
- `job:updated`
- `job:deleted`
- `execution:started`
- `execution:finished`
- `execution:failed`

但这应该是第二阶段，不是第一阶段必需。

## 19. 前端设计建议

### 15.1 最小 UI

建议先做一个独立面板，而不是把它塞进聊天输入区。

例如：

- Sidebar 增加 `Scheduled Jobs`
- 或新增单独页面 `/jobs`

### 15.2 Job 表单字段

至少需要：

- `name`
- `message`
- `sessionTemplateId`
- `schedule.type`
- `schedule` 具体参数
- `enabled`

高级字段先折叠：

- `model`
- `systemPrompt`
- `sandbox`
- `retryPolicy`
- `overlapPolicy`

### 15.3 Execution 展示

每个 job 下显示最近 N 条：

- 状态
- 开始时间
- 结束时间
- runId
- 错误摘要

用户需要能点进去看详情。

## 20. 安全与资源控制

### 16.1 任务本质上是自动化 shell + 文件 + LLM 调用

所以定时任务不能只是“加个 cron”。

必须明确：

- 它继承模板配置或 job 覆盖配置的 sandbox
- 它继承当前工具开关
- 它会消耗 token 和外部 API 配额

### 16.2 必须增加的保护

建议新增环境变量：

```bash
SCHEDULER_ENABLED=true
SCHEDULER_MAX_CONCURRENCY=2
SCHEDULER_POLL_INTERVAL_MS=5000
SCHEDULER_EXECUTION_TIMEOUT_MS=180000
SCHEDULER_MAX_RUNS_PER_MINUTE=10
```

### 16.3 并发建议

第一阶段建议：

- 全局最大并发 `2`

理由：

- 当前 agent 运行可能会触发 shell / web / 文件 IO
- 并发太高会互相争用 workspace 和 API 配额

## 21. 对现有代码的具体改造建议

### 17.1 抽出 runtime service

从 [`src/server.ts`](/Users/bill/code/kraken-server/src/server.ts) 抽出：

- `runAgentRequest`
- session load/save helpers
- build tool registry logic

建议新文件：

```text
src/runtime/agent-service.ts
```

### 17.2 新增 scheduler 模块

建议：

```text
src/scheduler/types.ts
src/scheduler/store.ts
src/scheduler/planner.ts
src/scheduler/runner.ts
src/scheduler/service.ts
```

### 17.3 Server 集成

在 server 启动时：

1. 创建 scheduler service
2. `await scheduler.start()`
3. 注册 scheduler API routes

### 17.4 Config 扩展

`/api/config` 可以增加：

- `schedulerEnabled`
- `schedulerMaxConcurrency`
- `schedulerPollIntervalMs`

前端据此决定是否显示入口。

## 22. 分阶段落地顺序

### Phase 1

- 抽 `agent-service`
- 定义 job / execution types
- 文件存储
- `once` / `interval` / `cron`
- `timezone`
- `createNewSession`
- 手动 run
- 列表 / 详情 API

### Phase 2

- retry policy
- overlap policy
- catchup policy
- execution retention
- 前端任务面板

### Phase 3

- leader lock
- job metrics
- webhook / 通知

## 23. 我对你这个仓库的直接建议

如果按当前 `kraken-server` 的规模和复杂度，我建议：

1. 不要上来就接 Redis / BullMQ / Temporal
2. 先做“单进程 + 文件持久化 + 轮询调度”
3. 先把 agent runtime 抽成可复用 service
4. 第一版就支持 `cron + timezone`
5. 明确 job 级 `createNewSession`

原因很简单：

- 你现在的服务架构本来就是单进程、文件持久化导向
- 先把系统边界做清楚，比引入大而重的依赖更重要
- 调度系统一旦做错，后面很难修
- 对“每天早上推送日报”这类任务，`interval=24h` 不是正确语义，`cron + timezone` 才是

## 24. 一句话结论

对这个仓库，最合适的第一版不是“引入一个任务平台”，而是：

> 把现有 agent 执行能力抽成 service，然后在服务内部加一个持久化 scheduler，按 job 定义定时调用它。

这条路线改动最少、风险最低，而且和当前 `.sessions`、sandbox、skills、tool registry 的实现方式是同一风格。
