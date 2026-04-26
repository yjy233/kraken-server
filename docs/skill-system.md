# Kraken Agent Skill System 技术方案

## 1. 背景与目标

Kimi Code CLI 的 Skill 系统已被验证为一种高效的 AI Agent 能力扩展方式。本方案将标准 Skill 格式引入 Kraken Agent，使其具备：

- **模块化能力扩展**：通过外部 Skill 目录注入领域知识，无需修改核心代码
- **渐进式上下文加载**：避免一次性塞入过多提示词，按需激活 Skill
- **可复用工作流**：将重复任务封装为 Skill，跨项目复用

> 本项目仅在 macOS 运行，Skill 的脚本资源可充分利用 macOS 原生工具链。

## 2. 标准 Skill 格式

Kraken Agent 采用与 Kimi Code CLI 兼容的标准 Skill 格式：

```
skill-name/
├── SKILL.md              # 必需。YAML frontmatter + Markdown 指令
├── scripts/              # 可选。可执行脚本（Python/Bash/Node 等）
├── references/           # 可选。参考文档，按需加载到上下文
└── assets/               # 可选。输出模板、图标、字体等资源
```

### 2.1 SKILL.md 结构

```markdown
---
name: skill-name
description: |
  简明描述 Skill 能力，以及触发条件。
  这是模型判断是否加载该 Skill 的唯一依据。
---

# Skill 标题

## 核心工作流

1. 步骤一...
2. 步骤二...

## 工具调用指南

- 使用 `xx_tool` 做某事
- 使用 `yy_tool` 做某事

## 参考文档

- 详细 schema 见 [references/schema.md](references/schema.md)
- API 文档见 [references/api.md](references/api.md)
```

**关键约束**：
- `description` 必须包含"何时使用"的触发条件，这是 Skill 激活的唯一依据
- SKILL.md body 控制在 500 行以内，超出的内容放入 references/
- 所有 reference 文件必须在 SKILL.md 中显式引用，否则模型不会发现

## 3. Skill 发现与加载层级

Kraken Agent 按以下优先级扫描 Skill（高优先级覆盖低优先级同名 Skill）：

```
1. 命令行指定: --skills-dir /path/to/skills
2. 项目级:     ./skills/                  (当前工作目录)
3. 用户级:     ~/.config/kraken/skills/   (推荐)
4. 用户级:     ~/.kraken/skills/
```

启动时扫描逻辑：

```ts
function discoverSkills(): Skill[] {
  const dirs = [
    process.env.KRAKEN_SKILLS_DIR,      // 环境变量最高优先级
    path.join(process.cwd(), 'skills'),
    path.join(os.homedir(), '.config', 'kraken', 'skills'),
    path.join(os.homedir(), '.kraken', 'skills'),
  ].filter(Boolean)

  const skills: Skill[] = []
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir)) {
      const skillPath = path.join(dir, entry)
      const skillMdPath = path.join(skillPath, 'SKILL.md')
      if (existsSync(skillMdPath)) {
        skills.push(parseSkill(skillMdPath))
      }
    }
  }
  return skills
}
```

## 4. Skill 激活机制

### 4.1 元数据常驻上下文

所有 Skill 的 `name` + `description` 始终保留在 System Prompt 中（约占总上下文 5%）：

```
## Available Skills

- **pdf-processor**: Process PDF files including text extraction, rotation, 
  form filling, and merging. Use when the user needs to work with PDF documents.

- **web-scraper**: Extract structured data from web pages using CSS selectors 
  or XPath. Use when the user needs to scrape or parse HTML content.

- **git-workflow**: Advanced Git operations including interactive rebase, 
  cherry-pick, and branch management. Use when the user needs complex Git help.
```

### 4.2 触发判定

每次用户发送消息时，由模型自行判断是否需要加载某个 Skill：

```
System Prompt 片段:

When you determine a skill is needed based on the user's request,
include its name in your reasoning. The system will automatically
load the skill's full instructions and resources into context.
```

**判定规则**（模型遵循）：
- 用户明确提到 Skill 名 → 直接加载
- 用户请求与某 Skill 的 `description` 匹配 → 建议加载
- 多 Skill 可能匹配时 → 优先加载最具体的那个

### 4.3 加载过程

```
用户输入 → 模型看到 Available Skills 列表 → 模型判定需要 "pdf-processor"
         → 系统加载 ./skills/pdf-processor/SKILL.md body
         → 模型在 SKILL.md 中看到 "详细 schema 见 references/schema.md"
         → 模型请求加载 references/schema.md
         → 两者合并注入当前上下文（作为 system prompt 追加）
```

## 5. 上下文注入方式

### 5.1 System Prompt 追加

Skill 加载后，其内容追加到 System Prompt 末尾：

```ts
class PromptBuilder {
  private loadedSkills: Skill[] = []

  loadSkill(skill: Skill) {
    this.loadedSkills.push(skill)
  }

  build(): string {
    const parts = [this.basePrompt]
    
    // 工具指南
    parts.push(this.buildAvailableTools())
    
    // 已加载 Skill 的指令
    for (const skill of this.loadedSkills) {
      parts.push(`\n## Skill: ${skill.name}\n${skill.body}`)
    }
    
    return parts.join('\n\n')
  }
}
```

### 5.2 Reference 按需加载

Reference 文件不自动注入上下文。模型在 SKILL.md 的指引下，显式请求读取：

```ts
// 伪代码：模型输出中包含读取请求
if (modelOutput.includes('READ_REFERENCE: references/schema.md')) {
  const content = fs.readFileSync(
    path.join(skillDir, 'references', 'schema.md'), 'utf8'
  )
  // 将 content 作为上下文追加
}
```

### 5.3 Script 直接执行

Scripts 不读入上下文，直接由系统执行：

```ts
// Skill 指令中可以引用脚本
// "使用 scripts/rotate_pdf.py 旋转 PDF"

const scriptPath = path.join(skillDir, 'scripts', 'rotate_pdf.py')
const result = await execAsync(`python3 ${scriptPath} ${args}`)
// result 作为 tool_result 返回给模型
```

## 6. Skill 与 Tool 的关系

| 维度 | Tool | Skill |
|---|---|---|
| **定义位置** | `src/tools/`（代码） | `skills/`（文档+脚本） |
| **能力类型** | 执行动作（读文件、运行命令） | 领域知识+工作流指导 |
| **实现方式** | TypeScript 函数 | Markdown 指令 + 可选脚本 |
| **运行时** | 每次调用都执行 | 加载一次，持续指导多轮对话 |
| **谁来写** | 开发者写代码 | 用户/开发者写 Markdown |

**协作方式**：
- Skill 告诉模型"什么时候用什么 Tool"
- Tool 提供底层执行能力
- Skill 的 scripts/ 可以补充 Tool 未覆盖的特定任务

## 7. 前端展示

### 7.1 配置面板

在 `/api/config` 返回的 config 中增加 `skills` 字段：

```json
{
  "model": "anthropic/claude-sonnet-4",
  "skills": [
    { "name": "pdf-processor", "loaded": false },
    { "name": "web-scraper", "loaded": true }
  ]
}
```

前端展示：
- Settings 面板新增 "Skills" 区域
- 列出所有可用 Skill，带开关可手动启用/禁用
- 显示当前已加载 Skill 的徽章（badge）

### 7.2 消息区标识

当某条消息触发了 Skill 加载时，在消息气泡旁显示 Skill 徽章：

```
[Kraken Avatar]  [消息内容...]  [pdf-processor]
```

## 8. 实施步骤

### Phase 1：Skill 扫描与解析（1 天）

1. 新增 `src/skills/registry.ts`
   - `discoverSkills()`: 按层级扫描 Skill 目录
   - `parseSkill(path)`: 解析 SKILL.md 的 YAML frontmatter + Markdown body
2. 新增 `src/skills/types.ts`
   - `Skill` 接口（name, description, body, dirPath）
3. 在 `src/server.ts` 启动时调用 `discoverSkills()`

### Phase 2：上下文注入（1 天）

1. 修改 `PromptBuilder`
   - 接受 `loadedSkills: Skill[]`
   - `build()` 中将 Skill body 追加到 system prompt
2. 修改 `ReActAgent`
   - 接受 `availableSkills: Skill[]`（仅元数据）
   - `run()` 时将元数据注入 system prompt
   - 根据模型输出动态加载 Skill（详见 Phase 3）

### Phase 3：动态加载协议（1.5 天）

1. 定义模型与系统的通信协议：
   - `LOAD_SKILL:<name>` — 模型请求加载某 Skill
   - `READ_REFERENCE:<path>` — 模型请求读取 reference 文件
2. 在 `loopQuery()` 或 `ReActAgent.run()` 中解析模型输出：
   - 如果输出包含 `LOAD_SKILL:xxx`，读取对应 SKILL.md 并重新构建 prompt
   - 如果输出包含 `READ_REFERENCE:xxx`，读取并追加到 messages
3. 重新调用模型（带新上下文）

### Phase 4：前端配置（0.5 天）

1. `/api/config` 返回 `skills` 列表
2. 前端 Settings 面板展示 Skill 开关
3. 可选：手动强制加载某 Skill（绕过模型判定）

### Phase 5：内置示例 Skill（0.5 天）

在 `skills/` 目录提供 1-2 个示例：

```
skills/
├── git-workflow/
│   ├── SKILL.md
│   └── references/
│       └── rebase-guide.md
└── pdf-processor/
│   ├── SKILL.md
│   ├── scripts/
│   │   └── rotate_pdf.py
│   └── references/
│       └── form-fields.md
```

## 9. 环境变量

```bash
# Skill 发现
KRAKEN_SKILLS_DIR=/path/to/custom/skills    # 覆盖默认发现路径

# Skill 激活
ENABLED_SKILLS=git-workflow,pdf-processor     # 强制启用指定 Skill（跳过模型判定）
DISABLED_SKILLS=web-scraper                   # 强制禁用某 Skill

# 调试
KRAKEN_SKILL_DEBUG=true                       # 打印 Skill 加载日志
```

## 10. 与现有系统的兼容性

- **Tool 系统不变**：Skill 不替代 Tool，而是指导 Tool 的使用
- **PromptBuilder 扩展**：在现有基础上追加 Skill 内容，不破坏已有逻辑
- **Session 持久化**：已加载的 Skill 列表存入 Session JSON，恢复会话时自动重载
- **沙箱方案兼容**：Skill 的 scripts/ 执行同样受 `sandbox-exec` 约束

## 11. 参考

- [Kimi Code CLI Skill Creator Guide](/Users/bill/Library/Application Support/Code/User/globalStorage/moonshot-ai.kimi-code/bin/kimi/_internal/kimi_cli/skills/skill-creator/SKILL.md)
- Kimi Code CLI 内置 skill 结构：`kimi-cli-help/`, `skill-creator/`
