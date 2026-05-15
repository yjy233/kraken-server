# Kraken 长短期记忆与自进化体系技术方案

## 1. 目标

为 `kraken-server` 增加一套可审计、可渐进落地的记忆与自进化体系，让 Agent 能够：

- 在单个 session 内稳定保留当前任务目标、关键决策、偏好和未完成事项
- 在跨 session、跨入口场景中复用长期记忆
- 从用户纠正、工具失败、重复流程和高价值结果中沉淀经验
- 通过 scheduler 做离线整理、去重、衰减和改进建议
- 保持运行时行为可控，不让 Agent 静默修改系统提示词、技能或代码

第一阶段目标不是做完整的自主学习平台，而是在现有架构上补齐“记住、检索、反思、提案”的闭环。

## 2. 当前基础

当前仓库已经具备实现这套体系的关键入口：

- [`src/runtime/agent-service.ts`](/Users/bill/code/kraken-server/src/runtime/agent-service.ts)
  - 统一承接 Web、Feishu、scheduler 的 Agent 执行
  - 负责创建/加载 session、构建 runtime system prompt、组装工具、保存运行结果
- [`src/runtime/session-store.ts`](/Users/bill/code/kraken-server/src/runtime/session-store.ts)
  - 将完整 session 保存到 `.sessions/<sessionId>.json`
  - 已包含 message meta，可区分 `web`、`feishu`、`scheduler`
- [`src/runtime/context-window.ts`](/Users/bill/code/kraken-server/src/runtime/context-window.ts)
  - 已有上下文 token 估算和压缩逻辑
  - 适合作为短期记忆的第一阶段承载点
- [`src/scheduler/service.ts`](/Users/bill/code/kraken-server/src/scheduler/service.ts)
  - 已经能定时触发 Agent 运行
  - 适合承担离线反思、记忆整理、自进化提案生成
- skill system
  - 已经有可安装、可激活、可持久化的技能机制
  - 适合承载“流程知识”，但不应被自进化系统直接静默改写

## 3. 总体架构

![Kraken memory and evolution architecture](./images/kraken-memory-evolution-architecture.png)

推荐架构分为五层：

1. Runtime intake
   - 统一入口仍然是 `agentService.run()`
   - 根据 session、workspace、Feishu conversation、scheduler job 推导记忆 scope

2. Short-term memory
   - 基于当前 session
   - 保存 rolling summary、当前任务状态、最近失败、未完成事项
   - 注入到下一轮上下文中

3. Long-term memory
   - 独立于 session 保存
   - 按 scope、kind、tags、importance、confidence 检索
   - 对跨 session 的用户偏好、项目事实、流程经验负责

4. Reflection and extraction
   - 运行结束后从本轮对话中抽取候选记忆
   - 从工具失败和用户纠正中提取经验
   - 生成待采纳提案，而不是直接修改系统行为

5. Evolution governance
   - scheduler 定期合并、去重、降权、归档
   - 对 prompt、skill、工具策略生成 proposal
   - 需要人工确认后才真正修改代码、skill 或默认配置

## 4. 记忆模型

### 4.1 短期记忆

短期记忆属于 session，服务于“当前任务继续做下去”。

建议在 `SessionRecord` 中新增：

```ts
interface SessionMemoryState {
  summary: string
  goals: string[]
  decisions: string[]
  openItems: string[]
  userPreferences: string[]
  relevantFiles: string[]
  recentFailures: string[]
  updatedAt: string
}
```

短期记忆的来源：

- 原始 session messages
- `contextWindow` 压缩结果
- 本轮用户消息
- 本轮 assistant 最终回复
- tool execution 结果和错误

短期记忆的注入方式：

```text
## Session Memory
- Current goal: ...
- Decisions: ...
- Open items: ...
- Relevant files: ...
- Recent failures: ...
```

这一层应该稳定、保守、可覆盖。它不负责跨会话学习。

### 4.2 长期记忆

长期记忆独立保存，不混进 `.sessions`。第一阶段建议使用 JSONL 文件，后续再升级到 SQLite 或向量索引。

推荐目录：

```text
.memory/
├── memories.jsonl
├── proposals.jsonl
├── reflections.jsonl
├── indexes/
│   └── keyword-index.json
└── runs/
    └── <runId>.json
```

推荐数据结构：

```ts
interface MemoryRecord {
  id: string
  scope: MemoryScope
  kind: MemoryKind
  text: string
  tags: string[]
  sourceSessionId?: string
  sourceMessageIds?: string[]
  sourceRunId?: string
  confidence: number
  importance: number
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
  expiresAt?: string
}

type MemoryScope =
  | { type: 'global' }
  | { type: 'workspace'; root: string }
  | { type: 'user'; userId: string }
  | { type: 'feishu-chat'; chatId: string; chatType: 'p2p' | 'group' }
  | { type: 'scheduler-job'; jobId: string }
  | { type: 'skill'; name: string }

type MemoryKind =
  | 'preference'
  | 'fact'
  | 'decision'
  | 'procedure'
  | 'failure'
  | 'todo'
  | 'artifact'
```

### 4.3 Scope 规则

长期记忆最重要的是隔离边界。推荐默认规则：

- Web session
  - 优先使用 `workspace` scope
  - 没有 workspace 时使用 `global`
- Feishu p2p
  - 使用 `feishu-chat:p2p:<chatId>`
  - 可选叠加 `user:<senderId>`
- Feishu group
  - 使用 `feishu-chat:group:<chatId>`
  - 不默认把某个群成员偏好写入群级记忆
- Scheduler
  - 使用 `scheduler-job:<jobId>`
  - 如果 job 指定 workspace，再叠加 workspace 记忆
- Skill
  - 只保存可复用流程经验
  - 不保存用户隐私或会话细节

## 5. 运行链路

### 5.1 请求前

`agentService.run()` 在构建 runtime prompt 前增加：

1. 解析当前 memory scope
2. 从短期记忆读取 session summary
3. 从长期记忆检索相关 records
4. 按优先级和 token budget 组装 memory context
5. 将 memory context 注入 runtime system prompt

推荐注入顺序：

```text
Base system prompt
Tool and skill instructions
Runtime date context
Sandbox context
Session memory
Relevant long-term memory
```

长期记忆只注入检索命中的少量内容，不要全量塞进 prompt。

### 5.2 请求后

Agent 运行完成并保存 session 后，执行 post-run pipeline：

1. 更新 session rolling summary
2. 抽取候选长期记忆
3. 写入高置信 memory
4. 对低置信内容写入 pending proposal
5. 记录 reflection metadata
6. 通过事件或日志暴露结果

这条链路可以先同步执行，后续改成后台队列。

### 5.3 失败学习

工具调用失败、scheduler 失败、用户纠正属于高价值学习来源。

建议抽取：

- 失败的工具名
- 输入摘要
- 错误信息
- 当前 workspace/session/scope
- 后续是否被修复
- 修复方式

但失败经验不应无脑注入。只有当任务、工具、路径或错误形态相近时才检索出来。

## 6. 自进化设计

### 6.1 自进化对象

自进化系统只直接生成三类产物：

- `memory`
  - 可以被检索注入
  - 必须带 source、scope、confidence
- `reflection`
  - 运行质量分析
  - 默认不注入 prompt
- `proposal`
  - 对 prompt、skill、工具策略、文档、代码的改进建议
  - 需要人工确认后才能应用

### 6.2 禁止的默认行为

第一阶段不允许：

- 自动修改 base system prompt
- 自动修改 skill 内容
- 自动编辑代码实现
- 自动安装新依赖
- 自动提升工具权限
- 将 Feishu 群聊内容写入 global memory
- 将低置信推断当作事实保存

### 6.3 Proposal 类型

```ts
interface EvolutionProposal {
  id: string
  type: 'memory_write' | 'memory_merge' | 'agents_patch' | 'skill_create' | 'skill_patch'
  title: string
  rationale: string
  sourceRunIds: string[]
  suggestedChange: string
  risk: 'low' | 'medium' | 'high'
  status: 'pending' | 'accepted' | 'rejected' | 'applied'
  createdAt: string
  updatedAt: string
}
```

Proposal 可以由 scheduler 定期整理，也可以由用户手动触发生成。

## 7. 推荐模块划分

建议新增：

```text
src/memory/
├── types.ts
├── scope.ts
├── store.ts
├── search.ts
├── prompt.ts
├── extractor.ts
├── short-term.ts
├── reflection.ts
└── proposal.ts
```

职责划分：

- `scope.ts`
  - 从 session、message meta、sandbox、scheduler job 推导 scope
- `store.ts`
  - JSONL 读写、记录校验、去重
- `search.ts`
  - 第一阶段关键词检索和打分
  - 后续可替换为 embedding/vector search
- `prompt.ts`
  - 将短期和长期记忆渲染成 prompt block
- `extractor.ts`
  - 从本轮对话抽取候选 memory
- `short-term.ts`
  - 更新 session rolling summary
- `reflection.ts`
  - 生成运行质量分析
- `proposal.ts`
  - 生成、更新、采纳自进化提案

## 8. 工具设计

第一阶段建议新增两个工具，但默认写入要保守：

### 8.1 `memory_search`

用途：

- Agent 主动查询长期记忆
- 支持按 scope、kind、tag、query 检索

建议输入：

```json
{
  "query": "string",
  "kind": "preference|fact|decision|procedure|failure|todo|artifact",
  "limit": 5
}
```

### 8.2 `memory_remember`

用途：

- 用户明确说“记住”
- Agent 提交候选记忆

默认策略：

- 用户明确要求记住：可直接写入当前 scope
- Agent 自己推断：写入 pending，等待 consolidation 或人工确认
- 敏感内容：默认拒绝或需要确认

## 9. Scheduler 任务

建议新增内置维护任务：

1. `memory-consolidation`
   - 合并重复记忆
   - 提升反复出现且被验证的记忆 importance
   - 降权长期未使用内容

2. `failure-mining`
   - 从 tool executions 和 scheduler failures 中提取失败模式
   - 生成 procedure/failure 记忆或 proposal

3. `proposal-review-digest`
   - 汇总近期 pending proposals
   - 生成可读报告

4. `index-rebuild`
   - 重建关键词索引
   - 后续重建向量索引

这些任务可以复用现有 scheduler，但应避免调用完整通用 Agent 进行高权限操作。维护任务优先使用受限模型调用和本地 store API。

## 10. Prompt 注入预算

推荐默认预算：

- session memory: 500-1200 tokens
- long-term memory: 500-1500 tokens
- failure memory: 最多 3 条
- preferences: 最多 5 条
- procedures: 最多 3 条

注入内容必须短、明确、可追溯：

```text
## Relevant Memory
- [preference, confidence 0.92] User prefers concise Chinese technical docs with implementation phases. Source: session xxx.
- [failure, confidence 0.81] When generating images through OpenRouter, use proxy http://127.0.0.1:7897 in this environment. Source: session yyy.
```

注意：带密钥、token、cookie 的内容不得写入长期记忆。

## 11. 安全与隐私

必须实现的边界：

- 不保存 API key、access token、cookie、私钥
- 不把 Feishu 私聊记忆注入群聊
- 不把群聊成员个人偏好写成群级事实
- 不把低置信模型推断写成长期事实
- 所有 memory 记录都带 source
- 用户可以查看、删除、禁用长期记忆
- 自进化 proposal 必须可审计

建议增加配置：

```env
MEMORY_ENABLED=false
MEMORY_DIR=.memory
MEMORY_AUTO_WRITE=false
MEMORY_MAX_PROMPT_TOKENS=1500
MEMORY_REQUIRE_CONFIRMATION=true
EVOLUTION_ENABLED=false
EVOLUTION_PROPOSAL_ONLY=true
```

## 12. 分阶段落地

### Phase 1: Session 短期记忆

- 扩展 `SessionRecord`
- 增加 session rolling summary
- 在 `agentService.run()` 中注入 session memory
- 保存 context/memory 状态

验收：

- 长 session 不只依赖最近消息也能记住当前任务
- session summary 可在 API 返回中查看

### Phase 2: 长期记忆 Store

- 新增 `.memory/memories.jsonl`
- 实现 `MemoryStore`
- 实现 scope 解析
- 实现关键词检索
- 在 runtime prompt 注入相关记忆

验收：

- 不同 session 能复用同 workspace 的项目事实
- Feishu p2p 与 group 记忆不会串用

### Phase 3: 记忆抽取与工具

- 增加 post-run extractor
- 增加 `memory_search`
- 增加 `memory_remember`
- 支持用户显式“记住/忘记”

验收：

- 用户明确要求记住的偏好能跨 session 生效
- 敏感内容不会被写入

### Phase 4: 离线整理

- scheduler 执行 memory consolidation
- 去重、合并、衰减
- 生成 reflection 记录

验收：

- 重复记忆被合并
- 长期未使用内容不会持续污染 prompt

### Phase 5: 自进化提案

- 从失败、重复流程、用户纠正中生成 proposals
- 提供 API 和前端查看 pending proposals
- 支持人工接受或拒绝

验收：

- Agent 可以提出 skill/prompt/doc 改进建议
- 不会未经确认修改系统行为

## 13. 最小实现建议

最小可行版本只做四件事：

1. `SessionMemoryState`
2. `.memory/memories.jsonl`
3. `memorySearch + memoryPromptBlock`
4. post-run `extractMemoryCandidates`

先不要做：

- embedding
- SQLite
- 多租户权限
- 自动 prompt patch
- 自动 skill patch
- 自动代码修改

这能让体系快速进入可用状态，同时保留升级空间。

## 14. 关键设计判断

### 14.1 为什么不把长期记忆塞进 session

session 是对话历史，不是知识库。长期记忆需要跨 session 检索、去重、衰减和删除。如果混在 session JSON 里，很快会导致查找困难、边界混乱、上下文污染。

### 14.2 为什么不让 Agent 直接自改 prompt 和 skill

Kraken 已经具备写文件、执行 shell、安装 skill 的能力。如果自进化系统能静默改 prompt 或 skill，它就可能把一次错误推断固化为长期行为。更稳妥的做法是：自动生成 proposal，人工确认后应用。

### 14.3 为什么先不用向量库

当前仓库是文件持久化优先，scheduler/session 也采用 JSON 文件路线。第一阶段用 JSONL + 关键词检索更符合现有复杂度。后续可在 `src/memory/search.ts` 后面替换成 embedding 检索，不影响上层接口。

## 15. 后续扩展

- SQLite-backed memory store
- OpenAI/OpenRouter embedding 索引
- per-user memory dashboard
- Feishu memory management commands
- memory import/export
- skill proposal diff viewer
- prompt patch approval workflow
- tool policy learning
- model usage 与 memory hit rate 关联分析
