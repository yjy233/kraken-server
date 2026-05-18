# Slash Command 技术方案

## 1. 背景与目标

当前 Kraken Agent 的聊天输入区是一个标准 textarea，用户直接输入自然语言后走既有 `chat:start` 流程。项目已经具备以下与 slash command 高度相关的基础能力：

- 前端存在集中式输入组件：`src/frontend/components/Composer.tsx`
- 前端可通过 `/api/config` 获取 `skills: SkillInfo[]`
- Session 已持久化 `loadedSkills`
- Sidebar 已展示 `Available Skills` 与 `Active Skills`
- 后端已提供 `skill` tool，支持 `activate` 与 `read_reference`

本方案目标是：

1. 用户在输入框键入 `/` 时，弹出命令菜单
2. 第一阶段只支持 `/skill`
3. 选择 `/skill` 后，再展示当前系统支持的 skill 列表
4. 用户选择具体 skill 后，将其与后续自然语言请求一起发送
5. 第一阶段尽量不改 agent 主执行链路；第二阶段再升级为结构化命令

---

## 2. 现状分析

### 2.1 前端输入链路

关键文件：

- `src/frontend/components/Composer.tsx`
- `src/frontend/App.tsx`
- `src/frontend/hooks/useChat.ts`

当前 `Composer` 负责：

- 文本输入
- 图片粘贴与附件上传
- `Cmd/Ctrl + Enter` 发送

当前 `App.tsx` 中：

- `handleSend(message, images)` 直接调用 `chat.send(...)`
- `config.skills` 已可从 `useConfig()` 获取

当前 `useChat.ts` 中，`chat:start` 发送 payload 为：

```ts
{
  sessionId,
  systemPrompt,
  message,
  content?,
  sandbox?
}
```

这意味着第一阶段完全可以把 slash command 作为“前端输入增强 + 发送前转换”来实现，而不必先改 ws 协议。

### 2.2 Skill 系统现状

参考：`docs/skill-system.md`

当前项目中：

- 所有可用 skills 会进入系统 prompt
- agent 被引导在需要时调用 `skill.activate`
- 已激活 skill 存在 session 的 `loadedSkills` 中
- 前端可显示当前会话 active skills

这说明 `/skill` 很适合成为第一个 slash command，因为它已经有完整后端语义基础。

---

## 3. 设计原则

### 3.1 分阶段交付

优先做最小可用版本，减少对当前 agent runtime 的侵入，再逐步升级为结构化命令。

### 3.2 以现有 textarea 为核心

第一阶段不引入富文本编辑器，不做 token badge，不改输入控件类型。

### 3.3 尽量复用现有 skill 体系

不新增 skills 数据接口；直接复用 `config.skills`。

### 3.4 命令体验与系统语义逐步对齐

第一阶段先解决输入体验；第二阶段再解决“命令语义必须被可靠执行”的问题。

---

## 4. 分期方案总览

## Phase 1：前端增强版

目标：

- 在输入框里支持 slash 菜单
- 支持 `/skill`
- 支持技能二级选择
- 用户选中 skill 后插入命令文本
- 发送前将命令文本转换成更明确的 prompt

特点：

- 几乎只改前端
- 不改 websocket 协议
- 不改 agent service / session store
- 风险低、交付快

限制：

- skill 激活仍依赖模型理解消息并调用 `skill.activate`
- 无法保证 100% 按 slash command 语义执行

## Phase 2：结构化命令版

目标：

- slash command 在发送时带上结构化字段
- 服务端在 agent run 前显式处理 slash command
- `/skill xxx` 能可靠变成“激活 skill xxx”

特点：

- 行为更可控
- 可直接更新 `session.loadedSkills`
- 便于未来扩展 `/file`、`/todo`、`/search`

代价：

- 需改前后端类型
- 需改 ws 协议与 server 运行前逻辑

---

## 5. 推荐落地路径

建议先做一个介于两者之间的 **Phase 1.5**：

- 用户界面是完整 slash menu
- 输入框保留 `/skill <name>` 文本
- 发送前前端将其转换为更明确的指令式 prompt

例如用户输入：

```text
/skill skill-creator 帮我设计一个新 skill
```

发送前转换为：

```text
Please activate the skill "skill-creator" before continuing.

Then help with this request:
帮我设计一个新 skill
```

好处：

- 用户体验已具备 slash command 形态
- 后端无需改动
- skill 激活成功率高于单纯发送 `/skill xxx`

---

## 6. 交互设计

### 6.1 触发条件

第一阶段建议收敛规则，只支持**输入框开头**的 slash token。

推荐触发模式：

```text
^/\w*
```

即：

- `/`
- `/s`
- `/skill`

可触发菜单；
但暂不支持正文中间任意位置的 `/skill`，以降低复杂度与误触风险。

### 6.2 菜单层级

一级菜单：

- `skill` — Select and activate an available skill

二级菜单：

- 展示 `config.skills`
- 每项显示：
  - `skill.name`
  - `skill.description`

### 6.3 选择后的输入框回填

推荐回填格式：

```text
/skill skill-name
```

用户随后可以继续补充自然语言，例如：

```text
/skill feishu-docx-powerwrite 帮我生成一篇文档初稿
```

### 6.4 键盘交互

菜单打开时：

- `ArrowDown`：下移高亮项
- `ArrowUp`：上移高亮项
- `Enter`：选择当前项
- `Tab`：也可选择当前项
- `Escape`：关闭菜单

保留现有行为：

- `Cmd/Ctrl + Enter`：发送消息

注意：

- 当菜单打开时，普通 `Enter` 优先用于选项确认，而不是发送
- 输入法 composition 期间不应触发 slash 确认逻辑

### 6.5 中文输入法兼容

需要在 `Composer` 中处理：

- `onCompositionStart`
- `onCompositionEnd`

否则中文输入时可能出现：

- 上下键被错误拦截
- 回车提前确认候选菜单

---

## 7. 前端技术设计

### 7.1 建议新增的数据模型

建议新增前端 slash command 类型，可放在：

- `src/frontend/types.ts`
- 或 `src/frontend/slash-commands/types.ts`

示例：

```ts
type SlashCommandName = 'skill'

type SlashMenuStage = 'root' | 'skill'

interface SlashCommandOption {
  id: string
  type: 'command' | 'skill'
  label: string
  description?: string
  value: string
}

interface SlashContext {
  active: boolean
  stage: SlashMenuStage
  query: string
  replaceStart: number
  replaceEnd: number
}
```

### 7.2 Composer 需要新增的状态

`src/frontend/components/Composer.tsx` 建议新增：

- `isSlashMenuOpen`
- `slashStage: 'root' | 'skill'`
- `highlightedIndex`
- `isComposing`
- `textareaRef`
- 当前 slash context 或 derived state

已有状态 `text / images / error` 可继续保留。

### 7.3 建议新增工具模块

建议新增：

- `src/frontend/utils/slash-commands.ts`

职责建议如下：

#### `getSlashContext(text, cursor)`

输入：

- 当前文本
- 光标位置

输出：

- 当前是否处于 slash command
- 所处阶段：`root` / `skill`
- query
- 被替换区间

#### `buildRootCommandOptions()`

返回一级菜单项：

```ts
[
  {
    id: 'skill',
    type: 'command',
    label: 'skill',
    description: 'Select and activate an available skill',
    value: 'skill',
  },
]
```

#### `buildSkillOptions(skills, query)`

根据 `config.skills` 和输入 query 进行过滤。

建议第一阶段用简单 `includes()` 过滤即可。

#### `applySlashSelection(text, selection, context)`

负责把用户选中的菜单项写回 textarea 文本。

建议行为：

- 选择 `skill` 命令后，回填 `/skill ` 并切换到二级菜单
- 选择具体 skill 后，回填 `/skill skill-name `，并关闭菜单

#### `transformComposerMessage(text)`

发送前解析：

- 若输入以 `/skill <name>` 开头，则将其转成更明确 prompt
- 否则原样返回

### 7.4 状态机建议

建议按下面的简单状态机实现：

- `idle`
- `rootMenu`
- `skillMenu`

状态转移：

- `idle` + 输入 `/` -> `rootMenu`
- `rootMenu` + 选中 `skill` -> `skillMenu`
- `skillMenu` + 选中具体 skill -> `idle`
- 任意状态 + `Escape` -> `idle`
- 任意状态 + 光标移出 slash token -> `idle`

无需引入 xstate，用普通 React state 即可。

---

## 8. 文件级改动建议

### 8.1 `src/frontend/components/Composer.tsx`

职责扩展：

- slash 菜单触发与关闭
- 光标位置读取
- 键盘导航
- 菜单渲染
- 中文输入法保护

建议保持 Composer 仍然是输入交互的单点，而不是把 slash 状态提升到全局。

### 8.2 `src/frontend/App.tsx`

建议改动：

- 将 `config.skills` 传给 `Composer`
- 在 `handleSend` 前增加 message transform

例如：

```ts
const finalMessage = transformComposerMessage(message, config?.skills || [])
chat.send(finalMessage, systemPrompt, sandbox, images)
```

### 8.3 `src/frontend/types.ts`

可新增：

- slash option 类型
- 第二阶段可新增 `PendingSlashCommand`

### 8.4 `src/frontend/hooks/useChat.ts`

第一阶段：

- 不需要改 websocket payload 结构

第二阶段：

- `send()` 增加 `slashCommands?`
- 传给 `chat:start.payload`

### 8.5 `src/ws/protocol.ts`

第一阶段：

- 不需要改

第二阶段建议扩展：

```ts
slashCommands?: Array<
  | { type: 'skill'; skillName: string }
>
```

---

## 9. 第一阶段的消息转换策略

### 9.1 转换目标

将：

```text
/skill skill-name 后续自然语言请求
```

转为更明确、能稳定引导 agent 调用 `skill.activate` 的文本。

### 9.2 推荐规则

输入：

```text
/skill skill-creator 帮我设计一个新 skill
```

输出：

```text
Please activate the skill "skill-creator" before continuing.

Then help with this request:
帮我设计一个新 skill
```

如果只有：

```text
/skill skill-creator
```

则输出：

```text
Please activate the skill "skill-creator" and tell me how you will use it.
```

### 9.3 这样做的原因

当前系统 prompt 已经：

- 包含所有 available skills
- 要求模型通过 `skill` tool 激活 skill

因此这种转换能显著提高模型正确使用 skill tool 的概率，而无需修改后端。

---

## 10. 第二阶段：结构化命令设计

### 10.1 前端协议扩展

在 `chat:start.payload` 中增加：

```ts
slashCommands?: Array<
  | { type: 'skill'; skillName: string }
>
```

### 10.2 前端内部模型

建议在 `src/frontend/types.ts` 增加：

```ts
export interface PendingSlashCommand {
  type: 'skill'
  skillName: string
}
```

### 10.3 服务端处理时机

服务端在收到 `chat:start` 后、进入 `agentService.run(...)` 前处理 slash commands。

可选方案：

#### 方案 A：转成增强 message

把结构化命令转成 message 前缀，再照常执行。

优点：改动较小。
缺点：仍依赖模型理解。

#### 方案 B：预激活 skill

服务端：

1. 校验 `skillName` 是否存在于 `getAvailableSkills()`
2. 将 skill 放入运行初始 `loadedSkills`
3. 再执行 agent run

优点：更可靠。

#### 方案 C：直接更新 `session.loadedSkills`

语义定义为：

> `/skill xxx` 为当前会话激活该 skill，并在本次请求中优先使用。

服务端流程：

1. 读取 session
2. 校验 skill 是否存在
3. 合并进 `session.loadedSkills`
4. 保存 session
5. 再执行本次请求

这是最符合当前系统心智的方案。

### 10.4 第二阶段推荐语义

推荐把 `/skill xxx` 明确定义为：

- 为当前 session 激活该 skill
- 当前请求优先使用该 skill

这样会与现有：

- `Sidebar Active Skills`
- session persistence
- `skill` 生命周期

形成统一认知。

---

## 11. UI 与样式建议

### 11.1 菜单位置

建议将菜单绝对定位在 `.composer-main` 区域内，挂在 textarea 下方。

### 11.2 每项展示

一级命令项：

- `skill`
- `Select and activate an available skill`

二级 skill 项：

- 第一行：skill name
- 第二行：skill description

### 11.3 空状态

如果无可用 skills：

- 一级仍显示 `/skill`
- 二级显示 `No skills available`

### 11.4 后续可扩展增强

后续可考虑：

- 当前 active skills badge
- slash 命令帮助提示
- 模糊搜索高亮
- 最近使用 skills 排序

但都不属于第一阶段必要项。

---

## 12. 风险与注意事项

### 12.1 textarea 不是富文本编辑器

第一阶段不要尝试：

- token badge
- 内嵌命令块
- 光标级富交互

复杂度不成比例。

### 12.2 键盘行为冲突

需特别处理：

- 普通 Enter
- `Cmd/Ctrl + Enter`
- 菜单打开时的 Enter
- IME 组合输入

### 12.3 Slash 解析范围控制

建议第一版只支持输入框开头的 slash 命令，避免中间文本解析与替换带来的边界复杂度。

### 12.4 技能数量变多后的可用性

当 skills 增加后，需要考虑：

- 滚动容器
- query 过滤
- 键盘高亮保持可见

第一阶段先做基础可用版本即可。

### 12.5 文本显示与实际发送不一致

如果采用发送前 transform，用户看到的输入和实际发送内容不完全一致。

这是第一阶段可接受的权衡，但需要注意：

- 调试时记录原始 message 更有帮助
- 后续结构化命令版可消除这个问题

---

## 13. 开发任务拆分

### 第一阶段任务

1. 设计 slash command 触发与过滤规则
2. 在 `Composer.tsx` 增加 slash menu 状态
3. 增加 root menu 与 skill menu 两级菜单
4. 将 `config.skills` 注入 `Composer`
5. 实现 keyboard navigation 与 IME 兼容
6. 实现 `/skill <name>` 文本回填
7. 实现发送前 `transformComposerMessage()`
8. 验证与图片上传、粘贴、发送逻辑兼容

### 第二阶段任务

1. 扩展 `src/ws/protocol.ts`
2. 扩展 `useChat.send()` 入参与 payload
3. 定义 `PendingSlashCommand` 类型
4. 在 server chat start 流程中处理 slashCommands
5. 更新 `session.loadedSkills` 持久化逻辑
6. 确保 Sidebar 中 `Active Skills` 能即时反映

---

## 14. 验收标准

### 第一阶段验收

- 输入 `/` 时弹出一级菜单
- 输入 `/s` 可过滤到 `skill`
- 选中 `skill` 后进入 skill 列表
- 可通过键盘或鼠标选中某个 skill
- 输入框自动回填 `/skill <name>`
- 用户可继续补充自然语言请求
- 发送后 agent 有较高概率调用 `skill.activate`
- 不影响图片上传、粘贴、取消发送等现有功能

### 第二阶段验收

- 选中 skill 后，发送 payload 中带有结构化 `slashCommands`
- 服务端可校验 skill 是否存在
- 当前 session 的 `loadedSkills` 被可靠更新
- Sidebar 中 `Active Skills` 正确反映激活结果
- 即使模型不主动理解 slash 文本，skill 仍能被激活

---

## 15. 最终建议

如果目标是尽快上线、最小风险验证体验，建议先做：

- **前端 slash menu + `/skill` 二级选择 + 发送前 prompt transform**

如果目标是长期稳定且命令语义可靠，建议第二阶段升级为：

- **结构化 `slashCommands` + 服务端预处理/预激活 + session 持久化**

综合当前项目结构，推荐实施顺序是：

1. 先完成第一阶段，验证交互是否好用
2. 再升级为结构化命令版，补齐可靠性与状态一致性
