# OpenRouter Prompt Caching 接入说明

## 1. 背景

Kraken 的 Usage 面板里，`Cache Hit` 展示的是模型返回的缓存命中 token 数，不是命中的请求次数。后端从 `logs/model.jsonl` 的响应 usage 中汇总这些字段：

- `usage.cached_tokens`
- `usage.cache_read_tokens`
- `raw.body.usage.prompt_tokens_details.cached_tokens`
- `raw.body.usage.input_tokens_details.cached_tokens`

在接入前，`qwen/qwen3.6-plus` 的 OpenRouter 响应里可以看到：

```json
{
  "prompt_tokens_details": {
    "cached_tokens": 0,
    "cache_write_tokens": 0
  }
}
```

原因是 Qwen 这类模型在 OpenRouter 上需要显式的 block-level cache breakpoint。也就是说，要在某个 content block 上加：

```json
{
  "cache_control": {
    "type": "ephemeral"
  }
}
```

OpenRouter 相关文档：

- Prompt Caching: https://openrouter.ai/docs/features/prompt-caching
- Prompt Caching Best Practices: https://openrouter.ai/docs/guides/best-practices/prompt-caching
- API Reference: https://openrouter.ai/docs/api/reference/overview/

## 2. 实现位置

当前实现集中在 [`src/agent/model.ts`](/Users/bill/code/kraken-server/src/agent/model.ts)。

模型调用仍然通过 `@ai-sdk/openai` 的 `createOpenAI(...)` 走 OpenAI-compatible Chat Completions 协议。因为 AI SDK 的 OpenAI chat 转换器不会把普通 text part 的 `providerOptions` 直接转成 OpenRouter 的 `cache_control`，所以这里使用了自定义 `fetch` middleware，在请求发出前改写最终 JSON body。

启用条件：

- `OPENROUTER_PROMPT_CACHE=true`
- `OPENROUTER_BASE_URL` 的 host 是 `openrouter.ai`
- 请求模型匹配显式缓存 allowlist

当前 allowlist 在 `shouldApplyOpenRouterPromptCache(...)` 中维护，包含：

- `anthropic/`
- `google/gemini`
- `qwen/qwen-plus`
- `qwen/qwen3-max`
- `qwen/qwen3.6-plus`
- `qwen/qwen3-coder-plus`
- `qwen/qwen3-coder-flash`
- `deepseek/deepseek-v3.2`

## 3. 配置

`.env` 可配置：

```bash
OPENROUTER_PROMPT_CACHE=true
OPENROUTER_PROMPT_CACHE_TYPE=ephemeral
```

默认行为：

- `OPENROUTER_PROMPT_CACHE` 未设置时按 `true` 处理
- `OPENROUTER_PROMPT_CACHE_TYPE` 未设置时使用 `ephemeral`

修改环境变量后需要重启服务。

## 4. Breakpoint 选择策略

实现只加一个 cache breakpoint，不给每个 block 都加。

选择规则：

1. 如果请求体里已经有 `cache_control`，不重复添加。
2. 找到最后一个动态输入消息，动态输入包括：
   - `role: "user"`
   - `role: "tool"`
3. 从这个动态输入之前向前找最后一个可缓存 text block。
4. 优先选择非 `tool` 消息。
5. 如果首轮只有 system prompt 和用户输入，则把 breakpoint 放在 system prompt 上。

这样做的目的：

- 缓存稳定前缀，而不是最新用户输入。
- 工具调用循环里避免把最新 tool result 当成缓存边界。
- 只放一个 breakpoint，减少 provider 侧兼容风险。

## 5. 请求体示例

首轮请求：

```json
{
  "model": "qwen/qwen3.6-plus",
  "messages": [
    {
      "role": "system",
      "content": [
        {
          "type": "text",
          "text": "system stable",
          "cache_control": {
            "type": "ephemeral"
          }
        }
      ]
    },
    {
      "role": "user",
      "content": "first question"
    }
  ]
}
```

二轮请求：

```json
{
  "model": "qwen/qwen3.6-plus",
  "messages": [
    {
      "role": "system",
      "content": "system stable"
    },
    {
      "role": "user",
      "content": "first question"
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "first answer",
          "cache_control": {
            "type": "ephemeral"
          }
        }
      ]
    },
    {
      "role": "user",
      "content": "second question"
    }
  ]
}
```

## 6. Usage 指标含义

OpenRouter 响应里常见字段：

```json
{
  "usage": {
    "prompt_tokens": 4238,
    "completion_tokens": 76,
    "total_tokens": 4314,
    "prompt_tokens_details": {
      "cached_tokens": 0,
      "cache_write_tokens": 0
    }
  }
}
```

含义：

- `cached_tokens`: 本次请求命中的缓存 token 数。
- `cache_write_tokens`: 本次请求写入缓存的 token 数。
- `Cache Hit`: Usage 面板展示的 `cached_tokens` 汇总。

第一次请求通常不会立刻有 `cached_tokens`。更常见的是先写入缓存，之后稳定前缀重复出现时，`cached_tokens` 才开始大于 0。

## 7. 验证方式

静态检查：

```bash
npm run check
```

运行验证：

1. 使用 `qwen/qwen3.6-plus` 或 allowlist 中的其他模型。
2. 连续在同一 session 中发送两到三轮问题，保持 system prompt 和历史前缀稳定。
3. 打开 Usage 面板并刷新。
4. 查看 `Cache Write` 是否先出现，后续再观察 `Cache Hit` 是否增长。

也可以直接看响应日志：

```bash
rg -o '"cached_tokens":[0-9]+' logs/model.jsonl
rg -o '"cache_write_tokens":[0-9]+' logs/model.jsonl
```

注意：`cache_control` 是在最终 HTTP 请求发送前由 fetch middleware 注入的。当前 `logs/model.jsonl` 的 request 记录是在调用 AI SDK 前写入的，所以不会直接看到最终 wire body 里的 `cache_control`。

## 8. 常见原因

如果 `Cache Hit` 仍然是 0，优先排查：

- 当前模型不在 `shouldApplyOpenRouterPromptCache(...)` 的 allowlist。
- 当前 `OPENROUTER_BASE_URL` 不是 `https://openrouter.ai/api/v1`。
- `OPENROUTER_PROMPT_CACHE=false`。
- 请求前缀每轮都变化太大，无法命中。
- 这是第一次请求，只发生了缓存写入，还没有下一次命中。
- Provider 当前没有返回 `cached_tokens` 或没有接受该模型的显式缓存参数。

## 9. 维护约定

新增模型时不要默认把所有 OpenRouter 模型都加上 `cache_control`。先确认该模型在 OpenRouter 文档中支持或需要显式 prompt caching，再把模型前缀加入 `shouldApplyOpenRouterPromptCache(...)`。

如果后续 AI SDK 原生支持 OpenRouter text block 的 `cache_control` 转换，可以移除当前 fetch middleware，改为在 ModelMessage part 上设置 provider metadata。
