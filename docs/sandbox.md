# Kraken Agent 沙箱方案（A + B，支持 Session 级配置）

> 面向当前仓库的落地版方案。
> A = 应用层路径与权限控制。
> B = macOS `sandbox-exec` 保护 `shell_command` 子进程。

## 1. 目标

Kraken Agent 具备文件读写、Shell 命令执行、网络请求等工具能力。在自动执行用户指令时，需要优先解决以下问题：

- 防止误删或误写宿主机文件
- 防止通过 `../`、绝对路径或符号链接访问敏感目录
- 限制 `shell_command` 对宿主机文件系统的直接访问
- 允许用户按 session 配置工作目录与额外可读目录

本方案的定位是“轻量、可维护、适合当前仓库快速落地”的本地沙箱，不追求虚拟机级别强隔离。

## 2. 核心规则

### 2.1 默认工作区

- 默认 `workspaceRoot` 为 `~/kraken`
- 在服务端实际解析时，`~` 应展开为 `os.homedir()`
- `workspaceRoot` 是默认写入根目录，也是 `shell_command` 的默认 `cwd`

也就是说，在一台 macOS 机器上，默认工作区会解析为：

```text
$HOME/kraken
```

### 2.2 Session 级配置

每个 session 可以通过前端传入可选的沙箱配置。建议结构：

```ts
interface SessionSandboxConfig {
  workspaceRoot?: string
  readRoots?: string[]
}
```

含义：

- `workspaceRoot`
  - 可选
  - 不传时默认使用 `~/kraken`
- `readRoots`
  - 可选
  - 表示当前 session 额外允许读取的目录列表

### 2.3 不传 session 配置时的默认行为

如果前端没有给当前 session 传 `sandbox` 配置，则采用默认宽松读策略：

- 允许读取宿主机上的非敏感目录内容
- 仍然禁止读取敏感目录
- 写入仍然限制在 `workspaceRoot`

这条规则非常重要：

- “不传配置”不等于“完全无沙箱”
- 默认放宽的是“读取范围”
- 默认不放宽“写入范围”

### 2.4 敏感目录

无论 session 是否传配置，以下目录都视为敏感目录，默认拒绝访问：

- `~/.ssh`
- `~/.aws`
- `~/.gnupg`
- `~/.config/gcloud`
- `~/.config/gh`
- `~/Library/Keychains`
- `/etc`
- `/private/etc`

服务端应允许通过环境变量追加黑名单，但不建议前端 session 配置覆盖这份 denylist。

## 3. 为什么采用 A + B

当前仓库已经有一层“项目根目录边界”，但仍存在明显缺口：

- 文件工具各自实现 `resolveProjectPath`，逻辑分散
- `replace` 当前会直接改盘，且未受 `ALLOW_FILE_WRITE_TOOL` 保护
- `grep`、`glob` 也在读文件，但没有纳入统一沙箱模块
- `shell_command` 直接以 `shell: true` 执行命令，子进程继承完整 `process.env`

因此采用两层方案：

- A 层负责统一判定“这个路径能不能读、能不能写”
- B 层负责把 `shell_command` 放进 macOS Seatbelt 里执行

这两层的职责不同，必须同时存在：

- 只有 A，没有 B：Shell 仍能直接访问宿主机
- 只有 B，没有 A：Node 进程内的文件工具仍可能误操作不该碰的路径

## 4. 总体架构

```text
┌────────────────────────────────────────────────────┐
│ Kraken Agent Server                                │
│ Express / Agent Loop / Session Persistence         │
│ 不进入 sandbox-exec                                │
└────────────────────────────────────────────────────┘
                       │
           ┌───────────┴───────────┐
           ▼                       ▼
┌────────────────────┐    ┌─────────────────────────┐
│ A. 文件工具         │    │ B. shell_command        │
│ read/write/list     │    │ sandbox-exec 包裹       │
│ grep/glob/replace   │    │ cwd = workspaceRoot     │
│ 统一读写策略         │    │ env = filteredEnv       │
└────────────────────┘    └─────────────────────────┘
           │                       │
           ▼                       ▼
   SessionSandboxPolicy      SessionSandboxPolicy
```

说明：

- Server 进程本身不进入 Seatbelt；真正受 B 层约束的是 Shell 子进程
- A 层覆盖所有本地文件读写与遍历工具
- `search`、`web_fetch` 属于网络工具，不属于本次文件沙箱范围
- `.sessions` 默认继续由 Server 管理，不暴露给 Agent 工具

## 5. 目录与策略模型

### 5.1 默认目录模型

```text
~/kraken/
├── .sandbox/
│   ├── tmp/
│   └── profiles/
└── ... agent workspace files ...
```

说明：

- `~/kraken` 是默认 `workspaceRoot`
- `~/kraken/.sandbox/tmp` 用于 Shell 或工具的临时文件
- `~/kraken/.sandbox/profiles` 用于生成 session 级 `sandbox-exec` profile

### 5.2 两种读取模式

本方案定义两种读取模式：

#### Mode A: Session Allowlist Read

当前端给 session 传了 `sandbox.readRoots` 时：

- 可读目录 = `workspaceRoot` + `readRoots`
- 敏感目录始终拒绝
- 写入目录 = `workspaceRoot`

#### Mode B: Default Host Read

当前端没有给 session 传 `sandbox.readRoots` 时：

- 可读目录 = 宿主机全局可读范围 - 敏感目录
- 相对路径仍然默认相对于 `workspaceRoot`
- 写入目录 = `workspaceRoot`

因此，`readRoots` 的作用不是“开启读取能力”，而是把 session 切换为更明确的 allowlist 模式。

### 5.3 环境变量建议

```bash
DEFAULT_WORKSPACE_ROOT=~/kraken
ENABLE_PATH_SANDBOX=true
ENABLE_SEATBELT=true
ALLOW_SHELL_TOOL=true
ALLOW_FILE_WRITE_TOOL=true
SENSITIVE_PATHS=$HOME/.ssh,$HOME/.aws,$HOME/.gnupg,$HOME/.config/gcloud,$HOME/.config/gh,/etc,/private/etc,$HOME/Library/Keychains
```

补充说明：

- `DEFAULT_WORKSPACE_ROOT` 是 session 未指定 `workspaceRoot` 时的默认值
- 服务端需要自行展开 `~`
- `SENSITIVE_PATHS` 只允许服务端配置，不建议下放到前端

## 6. A 层：应用层路径与权限控制

### 6.1 原则

所有本地文件工具必须走统一的沙箱策略模块，禁止每个工具各写一套路径判断。

需要纳入 A 层的工具：

- `list_directory`
- `read_file`
- `write_file`
- `replace`
- `grep`
- `glob`

不纳入 A 层的工具：

- `search`
- `web_fetch`

### 6.2 Session 级策略对象

建议服务端在每次请求进入 Agent 前，先构建一个标准化策略对象：

```ts
interface SessionSandboxPolicy {
  workspaceRoot: string
  readMode: 'allowlist' | 'host-read'
  readRoots: string[]
  writeRoots: string[]
  sensitiveRoots: string[]
}
```

推荐规则：

- `workspaceRoot`
  - 来自 `session.sandbox.workspaceRoot`
  - 如未提供，则取 `DEFAULT_WORKSPACE_ROOT`
- `readMode`
  - `readRoots.length > 0` 时为 `allowlist`
  - 否则为 `host-read`
- `writeRoots`
  - 第一阶段固定为 `[workspaceRoot]`
- `sensitiveRoots`
  - 来自服务端配置，永远参与 deny

第一阶段不建议开放 session 级可写目录配置。

原因：

- 读取放宽可以接受
- 写入放宽很容易把“沙箱”退化成“危险文件操作代理”

### 6.3 统一路径解析

建议新增单独模块，例如 `src/tools/sandbox.ts`，提供：

```ts
interface ResolveOptions {
  mode: 'read' | 'write'
  allowMissing?: boolean
}

async function resolveSandboxPath(
  policy: SessionSandboxPolicy,
  inputPath: unknown,
  options: ResolveOptions
): Promise<string>
```

核心规则：

1. 相对路径默认按 `workspaceRoot` 解析
2. 绝对路径允许作为“读取请求”输入，但必须经过策略判断
3. 对已存在路径做 `realpath`，阻断 symlink 逃逸
4. 对待创建路径，至少校验最近存在的父目录
5. 命中敏感目录时立即拒绝
6. 写入请求只允许落在 `writeRoots`
7. 读取请求按 `readMode` 判断：
   - `allowlist`：仅允许 `workspaceRoot + readRoots`
   - `host-read`：允许所有非敏感目录

推荐边界判断：

```ts
function isWithinRoot(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root)
  const normalizedCandidate = path.resolve(candidate)
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(normalizedRoot + path.sep)
  )
}
```

### 6.4 写权限控制

所有会修改磁盘的工具必须同时受 `ALLOW_FILE_WRITE_TOOL` 保护：

- `write_file`
- `replace`

当前仓库里，`replace` 也属于写工具，必须纳入同一个开关。

### 6.5 当前仓库的接入点

需要改动的模块：

- `src/tools/types.ts`
  - 为 `ToolContext` 增加 `sessionSandbox?: SessionSandboxConfig`
  - 增加标准化后的 `sandboxPolicy`
- `src/tools/registry.ts`
  - 在创建工具上下文时注入新的沙箱配置
- `src/server.ts`
  - 从 `.env` 读取 `DEFAULT_WORKSPACE_ROOT`、`SENSITIVE_PATHS`、`ENABLE_PATH_SANDBOX`、`ENABLE_SEATBELT`
  - 从 session 或 chat payload 读取可选 `sandbox` 配置
- `src/tools/read-file.ts`
- `src/tools/write-file.ts`
- `src/tools/replace.ts`
- `src/tools/list-directory.ts`
- `src/tools/grep.ts`
- `src/tools/glob.ts`
  - 移除各自的 `resolveProjectPath`，统一改用 `resolveSandboxPath`

## 7. B 层：`sandbox-exec` 保护 Shell 子进程

### 7.1 适用范围

B 层只用于 `shell_command`。

原因：

- 文件工具已经运行在 Node 进程内，更适合走 A 层统一策略
- `shell_command` 风险最高，必须有进程级限制

### 7.2 Profile 不再是固定文件

由于读取策略支持 session 级配置，`sandbox-exec` 的 profile 不适合只依赖一个固定 `config/kraken.sb` 文件。

建议改为：

- 保留一个基础模板，例如 `config/kraken.sb.tpl`
- 在每次执行 `shell_command` 前，根据 `SessionSandboxPolicy` 动态生成 profile
- 生成后的 profile 临时写入：

```text
~/kraken/.sandbox/profiles/<sessionId>.sb
```

### 7.3 Seatbelt 的两种模式

#### 模式 1：Allowlist Read

当 session 提供了 `readRoots` 时，动态 profile 应满足：

- 允许读取 `workspaceRoot`
- 允许读取 `readRoots`
- 允许写入 `workspaceRoot`
- 拒绝读取敏感目录
- 允许读取系统命令与动态库目录，如 `/usr`、`/bin`、`/System`

#### 模式 2：Default Host Read

当 session 未提供 `readRoots` 时，动态 profile 应满足：

- 允许读取宿主机的普通目录
- 显式拒绝敏感目录
- 允许写入 `workspaceRoot`
- 允许读取系统命令与动态库目录

这意味着 B 层要和 A 层保持同一套策略，而不是写死成“只能读写 `SANDBOX_ROOT`”。

### 7.4 Shell 执行方式

不要把整个 `sandbox-exec ... bash -c ...` 拼成一个大字符串再交给 `shell: true`。

更稳妥的做法是直接使用参数数组启动：

```ts
spawn('/usr/bin/sandbox-exec', [
  '-f',
  generatedProfilePath,
  '/bin/zsh',
  '-lc',
  command,
], {
  cwd: policy.workspaceRoot,
  env: filteredEnv,
})
```

这样做的原因：

- 少一层额外 shell 展开，引用和转义更稳定
- 避免把 `sandbox-exec` 包装逻辑暴露在字符串拼接里
- 更容易控制 `cwd`、`env` 和超时逻辑

### 7.5 环境变量最小化

`shell_command` 不应继承完整的 `process.env`。

建议只透传最小必要集合，例如：

- `PATH`
- `HOME`
- `TMPDIR`
- `LANG`
- `LC_ALL`

并显式覆盖：

- `HOME = policy.workspaceRoot`
- `TMPDIR = policy.workspaceRoot/.sandbox/tmp`

不要把以下敏感变量默认透传给 Shell：

- `OPENROUTER_API_KEY`
- `TAVILY_API_KEY`
- 其他云平台凭证

### 7.6 命令黑名单不是主防线

可以额外拒绝明显危险的输入，例如再次调用 `sandbox-exec` 或 `osascript`，但这只能作为补充。

真正的主防线仍然是：

- Seatbelt 文件权限
- 最小化环境变量
- `cwd` 限制到 `workspaceRoot`
- 超时与资源限制

## 8. Session 与前端配置

### 8.1 Session 数据结构

当前仓库的 session 只有 `systemPrompt`、`model`、`messages` 等字段。

如果要支持 session 级沙箱配置，建议新增：

```ts
interface Session {
  id: string
  title: string
  model: string
  systemPrompt: string
  sandbox?: SessionSandboxConfig
  createdAt: string
  updatedAt: string
  messages: SessionMessage[]
}
```

### 8.2 前端行为

前端每个 session 可以提供一个“Sandbox Settings”面板，允许用户配置：

- `workspaceRoot`
- `readRoots`

这些字段都可以不传。

当不传时：

- `workspaceRoot` 默认取 `~/kraken`
- `readRoots` 为空
- 读取模式自动退回 `host-read`

### 8.3 API 建议

以下接口都应支持可选的 `sandbox` 字段：

- `POST /api/sessions`
- `PATCH /api/sessions/:sessionId`
- `/api/chat/stream` 的 payload

建议请求结构：

```ts
interface ChatPayload {
  sessionId: string | null
  systemPrompt: string
  message: string
  sandbox?: SessionSandboxConfig
}
```

服务端处理优先级建议如下：

1. 优先取本次请求 payload 中的 `sandbox`
2. 否则取 session 已保存的 `sandbox`
3. 再否则使用默认策略

## 9. 当前仓库的实施方案

### Step 1：引入统一 session 沙箱配置

在服务端定义：

```ts
interface SessionSandboxConfig {
  workspaceRoot?: string
  readRoots?: string[]
}
```

并在请求进入 Agent 前生成：

```ts
interface SessionSandboxPolicy {
  workspaceRoot: string
  readMode: 'allowlist' | 'host-read'
  readRoots: string[]
  writeRoots: string[]
  sensitiveRoots: string[]
}
```

### Step 2：新增 `src/tools/sandbox.ts`

集中实现：

- `resolveSandboxPath`
- `isWithinRoot`
- `normalizeSessionSandboxConfig`
- `buildSessionSandboxPolicy`
- `buildShellEnv`
- `ensureSandboxLayout`
- `generateSeatbeltProfile`

### Step 3：把所有本地文件工具切到 A 层

以下工具全部改为依赖 `SessionSandboxPolicy`：

- `list_directory`
- `read_file`
- `write_file`
- `replace`
- `grep`
- `glob`

同时补上：

- `replace` 检查 `ALLOW_FILE_WRITE_TOOL`

### Step 4：给 `shell_command` 接入 B 层

当满足以下条件时启用 Seatbelt：

- `process.platform === 'darwin'`
- `ENABLE_SEATBELT=true`
- 当前请求已生成 `SessionSandboxPolicy`

否则：

- 可以回退到普通子进程执行
- 但应在日志中明确标记“当前未启用 Seatbelt”

### Step 5：前端增加 Session Sandbox Settings

前端为每个 session 提供可选配置：

- 工作目录
- 额外可读目录

不填也允许运行，此时采用默认策略：

- 默认工作目录 `~/kraken`
- 可读取非敏感目录
- 写入仍限制在 `workspaceRoot`

## 10. 测试要求

至少覆盖以下场景：

### A 层测试

- `read_file("../package.json")` 在 `allowlist` 模式下被拒绝
- `read_file("/Users/alice/project/file.ts")` 在 `host-read` 模式下可读
- `read_file("~/.ssh/id_rsa")` 被拒绝
- `write_file("/etc/hosts")` 被拒绝
- `write_file("../outside.txt")` 被拒绝
- `glob("../../**/*")` 在 `allowlist` 模式下被拒绝
- `grep` 只能读取策略允许范围内的文件
- 指向敏感目录或沙箱外的 symlink 被拒绝
- `replace` 在 `ALLOW_FILE_WRITE_TOOL=false` 时被拒绝

### B 层测试

- `shell_command("pwd")` 输出的目录位于 `workspaceRoot`
- `shell_command("touch tmp.txt")` 只能写入 `workspaceRoot`
- `shell_command("cat ~/.ssh/id_rsa")` 被 Seatbelt 拒绝
- `shell_command("ls /Users")` 在 `host-read` 模式下可执行
- `shell_command("cat /etc/hosts")` 被敏感策略拒绝
- 超时命令会被终止

## 11. 风险与边界

| 风险 | 说明 | 缓解措施 |
|---|---|---|
| 默认 `host-read` 较宽松 | 不传 session 配置时可以读取大量非敏感文件 | 通过 denylist、前端提示和审计日志控制 |
| 敏感目录列表不完整 | 若 denylist 漏项，仍有读取风险 | 允许服务端通过环境变量扩展 `SENSITIVE_PATHS` |
| `sandbox-exec` 已弃用 | Apple 不推荐长期依赖 | 仅作为 Phase 1，后续可迁移到容器或 VM |
| symlink 逃逸 | 仅靠 `path.resolve` 不够 | 使用 `realpath` 校验现有路径 |
| 环境变量泄露 | Shell 继承完整 `process.env` 会暴露密钥 | 使用最小化 `filteredEnv` |
| 网络侧信道 | `search` / `web_fetch` 仍可向外发请求 | 保持工具边界清晰，后续单独治理 |
| 资源耗尽 | 死循环或高内存命令仍可能影响宿主机 | 加入超时、进程终止、后续补 `ulimit` |

## 12. 长期演进

- Phase 1：A + B，先把当前仓库的写入与 Shell 风险压下来
- Phase 2：每个 session 支持独立工作区副本或 git worktree
- Phase 3：容器或轻量 VM 隔离，替代 `sandbox-exec`

## 13. 结论

对当前仓库而言，A + B 仍然是最合理的第一阶段方案，但需要按新的产品要求调整为：

- 默认工作区在 `~/kraken`
- session 可以通过前端传额外的沙箱配置
- 不传配置时，允许读取除敏感目录外的宿主机内容
- 无论是否传配置，写入都仍然限制在 `workspaceRoot`

真正可落地的实现顺序应是：

1. 先引入 session 级 `sandbox` 配置与标准化策略对象
2. 再把 `read/write/list/replace/grep/glob` 全部切到 A 层
3. 最后让 `shell_command` 按同一策略动态生成 Seatbelt profile

## 14. 参考

- `man sandbox-exec`
- `man sandbox`
- [Apple Seatbelt Profile Reference](https://reverse.put.as/wp-content/uploads/2011/09/Apple-Sandbox-Guide-v1.0.pdf)
