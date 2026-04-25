# Kraken Agent 沙箱方案（A + B）

> 面向当前仓库的落地版方案。
> A = 应用层目录边界；B = macOS `sandbox-exec` 保护 `shell_command` 子进程。

## 1. 目标

Kraken Agent 具备文件读写、Shell 命令执行、网络请求等工具能力。在自动执行用户指令时，需要优先解决以下问题：

- 防止误删或误写宿主机文件
- 防止通过 `../`、绝对路径或符号链接访问沙箱外目录
- 限制 `shell_command` 对宿主机文件系统的直接访问
- 减少读取 `~/.ssh`、`~/.aws`、`~/.gnupg` 等敏感信息的风险

本方案的定位是“轻量、可维护、可在当前仓库内快速落地”的本地沙箱。

## 2. 非目标

本方案不试图提供以下能力：

- 不提供虚拟机级别或容器级别的强隔离
- 不解决跨平台隔离，当前仅支持 macOS
- 不把 `search`、`web_fetch` 这类网络工具纳入文件沙箱
- 不把 `sandbox-exec` 当作长期终局方案，它是 Phase 1 的工程折中

## 3. 为什么采用 A + B

当前仓库已经有一层“项目根目录边界”，但仍存在明显缺口：

- 文件工具各自实现 `resolveProjectPath`，逻辑分散
- `replace` 当前会直接改盘，且未受 `ALLOW_FILE_WRITE_TOOL` 保护
- `grep`、`glob` 也在读文件，但没有纳入统一沙箱模块
- `shell_command` 直接以 `shell: true` 执行命令，子进程继承完整 `process.env`

因此采用两层方案：

- A 层负责把所有本地文件访问统一限制到 `workspaceRoot`
- B 层负责把 `shell_command` 放进 macOS Seatbelt 里执行

这两层的职责不同，必须同时存在：

- 只有 A，没有 B：Shell 仍能直接访问宿主机
- 只有 B，没有 A：Node 进程内的文件工具仍可能误操作真实路径

## 4. 总体架构

```text
┌──────────────────────────────────────────────┐
│ Kraken Agent Server                          │
│ Express / Agent Loop / Session Persistence   │
│ 不进入 sandbox-exec                          │
└──────────────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
┌──────────────────┐    ┌──────────────────────┐
│ A. 文件工具       │    │ B. shell_command     │
│ read/write/list   │    │ sandbox-exec 包裹    │
│ grep/glob/replace │    │ cwd=workspaceRoot    │
│ 统一路径解析       │    │ 过滤后的 env         │
└──────────────────┘    └──────────────────────┘
         │                       │
         ▼                       ▼
       workspaceRoot         SANDBOX_ROOT/*
```

说明：

- Server 进程本身不进入 Seatbelt；真正受 B 层约束的是 Shell 子进程
- A 层覆盖所有本地文件读写与遍历工具
- `search`、`web_fetch` 属于网络工具，不属于本次文件沙箱范围
- `.sessions` 默认继续由 Server 管理，不暴露给 Agent 工具

## 5. 目录模型

```text
SANDBOX_ROOT/
├── workspace/    # Agent 可见、可操作的工作区
└── tmp/          # Shell 或工具的临时文件
```

推荐环境变量：

```bash
SANDBOX_ROOT=./sandbox
SANDBOX_WORKSPACE=./sandbox/workspace
ENABLE_PATH_SANDBOX=true
ENABLE_SEATBELT=true
ALLOW_SHELL_TOOL=true
ALLOW_FILE_WRITE_TOOL=true
```

补充说明：

- `workspaceRoot` 才是 Agent 工具真正可见的根目录
- 如果希望“强隔离”，不要把 `workspaceRoot` 直接指向真实仓库根目录
- 更合理的做法是在会话开始时，把仓库复制到 `workspaceRoot`，或使用单独的 git worktree

## 6. A 层：应用层目录边界

### 6.1 原则

所有本地文件工具必须走统一的路径解析函数，禁止每个工具各写一套 `resolveProjectPath`。

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

### 6.2 统一路径解析

建议新增单独模块，例如 `src/tools/sandbox.ts`，提供：

```ts
interface ResolveOptions {
  allowMissing?: boolean
}

async function resolveWorkspacePath(
  workspaceRoot: string,
  inputPath: unknown,
  options: ResolveOptions = {}
): Promise<string>
```

核心规则：

1. 输入路径一律按 `workspaceRoot` 解析
2. 拒绝空路径、绝对路径和路径逃逸
3. 对已存在路径做 `realpath`，阻断 symlink 逃逸
4. 对待创建路径，至少校验其最近存在的父目录是否仍在 `workspaceRoot` 内
5. 判断“是否仍在工作区内”时，不能只用裸 `startsWith(root)`，应使用规范化后的边界判断

推荐逻辑：

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

### 6.3 写权限控制

所有会修改磁盘的工具必须同时受 `ALLOW_FILE_WRITE_TOOL` 保护：

- `write_file`
- `replace`

当前仓库里，`replace` 也属于写工具，必须纳入同一个开关。

### 6.4 当前仓库的接入点

需要改动的模块：

- `src/tools/types.ts`
  - 为 `ToolContext` 增加 `sandboxRoot`、`workspaceRoot`、`enablePathSandbox`、`enableSeatbelt`
- `src/tools/registry.ts`
  - 在创建工具上下文时注入新的沙箱配置
- `src/server.ts`
  - 从 `.env` 读取 `SANDBOX_ROOT`、`SANDBOX_WORKSPACE`、`ENABLE_PATH_SANDBOX`、`ENABLE_SEATBELT`
- `src/tools/read-file.ts`
- `src/tools/write-file.ts`
- `src/tools/replace.ts`
- `src/tools/list-directory.ts`
- `src/tools/grep.ts`
- `src/tools/glob.ts`
  - 移除各自的 `resolveProjectPath`，统一改用 `resolveWorkspacePath`

## 7. B 层：`sandbox-exec` 保护 Shell 子进程

### 7.1 适用范围

B 层只用于 `shell_command`。

原因：

- 文件工具已经运行在 Node 进程内，更适合走 A 层统一路径解析
- `shell_command` 风险最高，必须有进程级限制

### 7.2 Seatbelt 配置

建议新增配置文件：`config/kraken.sb`

```scheme
(version 1)

(deny default)
(allow process*)
(allow sysctl-read)
(allow file-read-metadata)

; 允许访问沙箱目录
(allow file-read* file-write*
  (subpath (param "SANDBOX_ROOT")))

; 允许系统命令与动态库
(allow file-read*
  (subpath "/usr")
  (subpath "/bin")
  (subpath "/sbin")
  (subpath "/System"))

; 默认不放开网络；如确有需要，再按域名或地址单独加白
; (deny network*)
```

注意：

- `sandbox-exec` 已被 Apple 标记为 deprecated，但在当前 macOS 环境仍可用
- 这意味着它适合作为当前仓库的 Phase 1 方案，而不是最终形态

### 7.3 Shell 执行方式

不要把整个 `sandbox-exec ... bash -c ...` 拼成一个大字符串再交给 `shell: true`。

更稳妥的做法是直接使用参数数组启动：

```ts
spawn('/usr/bin/sandbox-exec', [
  '-f',
  seatbeltProfilePath,
  '-D',
  `SANDBOX_ROOT=${sandboxRoot}`,
  '/bin/zsh',
  '-lc',
  command,
], {
  cwd: workspaceRoot,
  env: filteredEnv,
})
```

这样做的原因：

- 少一层额外 shell 展开，引用和转义更稳定
- 避免把 `sandbox-exec` 包装逻辑暴露在字符串拼接里
- 更容易控制 `cwd`、`env` 和超时逻辑

### 7.4 环境变量最小化

`shell_command` 不应继承完整的 `process.env`。

建议只透传最小必要集合，例如：

- `PATH`
- `HOME`
- `TMPDIR`
- `LANG`
- `LC_ALL`

并显式覆盖：

- `HOME = SANDBOX_ROOT`
- `TMPDIR = SANDBOX_ROOT/tmp`

不要把以下敏感变量默认透传给 Shell：

- `OPENROUTER_API_KEY`
- `TAVILY_API_KEY`
- 其他云平台凭证

### 7.5 命令黑名单不是主防线

可以额外拒绝明显危险的输入，例如再次调用 `sandbox-exec` 或 `osascript`，但这只能作为补充。

真正的主防线仍然是：

- Seatbelt 文件权限
- 最小化环境变量
- `cwd` 限制到 `workspaceRoot`
- 超时与资源限制

## 8. 当前仓库的实施方案

### Step 1：引入统一沙箱上下文

在 `ToolContext` 中增加以下字段：

```ts
interface ToolContext {
  rootDir: string
  sandboxRoot: string
  workspaceRoot: string
  enablePathSandbox: boolean
  enableSeatbelt: boolean
  allowShellTool: boolean
  allowFileWriteTool: boolean
}
```

说明：

- `rootDir` 保留给 Server 自身使用
- Agent 工具应优先使用 `workspaceRoot`

### Step 2：新增 `src/tools/sandbox.ts`

集中实现：

- `resolveWorkspacePath`
- `isWithinRoot`
- `ensureSandboxLayout`
- `buildShellEnv`

### Step 3：把所有本地文件工具切到 A 层

以下工具全部改为依赖 `workspaceRoot`：

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
- `config/kraken.sb` 存在

否则：

- 可以回退到普通子进程执行
- 但应在日志中明确标记“当前未启用 Seatbelt”

### Step 5：API / UI 暴露当前沙箱状态

建议在 `/api/config` 中增加以下只读信息：

- `sandboxEnabled`
- `seatbeltEnabled`
- `workspaceRoot`

前端只做状态展示，不允许从 UI 直接修改这些配置。

## 9. 测试要求

至少覆盖以下场景：

### A 层测试

- `read_file("../package.json")` 被拒绝
- `write_file("/etc/hosts")` 被拒绝
- `glob("../../**/*")` 被拒绝
- `grep` 只能遍历 `workspaceRoot` 内部文件
- 指向沙箱外的 symlink 被拒绝
- `replace` 在 `ALLOW_FILE_WRITE_TOOL=false` 时被拒绝

### B 层测试

- `shell_command("pwd")` 输出的目录位于 `workspaceRoot`
- `shell_command("touch tmp.txt")` 只能写入沙箱目录
- `shell_command("cat ~/.ssh/id_rsa")` 被 Seatbelt 拒绝
- `shell_command("ls /Users")` 在未授权情况下失败
- 超时命令会被终止

## 10. 风险与边界

| 风险 | 说明 | 缓解措施 |
|---|---|---|
| `sandbox-exec` 已弃用 | Apple 不推荐长期依赖 | 仅作为 Phase 1，后续可迁移到容器或 VM |
| symlink 逃逸 | 仅靠 `path.resolve` 不够 | 使用 `realpath` 校验现有路径 |
| 环境变量泄露 | Shell 继承完整 `process.env` 会暴露密钥 | 使用最小化 `filteredEnv` |
| 网络侧信道 | `search` / `web_fetch` 仍可向外发请求 | 保持工具边界清晰，后续单独治理 |
| 资源耗尽 | 死循环或高内存命令仍可能影响宿主机 | 加入超时、进程终止、后续补 `ulimit` |

## 11. 长期演进

- Phase 1：A + B，先把当前仓库的文件与 Shell 风险压下来
- Phase 2：每会话独立 `workspace` 副本或 git worktree
- Phase 3：容器或轻量 VM 隔离，替代 `sandbox-exec`

## 12. 结论

对当前仓库而言，A + B 是最合理的第一阶段方案：

- A 层解决“Node 进程内文件工具误操作”的问题
- B 层解决“Shell 子进程直接碰宿主机”的问题

只做其中一层都不够。真正可落地的实现顺序应是：

1. 统一 `workspaceRoot` 路径解析
2. 把 `replace`、`grep`、`glob` 一并纳入 A 层
3. 再给 `shell_command` 接入 `sandbox-exec`

## 13. 参考

- `man sandbox-exec`
- `man sandbox`
- [Apple Seatbelt Profile Reference](https://reverse.put.as/wp-content/uploads/2011/09/Apple-Sandbox-Guide-v1.0.pdf)
