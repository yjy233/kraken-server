# Gemini CLI `skill-creator` 调研（修正版）

> 基于 `~/code/gemini-cli` 真实源码的逐文件调研，修正了原文档中基于假设的推断，补充了实现细节、安全边界和代码层面的矛盾点。

---

## 1. 结论

`skill-creator` 在 Gemini CLI 里不是一个“自动安装器”或“运行时 skill 管理器”，它的核心作用是：

- 作为一个**内置 skill**，指导 agent 如何设计和编写高质量 skill
- 附带三个 **CommonJS 脚本**，覆盖 skill 生命周期的三个基础动作：
  - `init_skill.cjs` — 初始化目录骨架
  - `validate_skill.cjs` — 校验格式与命名
  - `package_skill.cjs` — 打包成 `.skill` 文件

它本质上是一个 **skill authoring toolkit**，不是 runtime activation 机制本身。运行时 discovery / activation 由 `skillLoader.ts` + `skillManager.ts` 负责。

---

## 2. 代码位置

### 核心 skill 与脚本

| 文件 | 作用 | 行数 |
|---|---|---|
| `packages/core/src/skills/builtin/skill-creator/SKILL.md` | 内置 skill 文档 | ~382 行 |
| `packages/core/src/skills/builtin/skill-creator/scripts/init_skill.cjs` | 脚手架生成器 | 239 行 |
| `packages/core/src/skills/builtin/skill-creator/scripts/validate_skill.cjs` | 静态校验器 | 131 行 |
| `packages/core/src/skills/builtin/skill-creator/scripts/package_skill.cjs` | 打包器 | 131 行 |

### 运行时

| 文件 | 作用 |
|---|---|
| `packages/core/src/skills/skillLoader.ts` | 扫描目录、解析 SKILL.md frontmatter |
| `packages/core/src/skills/skillManager.ts` | 聚合多来源 skill、优先级覆盖、激活态跟踪 |

### CLI 命令

| 文件 | 作用 |
|---|---|
| `packages/cli/src/commands/skills/install.ts` | 从 git repo 或本地路径安装 |
| `packages/cli/src/commands/skills/list.ts` | 列出已发现 skill |
| `packages/cli/src/commands/skills/link.ts` | 链接本地 skill 路径（开发热更新） |

### 测试

| 文件 | 覆盖内容 |
|---|---|
| `integration-tests/skill-creator-scripts.test.ts` | 完整生命周期：init → validate → package |
| `integration-tests/skill-creator-vulnerabilities.test.ts` | 命令注入、路径穿越、空 description 崩溃 |

---

## 3. `SKILL.md` 的真实内容

### 3.1 一个有趣的矛盾

`SKILL.md` **自己就是 382 行**，非常接近它自己建议的“500 行上限”。而且它的模板（通过 `init_skill.cjs` 生成）**极其冗长**，包含大量 TODO 占位符和引导文本——这与它反复强调的“concise is key”原则形成明显矛盾。

这说明：**原则是对的，但执行层面为了降低新手门槛，选择了“ verbose template + validate 兜底”的折中方案。**

### 3.2 核心设计原则（文档原文）

1. **简洁优先**：context window 是公共资源，只加入模型确实不知道的信息
2. **自由度分层**：
   - 高自由度 → 文本指导
   - 中自由度 → 伪代码或可参数化脚本
   - 低自由度 → 固定脚本和具体流程
3. **Progressive Disclosure**：
   - Level 1: metadata（`name` + `description`）始终占用上下文
   - Level 2: `SKILL.md` body 只在 skill 触发后加载
   - Level 3: `scripts/`、`references/`、`assets/` 按需读取或执行

### 3.3 frontmatter 严格约束

- 只允许 `name` 和 `description` 两个字段
- `description` **必须是单行字符串**（这是硬性约束，validator 会检查）
- `description` 是 skill 触发判断的唯一依据，必须包含"何时使用"
- 禁止任何旁支文件（README.md、CHANGELOG.md 等）

---

## 4. 三个脚本的实现细节

### 4.1 `init_skill.cjs` — 脚手架生成器

**命令格式：**
```bash
node init_skill.cjs <skill-name> --path <base-path>
```

**安全边界：**
- 拒绝包含 `path.sep`、`/`、`\` 的 skill 名
- 解析后验证 `skillDir.startsWith(basePath)`，防止路径穿越
- 目标目录已存在时拒绝覆盖

**生成内容：**
- `SKILL.md`（含 4 种结构模式模板：Workflow-Based / Task-Based / Reference/Guidelines / Capabilities-Based）
- `scripts/example_script.cjs`（可执行，mode `0o755`）
- `references/example_reference.md`
- `assets/example_asset.txt`

**注意：** `init_skill.cjs` **不验证 skill 名格式**（如 `^[a-z0-9-]+$`），只检查路径安全。格式验证留给 `validate_skill.cjs`。

### 4.2 `validate_skill.cjs` — 静态校验器

**验证规则（按顺序，硬失败即退出）：**

| 检查项 | 规则 |
|---|---|
| 路径存在 | 必须是已存在的目录 |
| SKILL.md | 必须存在 |
| frontmatter 格式 | 必须以 `---` 开头，至少 3 个 `---` 分隔符 |
| name | 必须存在（正则 `/^name:\s*(.+)$/m`） |
| description | 必须存在（支持单引号/双引号/无引号三种格式） |
| description 单行 | 不能包含换行符 |
| name 格式 | 必须符合 `/^[a-z0-9-]+$/` |
| description 长度 | ≤ 1024 字符 |
| TODO 扫描 | 递归扫描所有文件（除 `node_modules`、`.git`、`__pycache__`），发现 `TODO:` 子串则 warning |

**TODO 检测的真实实现：**

```js
// 极其简单，只是子串匹配
if (content.includes('TODO:')) { /* warning */ }
```

- **不区分大小写？** 不，`includes('TODO:')` 是大小写敏感的，所以 `todo:` 不会触发
- **没有词边界检查**：`NOTODO:` 或 `AUTODO:` 都会触发
- **package_skill.cjs** 会把 TODO warning 视为不可打包状态

**返回格式：**
```js
{ valid: true, message, warning? }   // 有 TODO 时带 warning
{ valid: false, message }            // 硬失败
```

### 4.3 `package_skill.cjs` — 打包器

**命令格式：**
```bash
node package_skill.cjs <skill-folder> [output-directory]
```

**流程：**
1. 调用 `validateSkill()`
2. `valid === false` → 直接失败
3. `warning` 存在（有 TODO）→ 也拒绝打包
4. 打包为 `<skillName>.skill`（本质是 zip）

**平台感知的打包命令：**

```js
// 1. 优先尝试 zip
zip -r <output> .

// 2. Windows fallback
Compress-Archive -Path '.' -DestinationPath '<output>.zip'
// 然后重命名为 .skill

// 3. Unix fallback
tar -a -c --format=zip -f <output> .
```

**关键安全细节：**
- 打包时 `cwd` 设为 skill 目录内部，用 `.` 作为源，避免多包一层父目录
- 两个参数都检查 `..` 路径穿越
- ⚠️ **`stdio: 'inherit'` 的隐患**：`zip` 命令直接继承 stdio，如果 skill 目录名包含 shell 元字符，理论上存在命令注入风险（虽然 `..` 检查提供了部分保护）

---

## 5. 运行时加载机制（真实实现）

### 5.1 `skillLoader.ts`

**SkillDefinition 接口：**
```ts
interface SkillDefinition {
  name: string
  description: string
  location: string
  body: string
  disabled?: boolean
  isBuiltin?: boolean
  extensionName?: string
}
```

**扫描策略：**
- 使用 `glob` 匹配 `SKILL.md` 和 `*/SKILL.md`
- **只扫描一层深度**（`*/SKILL.md` 不匹配嵌套子目录）
- 忽略 `**/node_modules/**`、`**/.git/**`

**frontmatter 解析（两级容错）：**

1. **主解析器**：`js-yaml.load()` 标准 YAML 解析
2. **Fallback 解析器**：手动行解析，专门处理 description 含冒号导致 YAML 解析失败的情况
   - 支持多行 description（通过缩进续行）

**name sanitization：**
```ts
frontmatter.name.replace(/[:\\/<>*?"|]/g, '-')
```
- 只做**文件系统安全替换**，不强制 hyphen-case
- 格式强制（`^[a-z0-9-]+$`）只在 validator 中执行

**loader 比 validator 更宽容：** 这是刻意的设计——loader 负责“能读就读”，validator 负责“policy 把关”。

### 5.2 `skillManager.ts`

**发现优先级（低到高，后覆盖先）：**

```
1. built-in skills
2. extension skills
3. user skills          (~/.gemini/skills/)
4. user agent alias     (~/.agents/skills/)
5. workspace skills     (./.gemini/skills/)   ← 仅在 isTrusted === true 时启用
6. workspace agent alias (./.agents/skills/)
```

**关键行为：**
- 同名 skill：后加入覆盖先加入（Map 去重）
- built-in 被外部覆盖时会告警（`debugLogger.warn`）
- 非 built-in 之间的冲突也会反馈 warning
- **Workspace skill 有信任门槛**：如果 `isTrusted === false`，workspace skills 完全被跳过（安全边界）
- 维护 `activeSkillNames: Set<string>` 跟踪激活态

**接口方法：**
```ts
getSkills()           // 仅 enabled
getDisplayableSkills() // enabled + 非 built-in
getAllSkills()        // 所有已发现
getSkill(name)        // 大小写不敏感查找
setDisabledSkills(names)
activateSkill(name) / isSkillActive(name)
```

---

## 6. CLI 命令的真实实现

### 6.1 `skills install`

- **来源**：git repository URL 或本地路径
- **Scope**：`user`（默认）或 `workspace`
- **Consent 机制**：
  - 默认交互式：显示 `skillsConsentString()` 生成的描述，等待用户确认
  - `--consent` 标志：非交互式，打印 consent 信息后自动继续
- 实际安装逻辑委托给 `skillUtils.installSkill()`

### 6.2 `skills list`

- 默认**过滤掉 built-in**，加 `--all` 才显示
- 排序：非 built-in 优先，然后按字母序
- 显示字段：`name [Enabled/Disabled] [Built-in]` + description + location

### 6.3 `skills link`

- 将本地路径**链接**（而非复制）到 user/workspace scope
- 适合开发时热更新
- 同样走 consent 机制
- `isLink: true` 会改变 consent 描述文本

---

## 7. 测试揭示的真实设计意图

### 7.1 生命周期闭环测试

`skill-creator-scripts.test.ts` 覆盖：

```
init → validate (TODO warning) → package (fail)
  ↓
清理所有 TODO → validate (pass) → package (success)
  ↓
验证 zip 内容：不包含嵌套目录（skillName/SKILL.md）
```

TODO 清理用的正则比 validator 更激进：
```js
/TODO:[^\n]*/g      // 行内 TODO
/\[TODO:[^\]]*\]/g // [TODO: ...] 格式
```

### 7.2 安全边界测试

`skill-creator-vulnerabilities.test.ts` 覆盖 4 个场景：

| 测试 | 实际做法 | 评价 |
|---|---|---|
| package 命令注入 | 恶意文件名作为第 3 个 CLI 参数传入 | ⚠️ **有缺陷** — 脚本只接收 2 个 positional args，第 3 个被忽略，没有真正测试到注入向量 |
| init 路径穿越 | `../traversal-success` 作为 skill 名 | ✅ 正确测试了 — 被路径分隔符检查拦截 |
| validate 路径穿越 | `../../../../etc/passwd` 作为路径参数 | ✅ 正确测试了 — 被 `..` 检查拦截 |
| 空 description 崩溃 | `description: ""` | ✅ 正确测试了 — 验证 regex 不会因空字符串导致 `.trim()` 崩溃 |

**结论：** 安全测试覆盖了基本边界，但 command injection 测试的测试向量选择不够精准。

---

## 8. 对 Kraken 的参考价值（修正版）

### 8.1 值得借鉴的设计

1. **把“写 skill”本身做成一个 skill**
   - 不只是文档约定，而是可触发的 agent 工作流

2. **作者工具链三件套**
   - `init` → `validate` → `package` 形成完整闭环
   - 特别是 validate 把格式问题前置，减少运行时错误

3. **Loader 宽容 + Validator 严格的分离设计**
   - loader：能读就读，fallback 解析
   - validator：policy 把关，TODO 扫描

4. **Progressive Disclosure 的三级加载**
   - metadata 常驻 → body 触发加载 → resources 按需读取

5. **Trust-based workspace 隔离**
   - workspace skill 只在 trusted workspace 下启用，防止恶意项目注入 skill

6. **link 模式**
   - 开发时比复制安装更高效，支持热更新

### 8.2 需要警惕的坑

| 坑 | 说明 |
|---|---|
| TODO 检测过于简单 | `includes('TODO:')` 容易误报，且大小写敏感导致漏检 |
| init 模板过于冗长 | 与"简洁优先"原则矛盾，需要大量清理工作 |
| 命令注入测试覆盖不足 | 测试向量没有真正触及风险点 |
| glob 只扫描一层 | `*/SKILL.md` 不匹配深层嵌套 skill |

### 8.3 Kraken 当前实现 vs Gemini CLI

| 维度 | Kraken（当前） | Gemini CLI |
|---|---|---|
| 发现层级 | 3 层（命令行 → 项目 → 用户） | 6 层（built-in → extension → user → user alias → workspace → workspace alias） |
| 内置 skill | ❌ 无 | ✅ 有 |
| 作者工具链 | ❌ 无 | ✅ init + validate + package |
| link 模式 | ❌ 无 | ✅ 有 |
| Trust 隔离 | ❌ 无 | ✅ workspace skill 受信任控制 |
| 激活机制 | 模型输出 LOAD_SKILL 指令 | 模型推理 + 用户显式启用 |
| 前端展示 | ✅ Skills 区域 + loaded 状态 | CLI list 命令 |
| TODO 扫描 | ❌ 无 | ✅ validate 时扫描 |
| frontmatter 解析 | 简单正则 | js-yaml + fallback |

### 8.4 对 Kraken 的补强建议（按优先级）

1. **增加 built-in skill 体系**
   - 把 `skill-creator` 作为第一个内置 skill
   - 放在 `src/skills/builtin/` 或打包进产物

2. **提供作者工具链脚本**
   - `scripts/init-skill.ts` — 脚手架
   - `scripts/validate-skill.ts` — frontmatter + TODO 扫描
   - `scripts/package-skill.ts` — 打包为 `.skill`

3. **frontmatter 解析升级**
   - 引入 `js-yaml` 做主解析，保留正则 fallback
   - 支持单引号/双引号/无引号 description

4. **增加 trust 机制**
   - workspace skill 默认不加载，需要用户显式信任

5. **TODO 扫描增强**
   - 用正则替代简单子串匹配，支持大小写不敏感

6. **link 模式**
   - `skill_install` tool 支持 symlink 而非复制

---

## 9. 一句话总结

Gemini CLI 的 `skill-creator` 不是 runtime 组件，而是**作者工具链**：

- 一套写作原则（Progressive Disclosure、简洁优先）
- 一个目录模板生成器（`init_skill.cjs`）
- 一个静态校验器（`validate_skill.cjs`，含 TODO 扫描）
- 一个打包器（`package_skill.cjs`，平台感知 zip）

运行时则由 `skillLoader.ts`（宽容解析）+ `skillManager.ts`（优先级覆盖 + trust 隔离 + 激活态跟踪）负责。这套分层设计比单纯写规范更可执行，也更具安全边界意识。

---

## 10. 把 Gemini CLI 的设计映射到 `kraken-server`

这一节不是泛泛对比，而是直接按 Kraken 当前代码结构来看“已经有什么、缺什么、应该怎么接”。

### 10.1 Kraken 当前已经具备的能力

Kraken 目前已经有一套最小可用 runtime skill 系统：

- discovery / parse
  - `src/skills/registry.ts`
- runtime cache / refresh
  - `src/skills/manager.ts`
- install tool
  - `src/tools/skill-install.ts`
- activate / read reference
  - `src/tools/skill.ts`
- prompt 中暴露 discovered skills metadata
  - `src/agent/prompt-builder.ts`
- session 级激活态持久化
  - `src/server.ts`
- 前端显示 available / active skills
  - `src/frontend/components/Sidebar.tsx`

结论：

- Kraken 已经有 runtime half
- 缺的是 authoring half

### 10.2 Kraken 当前和 Gemini CLI 的关键差异

#### 差异 1：Kraken 没有 built-in skill 体系

Gemini CLI 有：

- built-in skills
- extension skills
- user skills
- workspace skills

Kraken 当前只有目录扫描，没有 built-in 层。

影响：

- `skill-creator` 这种“系统级 skill”目前只能作为普通 skill 放在仓库 `skills/` 里
- 不能稳定区分系统 skill 和用户 skill

#### 差异 2：Kraken 安装链路已经比 Gemini 更 agent-centric

Gemini CLI 的 install 是 CLI 命令：

- `skills install`
- `skills link`
- `skills list`

Kraken 的 install 是运行时 tool：

- `skill_install`

这有一个很关键的产品差异：

- Gemini CLI 偏人工运维
- Kraken 偏 agent 自主执行

所以 Kraken 不应该简单抄 Gemini CLI 的 CLI UX，而应该抄它背后的 authoring / validation / linking 能力。

#### 差异 3：Kraken 激活结果过于轻量

当前 `src/tools/skill.ts` 在 `activate` 时只返回：

- `Activated skill: ...`
- `Description: ...`
- `skill.body`

Gemini CLI 的 `activate-skill.ts` 还会返回：

- skill 目录结构
- 可用资源摘要
- 并把 skill 目录加入可读上下文

这意味着 Kraken 当前模型在激活后，知道“有这个 skill”，但不知道 skill 资源的结构边界。

#### 差异 4：Kraken 没有 link 模式

当前 `src/skills/install.ts` 只有 copy-install：

- 下载
- 解压
- 复制 skill 目录

没有类似 Gemini CLI `linkSkill()` 的符号链接模式。

影响：

- 本地开发 skill 时需要重复安装
- 不适合调试 `skills/` 目录里的实验性 skill

#### 差异 5：Kraken 的 parser 比 Gemini validator 更弱

当前 `src/skills/registry.ts` 的 `parseSkillFile()` 只保证：

- 有 frontmatter
- 有 `name`
- 有 `description`

但缺：

- name 正则
- description 长度限制
- TODO 检测
- 独立 validate 输出
- 更宽容的 YAML 主解析 + fallback 解析

这也是为什么现在 Kraken 的 skill authoring 体验还不稳。

## 11. 在 Kraken 里应该怎么实现

### 11.1 设计目标

目标不应该是“把 Gemini CLI 原样搬过来”，而应该是：

1. 保留 Kraken 当前 agent runtime skill 体系
2. 补齐 skill authoring toolkit
3. 补齐本地开发模式
4. 让前端和 agent 都能消费同一套 skill 元数据

### 11.2 推荐的实现分层

建议把 Kraken skill 能力拆成四层。

#### 第 1 层：skill runtime

这层你们已经基本有了：

- discovery
- install
- activate
- read reference
- session loadedSkills

主要需要小修，不需要推翻。

#### 第 2 层：skill authoring toolkit

这一层当前没有，建议新增：

- `init-skill`
- `validate-skill`
- `package-skill`

位置建议：

- `src/skills/authoring/`
  或
- `scripts/skills/`

职责建议：

- `init-skill`
  - 创建 skill 目录骨架
  - 生成标准 `SKILL.md`
  - 生成空目录：`scripts/` `references/` `assets/`
- `validate-skill`
  - 校验 frontmatter
  - 校验 name 格式
  - 校验 description
  - 校验 TODO
  - 校验资源目录结构
- `package-skill`
  - 输出 `.skill` zip 包
  - 可选打 `_meta.json`

这是最值得优先做的部分。

#### 第 3 层：skill development mode

这一层建议新增：

- `skill_link`
  或
- 给 `skill_install` 增加 `action="link"`

功能：

- 将本地 skill 目录 symlink 到 install root
- 提供开发中的热更新体验

Gemini CLI 在这层做得比你们成熟很多，Kraken 很值得补。

#### 第 4 层：skill metadata / inspect / UI

建议把 skill 的元数据做成稳定接口，而不是只在 install 输出里拼字符串。

建议新增：

- `Skill` 结构扩展字段
  - `sourceType?`
  - `sourceValue?`
  - `installedAt?`
  - `installMode?`
- API：
  - `GET /api/skills`
  - `POST /api/skills/reload`
  - `POST /api/skills/validate`

前端可以基于这些字段显示：

- install root
- source
- install mode
- active / available

## 12. 对 Kraken 代码的具体改造建议

### 12.1 `src/skills/types.ts`

建议把 `Skill` 从纯 runtime 结构扩成：

```ts
interface Skill {
  name: string
  description: string
  body: string
  dirPath: string
  meta?: {
    sourceType?: 'github' | 'clawhub' | 'local' | 'link'
    sourceValue?: string
    installedAt?: string
    installMode?: 'copy' | 'link'
  }
}
```

原因：

- install / inspect / UI 需要稳定元数据
- 不应该靠 `read_file _meta.json` 让 agent 自己拼

### 12.2 `src/skills/registry.ts`

建议补两类能力：

#### A. 更稳的 frontmatter 解析

当前实现够用，但建议升级成：

- YAML 主解析
- 简单 fallback

这样更接近 Gemini CLI 的 loader 设计。

#### B. 增加 `validateSkillDir()`

不要把 validate 做成 install 里的内联逻辑。

建议抽成独立函数：

- `validateSkillDir(dirPath): ValidationResult`

这样：

- authoring 脚本可复用
- API 可复用
- `skill_install` 可复用

### 12.3 `src/skills/install.ts`

当前 install 已经比较完整，但建议再补：

#### A. 写安装元数据

安装成功后写：

- `_meta.json`

字段：

- `name`
- `sourceType`
- `sourceValue`
- `installedAt`
- `installMode`

#### B. 支持 link

新增：

- `linkSkillFromLocalDir()`

逻辑参考 Gemini CLI：

- 校验 sourceDir
- 检查目标是否存在
- 创建 symlink

#### C. 统一路径规范化

当前 `KRAKEN_SKILLS_DIR` 的 `~` 展开还没做全。

建议这里统一接 `expandHomePath()`，而不是只靠调用方自觉传绝对路径。

### 12.4 `src/tools/skill.ts`

这里最值得补的是 activate 返回值。

建议 `activate` 返回：

- `Description`
- `Instructions`
- `Skill Root`
- `Resources`
  - `scripts/*`
  - `references/*`
  - `assets/*`

这不需要读文件内容，只需要目录摘要。

这样模型激活 skill 后，下一步更容易知道要不要去读 reference 或执行脚本。

### 12.5 `src/tools/skill-install.ts`

当前可以继续保留，但建议加两个 action：

- `link`
- `validate_local`

示例：

```json
{ "action": "link", "path": "/abs/path/to/skill" }
{ "action": "validate_local", "path": "/abs/path/to/skill" }
```

这样 agent 在创建 / 调试 skill 时可以闭环工作。

### 12.6 `src/agent/prompt-builder.ts`

当前 prompt 已经会告诉模型：

- available skills 有哪些
- 需要时用 `skill.activate`
- 安装时用 `skill_install`

如果要接 `skill-creator`，建议再补两条：

- 当用户要求创建或更新 skill 时，优先使用 `skill-creator`
- 在创建 skill 后，先 validate，再 install / link

这样模型才会真正走 authoring 链路，而不是随手 mkdir + 写文件。

### 12.7 `src/frontend`

前端建议最少补两个地方。

#### A. config 类型扩展

`src/frontend/types.ts` 的 `SkillInfo` 目前只有：

- `name`
- `description`

后续应补：

- `dirPath`
- `sourceType`
- `installMode`
- `installedAt`

#### B. sidebar / settings 扩展

当前 `Sidebar` 只显示：

- Active Skills
- Available Skills

建议增加：

- install root
- source / install mode
- validate / reload / inspect 入口

## 13. 推荐的落地顺序

这是我认为最务实的顺序。

### Phase A：先补 authoring

先做：

1. `skill-creator` skill
2. `init-skill`
3. `validate-skill`

原因：

- 立刻提升创建 skill 的质量
- 风险低
- 不依赖前端改造

### Phase B：再补 dev workflow

再做：

4. `skill_link`
5. `_meta.json`
6. `GET /api/skills`

原因：

- 开始解决“调 skill 很痛苦”的问题
- 能给 UI 提供稳定数据

### Phase C：最后补 UI 和更强 runtime

最后做：

7. sidebar / settings 展示 install 信息
8. `skill.activate` 返回目录摘要
9. `reload` / `validate` API

原因：

- 这是体验增强，不是生死线
- 放后面做更合适

## 14. 对你的当前问题的直接回答

如果你问的是“仔细研究后，Kraken 最应该怎么做”，我的结论是：

- 先修正 Kraken skill 底座里的路径与发现一致性问题
- 不要优先继续扩 `skill_install`
- 也不要先做复杂 built-in 系统
- 最应该先做的是：
  - `skill-creator`
  - `init-skill`
  - `validate-skill`
  - `skill_link`

因为 Kraken 现在真正缺的是“如何稳定地产生和调试 skill”，不是“如何再多装一种来源”。

## 15. Kraken 当前请求链路到底是怎么跑的

这一段很重要，因为 Gemini CLI 是 CLI-first，而 Kraken 是 server-first。要在 Kraken 里实现 `skill-creator`，必须先看真实调用链。

### 15.1 运行时链路

用户发消息后，Kraken 当前链路是：

1. `src/server.ts`
   - 读取 session
   - 恢复 `session.loadedSkills`
   - 读取当前 `getAvailableSkills()`
   - 调 `createToolRegistry(...)`
2. `src/agent/prompt-builder.ts`
   - 把所有 discovered skills 的 `name + description` 注入 system prompt
3. 模型开始推理
   - 如果需要已有 skill，就调 `skill`
   - 如果缺 skill，就调 `skill_install`
4. `src/tools/skill.ts`
   - `activate` 时把 skill 名写进 `ctx.skillState.loadedSkillNames`
   - 返回 `description + skill.body`
5. `src/agent/react-agent.ts`
   - 结束时把 `loadedSkillNames` 带回 server
6. `src/server.ts`
   - 把 `result.loadedSkills` 写回 session JSON

结论：

- Kraken 当前 skill 系统是“prompt 暴露 metadata + tool 完成安装/激活 + session 持久化激活态”
- 它已经有完整 runtime 闭环
- `skill-creator` 要补的是“创建 skill 的闭环”，不是运行时闭环

### 15.2 这意味着什么

在 Kraken 里实现 Gemini 风格 `skill-creator`，最自然的接法不是先做新 prompt 黑魔法，而是：

- 让模型继续通过现有 `skill` / `skill_install` 工作
- 新增一套 authoring 能力供模型调用或指导使用
- 把“创建 skill”也变成一条可重复的工作流

也就是说，Kraken 需要的是：

- runtime skill system
- authoring skill system

而不是把两者混成一个大而全的安装器。

## 16. Kraken 当前代码里要先认清的两个底座问题

这一部分是我这次再仔细看后确认的。它们不是“优化项”，而是后面做 `skill-creator` 前最好先收口的问题。

### 16.1 install root 和 discovery root 已收口到 workspace

当前实现已经调整为：

- `src/skills/manager.ts`
  - `refreshSkills(extraDirs)` 可把当前 workspace skill dir 加入 runtime discovery
- `src/tools/skill-install.ts`
  - 默认安装到 `<workspace>/skills`
- `src/skills/install.ts`
  - 仍支持显式 `installRoot`，由工具侧传入 workspace skills dir
- `src/skills/registry.ts`
  - discovery 目录是：
    - runtime workspace dirs such as `<workspace>/skills`
    - `KRAKEN_SKILLS_DIR`
    - repo built-in `skills`
    - `~/.config/kraken/skills`
    - `~/.kraken/skills`

现在 install 和 discover 已在 workspace 层收口，`skill_install` 产出的 skill 会通过 `refreshSkills([<workspace>/skills])` 立即进入运行时 registry。

### 16.2 `KRAKEN_SKILLS_DIR` 的 `~` 展开也没有统一做

当前 `src/skills/manager.ts`：

```ts
return path.resolve(process.env.KRAKEN_SKILLS_DIR || defaultInstallRoot)
```

这只做了 `path.resolve()`，没有做 home expansion。

所以如果 `.env` 里写：

```bash
KRAKEN_SKILLS_DIR=~/code/kraken-server/skills
```

得到的结果会像：

```text
/current/working/dir/~/code/kraken-server/skills
```

这正好解释了你之前看到的异常安装路径。

结论：

- Kraken skill 系统现在已经不只是“缺作者工具链”
- 它还有“路径规范化职责散落、发现与安装不完全一致”的底座问题

## 17. 在 Kraken 里怎么实现，应该分成两个阶段

如果按工程风险来排，我建议不要一步做到 Gemini 那么重，而是分两阶段。

### 17.1 第一阶段：先做可用的 authoring v1

目标：

- 让 Kraken 能稳定创建、校验、调试 skill
- 不要求一上来就 built-in、多来源、完整 UI

建议实现：

1. 新增 repo 内 skill：`skills/skill-creator/SKILL.md`
   - 先作为普通可发现 skill 存在
   - 不依赖 built-in 系统
2. 新增 authoring 模块：
   - `src/skills/authoring/init.ts`
   - `src/skills/authoring/validate.ts`
   - `src/skills/authoring/package.ts`
3. 新增可复用 API：
   - `initSkill(...)`
   - `validateSkillDir(...)`
   - `packageSkillDir(...)`
4. 扩展 `skill_install`：
   - `action="validate_local"`
   - `action="link"`
5. 扩展 `skill.activate` 返回值
   - 加 skill 根目录
   - 加 `scripts/` / `references/` / `assets/` 目录摘要

这样做的好处：

- 你不用先改 discovery 架构
- 也不用先引入 built-in 层
- 先把“创建 skill 的闭环”跑通

### 17.2 第二阶段：再做 productized v2

当 v1 跑顺后，再补：

1. built-in skill discovery
2. `_meta.json` 安装元数据
3. `GET /api/skills`
4. `POST /api/skills/validate`
5. 前端 skill 管理 UI
6. 可选的 trusted workspace skill 机制

这样顺序更对，因为：

- v1 解决“能不能稳定做”
- v2 解决“产品形态是否完整”

## 18. 一个更贴近 Kraken 的最小实现蓝图

如果让我按这个仓库当前结构直接落，我会这样拆。

### 18.1 模块拆分

#### A. `src/skills/authoring/init.ts`

职责：

- 校验 skill name
- 解析 base dir
- 创建目录骨架
- 生成最小 `SKILL.md`
- 可选创建空的 `scripts/` `references/` `assets/`

注意：

- 不要照抄 Gemini 的超长模板
- Kraken 第一版应该用短模板
- 模板重点写“何时使用 this skill”，不要堆大段教学文字

#### B. `src/skills/authoring/validate.ts`

职责：

- 校验 `SKILL.md` 是否存在
- 校验 frontmatter
- 校验 `name`
- 校验 `description`
- 扫描 TODO
- 输出结构化结果

建议输出：

```ts
interface SkillValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  skill?: {
    name: string
    description: string
    dirPath: string
  }
}
```

这样这个结果可以同时给：

- `skill_install`
- 后端 API
- 前端 UI
- agent 最终消息

#### C. `src/skills/authoring/package.ts`

职责：

- 调 `validateSkillDir()`
- 失败直接拒绝打包
- 成功后输出 `.skill`

Kraken 第一版可以简单一些：

- 优先 shell 调系统 `zip`
- 如果不想引入平台差异，也可以只支持当前开发环境
- 但接口层先统一，后面再补跨平台 fallback

#### D. `src/tools/skill-install.ts`

建议新增 action：

- `validate_local`
- `link`

其中：

- `validate_local` 负责调用 `validateSkillDir()`
- `link` 负责把本地 skill 目录 symlink 到 install root

这一步非常关键，因为没有 `link`，skill 开发体验会一直很差。

#### E. `skills/skill-creator/SKILL.md`

这是最接近 Gemini CLI 思路的部分。

它的职责不是执行安装，而是教模型如何：

1. 先澄清 skill 的目标和触发语境
2. 规划要不要放 `scripts/` / `references/` / `assets/`
3. 优先生成短而有效的 `SKILL.md`
4. 创建后先 validate
5. 调试阶段优先 link，不要每次都 install copy

这才是真正的“把写 skill 本身做成一个 skill”。

### 18.2 为什么我不建议你现在先做 built-in

因为按 Kraken 当前代码，先做 built-in 并不能立刻解决你的核心问题。

你现在真正缺的是：

- skill 如何被稳定创建
- skill 如何被稳定校验
- skill 如何被快速调试

而不是：

- skill 究竟来自 built-in 还是 repo-local

所以第一步把 `skills/skill-creator` 放在仓库 `skills/` 目录里，已经足够验证整条链路。

### 18.3 最小落地顺序

如果下一步开始写代码，我建议严格按这个顺序：

1. 统一 install/discovery/path expansion
2. 落 `validateSkillDir()`
3. 落 `initSkill()`
4. 扩 `skill_install action=validate_local`
5. 落 `skills/skill-creator/SKILL.md`
6. 扩 `skill_install action=link`
7. 最后再做 `packageSkillDir()`

原因很简单：

- `validate` 是整个 authoring 体系的地基
- `link` 是开发体验的核心
- `package` 反而可以最晚补
