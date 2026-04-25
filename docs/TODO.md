# Kraken Agent — TODO

## 高优先级

- [ ] **后端 .env 加载顺序修复**
  - `bootstrap.ts` 已作为第一个 import 解决 `OPENROUTER_API_KEY` 加载问题，需确认生产环境无回归

- [ ] **前端 Markdown 代码块语法高亮**
  - 当前 `marked` 只渲染 HTML，缺少代码高亮（可集成 `highlight.js`）

- [ ] **工具输出格式优化**
  - `shell_command` 返回的终端表格/图形在 `outputPreview` 中仍显混乱
  - 考虑在后端对 `outputPreview` 做更智能的摘要提取（如只取 stdout 前 N 行）

- [ ] **流式回答的打字机效果**
  - 当前 `assistant:delta` 是整段替换，应改为逐字/逐词追加的打字机效果

## 中优先级

- [ ] **会话持久化格式扩展**
  - 当前 `session.messages` 只存 `user`/`assistant` 文本
  - 如需长期保留工具调用过程，应在后端把 `RunResult` 也写入会话文件

- [ ] **前端状态管理**
  - 当前 `useChat` + `useSessions` 用多个 `useState` 组合，复杂场景下易出竞态
  - 可考虑引入 `zustand` 或合并为一个全局 store

- [ ] **消息编辑与重新生成**
  - 支持点击用户消息进行编辑，编辑后重新触发 Agent 循环
  - 支持对 Assistant 回答点"重新生成"

- [ ] **多模型切换**
  - 侧边栏或 Header 增加模型选择器，实时切换 OpenRouter 模型

## 低优先级

- [ ] **文件上传**
  - 支持用户上传图片/文本文件作为消息附件
  - OpenRouter 部分模型支持 vision，可传图

- [ ] **移动端适配**
  - 当前左侧 Session 栏在 `< 768px` 下直接隐藏，需做汉堡菜单或底部 Tab

- [ ] **Dark Mode**
  - 当前只有浅色主题，可添加系统级暗色模式切换

- [ ] **测试覆盖**
  - 后端 Agent 循环、工具执行、会话 CRUD 缺少单元测试
  - 前端 hooks 缺少测试

## 已知问题

- `outputPreview` 被后端截断到 320 字符，长输出会丢失尾部信息
- `marked` 渲染的 HTML 未做 XSS 过滤（内容来自可信模型，当前风险较低）
- 多步 ReAct 循环中，若某步模型返回空文本，前端 `streamingText` 会短暂空白
