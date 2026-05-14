# Hermes-Style Proposal Apply 技术方案

## 1. 目标

本文定义 Kraken 的 proposal apply 机制：贴近 Hermes Agent 的 memory/skill 自进化方式，但保留 Kraken 的人工治理边界。

核心变化：

- Agent 和 curator 仍然只能创建 proposal。
- 用户在前端 approve proposal 后，proposal 进入 `accepted`。
- 用户显式点击 apply 后，后端 apply service 才能落盘修改工作目录。
- apply service 只通过受控 adapters 修改 `memories/` 和 `skills/`，不让普通 agent run 直接写这些长期行为文件。

第一阶段只覆盖两类未来行为资产：

```text
<workspace>/
├── memories/
│   ├── MEMORY.md
│   └── USED.md
└── skills/
    └── <skill-name>/
        ├── SKILL.md
        ├── references/
        ├── scripts/
        └── assets/
```

这里的 `workspace` 来自当前 session sandbox 的 `workspaceRoot`。如果没有 workspace root，apply 必须拒绝执行。

## 2. 与 Hermes 的关系

Hermes 的自进化不是独立 proposal 状态机，而是把经验直接沉淀到 profile-scoped memory 和 skills：

- memory tool 修改 profile 下的 `memories/MEMORY.md` / `memories/USER.md`
- skill manager 创建、编辑、patch `skills/<name>/SKILL.md`
- command approval 负责高风险命令确认
- skill usage sidecar 记录使用、patch、archive、pin 等生命周期信号

Kraken 要借鉴的是它的资产形态和工具边界，不照搬静默修改：

| Hermes 机制 | Kraken 对应实现 |
| --- | --- |
| `MEMORY.md` | `<workspace>/memories/MEMORY.md`，项目事实、流程、失败经验 |
| `USER.md` | 第一阶段不做跨用户 profile，暂用 `USED.md` 记录已采纳/已使用经验 |
| `skill_manage create/patch` | proposal approved 后由 apply service 修改 `<workspace>/skills` |
| command approval | proposal accept/apply 双阶段确认 |
| skill usage sidecar | `<workspace>/skills/.usage.json` 或 `<skill>/.kraken-usage.json` |

关键差异：Kraken 的 agent tool 不直接提供 `proposal_apply`。Apply 是 UI/API 驱动的治理动作。

## 3. 状态机

Proposal 生命周期：

```text
pending
  -> accepted
  -> applying
  -> applied

pending
  -> rejected

accepted
  -> apply_failed
  -> accepted
```

当前类型里只有 `pending | accepted | rejected | applied`。第一版可以不新增持久状态 `applying/apply_failed`，而是通过 `applyResult` 表达失败：

```ts
interface EvolutionProposal {
  id: string
  type: EvolutionProposalType
  status: 'pending' | 'accepted' | 'rejected' | 'applied'
  reviewNote?: string
  reviewedAt?: string
  appliedAt?: string
  applyResult?: ProposalApplyResult
}

interface ProposalApplyResult {
  ok: boolean
  adapter: 'workspace_memory' | 'workspace_skill'
  changedFiles: string[]
  validation: Array<{
    command: string
    ok: boolean
    output: string
  }>
  auditPath: string
  error?: string
  appliedBy?: string
  appliedAt: string
}
```

规则：

- 只有 `accepted` proposal 可以 apply。
- `pending` 不能 apply，必须先由用户 approve。
- `rejected` 不能 apply。
- `applied` 不能重复 apply，除非后续显式设计 reapply。
- apply 失败时 proposal 保持 `accepted`，只更新 `applyResult.ok=false`。

## 4. Proposal 结构升级

当前 `suggestedChange` 和 `patch` 是自由文本。为了可靠 apply，需要给 memory/skill proposal 增加结构化 payload。

建议兼容旧字段，新增 `payload`：

```ts
type EvolutionProposalPayload =
  | WorkspaceMemoryProposalPayload
  | WorkspaceSkillCreatePayload
  | WorkspaceSkillPatchPayload

interface WorkspaceMemoryProposalPayload {
  adapter: 'workspace_memory'
  operation: 'append_memory' | 'append_used' | 'merge_memory'
  entries: Array<{
    target: 'MEMORY.md' | 'USED.md'
    kind: 'preference' | 'fact' | 'decision' | 'procedure' | 'failure' | 'todo' | 'artifact'
    text: string
    tags?: string[]
    source?: {
      sessionIds?: string[]
      runIds?: string[]
    }
  }>
}

interface WorkspaceSkillCreatePayload {
  adapter: 'workspace_skill'
  operation: 'create_skill'
  skillName: string
  description: string
  files: Array<{
    path: string
    content: string
  }>
}

interface WorkspaceSkillPatchPayload {
  adapter: 'workspace_skill'
  operation: 'patch_skill'
  skillName: string
  files: Array<{
    path: string
    mode: 'replace' | 'append' | 'apply_patch'
    content?: string
    patch?: string
  }>
}
```

旧 proposal 没有 `payload` 时：

- `memory_write` 可以从 `suggestedChange` 生成一个 `MEMORY.md` append preview。
- `skill_create` / `skill_patch` 必须要求人工补全结构化 payload，不能靠自由文本直接落盘。

## 5. 工作目录 Memory Apply

### 5.1 文件职责

`memories/MEMORY.md` 保存会影响未来行为的长期项目记忆：

- 项目约定
- 常用命令
- 架构决策
- 已确认偏好
- 失败经验和规避方式
- 可复用流程

`memories/USED.md` 保存 proposal apply 和检索使用痕迹：

- 哪个 proposal 被应用
- 写入了哪些 memory entries
- 哪些 memory 在后续 run 中被检索或使用
- 过期、冲突、合并记录

命名说明：Hermes 用 `USER.md` 保存用户画像。Kraken 第一阶段不做跨用户画像，使用 `USED.md` 更贴合项目级审计。如果后续要做用户 profile，可以单独新增 `USER.md`。

### 5.2 MEMORY.md 格式

建议用稳定 Markdown block，便于人工 review 和 deterministic merge：

```markdown
# Workspace Memory

<!-- kraken-memory:start -->

## procedure

<!-- id: mem_20260514_001; tags: build,npm; source: proposal:<id> -->
- Run `npm run build` after changing TypeScript modules because frontend bundle and server types are coupled.

## failure

<!-- id: mem_20260514_002; tags: proposal,apply; source: proposal:<id> -->
- If proposal apply validation fails, keep the proposal accepted and record the failed command before retrying.

<!-- kraken-memory:end -->
```

约束：

- apply service 只修改 `<!-- kraken-memory:start -->` 到 `<!-- kraken-memory:end -->` 之间的内容。
- 没有 marker 时自动创建文件和 marker。
- 每条 entry 必须有 deterministic id、kind、tags、source proposal id。
- 禁止写入 API key、cookie、private key、`.env` 内容。
- 重复 entry 用规范化文本去重，不追加。

### 5.3 USED.md 格式

```markdown
# Workspace Memory Usage

## Applied Proposals

<!-- proposal:<id> -->
- appliedAt: 2026-05-14T00:00:00.000Z
- type: memory_write
- changedFiles:
  - memories/MEMORY.md
- validation:
  - memory_file_parse: ok

## Retrieval Notes

<!-- usage:<runId> -->
- runId: ...
- usedMemoryIds:
  - mem_20260514_001
```

第一阶段只要求记录 `Applied Proposals`。`Retrieval Notes` 可以后续在 memory prompt 注入时补。

### 5.4 Adapter 行为

`WorkspaceMemoryApplyAdapter` 负责：

1. Resolve workspace root。
2. 确保目标路径只能在 `<workspace>/memories` 内。
3. 读取或创建 `MEMORY.md` / `USED.md`。
4. 扫描 secrets 和 prompt-injection 高风险片段。
5. 按 kind 合并 entries。
6. 写入临时文件再 atomic rename。
7. 生成 changedFiles 和 before/after preview。
8. 记录 audit。

伪代码：

```ts
async function applyWorkspaceMemoryProposal(input) {
  const proposal = await proposalStore.get(input.proposalId)
  assertAccepted(proposal)
  const payload = parseWorkspaceMemoryPayload(proposal)
  const root = resolveWorkspaceRoot(input.sessionId)
  const memoryDir = safeJoin(root, 'memories')

  const before = await readMemoryFiles(memoryDir)
  const next = mergeMemoryEntries(before, payload.entries, proposal.id)
  scanForSecrets(next)
  await writeAtomic(memoryDir, next)

  const result = await validateWorkspaceMemory(memoryDir)
  await writeApplyAudit(proposal, before, next, result)
  await proposalStore.markApplied(proposal.id, result)
}
```

## 6. 工作目录 Skill Apply

### 6.1 Skill 扫描策略

Kraken 当前 skill discovery 已扫描：

1. `KRAKEN_SKILLS_DIR` 或 `~/kraken/skills`
2. `./skills`
3. `~/.config/kraken/skills`
4. `~/.kraken/skills`

为了贴近 Hermes，proposal apply 应优先修改工作目录下的 `./skills`：

```text
<workspace>/skills/<skill-name>/SKILL.md
```

扫描规则：

- apply service 执行前扫描 `<workspace>/skills`。
- 同名 skill 存在时，`skill_create` 失败，除非 proposal 明确 `force=true`。
- `skill_patch` 必须命中已有 skill。
- 只能修改目标 skill 目录内文件。
- 默认只允许这些路径：
  - `SKILL.md`
  - `references/**`
  - `scripts/**`
  - `assets/**`
- 禁止修改 `.env`、隐藏目录、符号链接逃逸路径。

### 6.2 Skill Create Payload

`skill_create` proposal 应包含完整最小 skill 草案：

```json
{
  "adapter": "workspace_skill",
  "operation": "create_skill",
  "skillName": "proposal-review",
  "description": "Review, approve, and apply Kraken self-improvement proposals.",
  "files": [
    {
      "path": "SKILL.md",
      "content": "---\nname: proposal-review\ndescription: Review, approve, and apply Kraken self-improvement proposals.\n---\n\n# Proposal Review\n\n## Workflow\n\n1. Inspect pending proposals.\n2. Verify source sessions and risk.\n3. Approve only when the change is scoped and reversible.\n"
    },
    {
      "path": "references/checklist.md",
      "content": "# Checklist\n\n- Confirm changed files.\n- Confirm validation command.\n"
    }
  ]
}
```

Validation：

- `SKILL.md` 必须有 YAML frontmatter。
- `name` 必须等于 `skillName`。
- `description` 必须非空且不超过 1024 字符。
- body 不能为空。
- 文件总大小有上限。
- 内容通过 injection/secret scanner。
- 创建后调用 `validateSkillDir(skillDir)`。
- 成功后刷新 skill registry。

### 6.3 Skill Patch Payload

`skill_patch` 支持三种模式：

```json
{
  "adapter": "workspace_skill",
  "operation": "patch_skill",
  "skillName": "proposal-review",
  "files": [
    {
      "path": "SKILL.md",
      "mode": "apply_patch",
      "patch": "*** Begin Patch\n*** Update File: SKILL.md\n@@\n- old\n+ new\n*** End Patch\n"
    },
    {
      "path": "references/checklist.md",
      "mode": "append",
      "content": "\n- Check audit log after apply.\n"
    }
  ]
}
```

模式约束：

- `replace`: 替换整个文件，适合 `SKILL.md` 完整 rewrite。
- `append`: 只追加到 Markdown/reference 文件末尾。
- `apply_patch`: 只允许 unified/apply_patch 风格 patch，必须先 dry-run。

第一版可以先实现 `replace` 和 `append`，把 `apply_patch` 留到第二阶段，降低解析复杂度。

### 6.4 Skill Usage Sidecar

为了接近 Hermes 的 curator/lifecycle，apply 后写 sidecar：

```text
<workspace>/skills/.usage.json
```

建议结构：

```json
{
  "proposal-review": {
    "createdByProposalId": "...",
    "lastPatchedByProposalId": "...",
    "createdAt": "...",
    "lastPatchedAt": "...",
    "patchCount": 1,
    "state": "active",
    "pinned": false
  }
}
```

如果要避免全局 sidecar 冲突，也可以写到每个 skill：

```text
<workspace>/skills/<skill-name>/.kraken-usage.json
```

推荐第一阶段用全局 `.usage.json`，方便 curator 扫描。

## 7. Apply Service 架构

新增模块建议：

```text
src/evolution/
├── apply.ts
├── apply-audit.ts
├── workspace-memory-apply.ts
└── workspace-skill-apply.ts
```

模块职责：

| 模块 | 职责 |
| --- | --- |
| `apply.ts` | proposal apply 总入口、状态检查、adapter 路由 |
| `workspace-memory-apply.ts` | 修改 `<workspace>/memories/MEMORY.md` 和 `USED.md` |
| `workspace-skill-apply.ts` | 创建/修改 `<workspace>/skills/<name>` |
| `apply-audit.ts` | 写 audit JSON 和 Markdown report |

总入口：

```ts
interface ApplyProposalInput {
  proposalId: string
  sessionId?: string
  workspaceRoot?: string
  appliedBy?: string
  dryRun?: boolean
}

interface ApplyProposalOutput {
  proposal: EvolutionProposal
  dryRun: boolean
  changedFiles: string[]
  preview: string
  auditPath?: string
  validation: ValidationResult[]
}
```

Adapter 路由：

| Proposal type | Adapter |
| --- | --- |
| `memory_write` | `workspace_memory` |
| `memory_merge` | `workspace_memory` |
| `skill_create` | `workspace_skill` |
| `skill_patch` | `workspace_skill` |
| `prompt_patch` | 暂不实现 apply，只 preview |
| `tool_policy` | 暂不实现 apply，只 preview |
| `doc_update` | 暂不在本方案覆盖 |
| `code_followup` | 不 apply |

## 8. API 与前端

### 8.1 API

新增：

```text
POST /api/evolution/proposals/:proposalId/apply
POST /api/evolution/proposals/:proposalId/dry-run
```

请求：

```json
{
  "sessionId": "optional-session-id",
  "workspaceRoot": "optional-explicit-root"
}
```

响应：

```json
{
  "ok": true,
  "proposal": {},
  "changedFiles": [
    "memories/MEMORY.md",
    "memories/USED.md"
  ],
  "preview": "...diff or structured preview...",
  "validation": [
    {
      "name": "memory_file_parse",
      "ok": true,
      "output": "ok"
    }
  ],
  "auditPath": ".memory/apply-audit/<proposalId>.json"
}
```

### 8.2 前端

Proposal Review 面板增加：

- `Preview Apply` 按钮：调用 dry-run，不落盘。
- `Apply` 按钮：只在 `accepted` proposal 上显示。
- `Changed files` 区域：显示 `memories/**` 或 `skills/**`。
- `Validation` 区域：显示 validation 状态。
- `Audit` 链接：指向 `.memory/apply-audit/<proposalId>.md` 或 JSON。

按钮规则：

| 状态 | 可见动作 |
| --- | --- |
| `pending` | Accept / Reject |
| `accepted` | Preview Apply / Apply |
| `rejected` | 无 apply |
| `applied` | View Audit |

## 9. Audit 与回滚

Apply audit 目录：

```text
<workspace>/.memory/apply-audit/
├── <proposalId>.json
└── <proposalId>.md
```

JSON 保存机器可读信息：

```json
{
  "proposalId": "...",
  "type": "skill_patch",
  "appliedAt": "...",
  "appliedBy": "web",
  "workspaceRoot": "...",
  "changedFiles": [
    "skills/proposal-review/SKILL.md"
  ],
  "before": {
    "skills/proposal-review/SKILL.md": "..."
  },
  "after": {
    "skills/proposal-review/SKILL.md": "..."
  },
  "validation": [],
  "revertInstructions": "Restore the before content for changedFiles."
}
```

第一阶段不做自动 revert，但必须保存 before/after，保证人工可以恢复。

## 10. 安全边界

硬规则：

- proposal apply 只能修改当前 workspace 下的 `memories/` 和 `skills/`。
- 禁止路径逃逸：`..`、绝对路径、符号链接跳出 workspace 都拒绝。
- 禁止写 `.env`、密钥、cookie、private key。
- `skill_create` / `skill_patch` 必须经过 approve，再显式 apply。
- Agent runtime 不获得 `proposal_apply` tool。
- Scheduler curator 只能生成 proposal，不能直接 apply。
- Apply 前必须 dry-run 生成 preview。
- Apply 后必须 validation 和 audit。

高风险内容扫描：

- `ignore previous instructions`
- `you are now`
- `<system>`
- 读取 `.env` / credential 文件的命令
- `curl ... $TOKEN`
- 私钥块
- OpenRouter/OpenAI/Slack/AWS 常见 token pattern
- invisible unicode control characters

对 skill 脚本：

- 第一阶段可以允许写 `scripts/**`，但不自动执行。
- 如果 proposal 包含 scripts，risk 至少为 `high`。
- validation 只做静态检查，不运行脚本。

## 11. 最小实现顺序

建议按这个顺序落地：

1. `proposal.payload` 类型和兼容旧 proposal 的 parser。
2. `proposalStore.markApplied()` 和 `applyResult` 字段。
3. `WorkspaceMemoryApplyAdapter`。
4. `POST /api/evolution/proposals/:id/dry-run`。
5. `POST /api/evolution/proposals/:id/apply`。
6. 前端给 `accepted` proposal 加 Preview Apply / Apply。
7. `WorkspaceSkillApplyAdapter` 的 `create_skill`。
8. `WorkspaceSkillApplyAdapter` 的 `replace` / `append` patch。
9. `.usage.json` skill telemetry。
10. Curator 扫描 `memories/` 和 `skills/`，生成下一批 proposal。

第一版只做：

- `memory_write -> memories/MEMORY.md`
- `memory_write -> memories/USED.md`
- `skill_create -> skills/<name>/SKILL.md + references/**`

第二版再做：

- `memory_merge`
- `skill_patch`
- skill usage telemetry
- audit UI

## 12. 验收标准

Memory apply：

- approve 前不能 apply。
- apply 后 `<workspace>/memories/MEMORY.md` 出现 marker 和 entry。
- apply 后 `<workspace>/memories/USED.md` 有 proposal 记录。
- 重复 apply 被拒绝。
- 含 secret 的 proposal apply 被拒绝。

Skill apply：

- approve 前不能 create/patch skill。
- `skill_create` 后 `<workspace>/skills/<name>/SKILL.md` 存在。
- 新 skill 能被 `discoverSkills()` 扫描到。
- invalid frontmatter 被 validation 拒绝。
- path escape 被拒绝。

Audit：

- 每次成功 apply 都写 `.memory/apply-audit/<proposalId>.json`。
- 失败 apply 不标记 `applied`。
- validation 失败时 proposal 保持 `accepted`。

