# 淘股吧大 V 与小作文采集技术方案

## 目标

在 Market 工作台内新增两类授权数据能力：

- 淘股吧大 V 跟踪：采集关注账号的公开帖子、实盘披露、持仓相关文本和来源链接。
- 小作文采集：采集用户授权来源里的市场传闻、观点、短帖、复盘和群聊转贴文本，并抽取标的、板块、催化和风险。

系统只做投研辅助和来源整理，不绕过登录、验证码、付费墙或平台访问限制，不把文本自述当成真实账户持仓。

## 数据边界

### 可以接入

- 用户自己登录后可见的淘股吧页面。
- 公开可访问的淘股吧帖子、博客、实盘展示、比赛页。
- 用户自己授权导出的 HTML、JSON、CSV、截图 OCR 文本。
- 用户自己配置的合法 Cookie、Token 或浏览器 profile。
- 用户手动粘贴的小作文。

### 不做

- 不破解验证码。
- 不绕过登录或付费权限。
- 不批量撞库或绕风控。
- 不承诺“真实持仓”，只记录“公开披露持仓”或“文本推断持仓”。
- 不自动下单，不生成交易指令。

## 采集模式

### 1. Agent Browser 登录态采集

用户负责登录淘股吧，系统复用授权浏览器上下文读取页面。

推荐流程：

```text
用户打开 Market 配置
  -> 点击“连接淘股吧”
  -> agent/browser 打开登录页
  -> 用户手动登录、处理验证码
  -> 保存 session-local storage state
  -> 后台按关注列表访问公开/授权页面
  -> 提取帖子、实盘披露和持仓文本
```

实现要点：

- 登录只由用户完成。
- storage state 存在本地 runtime 目录，不进 git。
- 采集频率低频化，默认 5 到 15 分钟。
- 每条数据保留 `sourceUrl`、抓取时间、发布时间、原文 hash。
- 页面结构变化时失败返回错误或空列表，不生成假数据。

### 2. Cookie 授权采集

适合用户自己提供合法 Cookie 的场景。

环境变量建议：

```bash
TAOGUBA_ENABLED=true
TAOGUBA_AUTH_MODE=cookie
TAOGUBA_COOKIE="..."
TAOGUBA_USER_AGENTS=退学炒股,炒股养家
TAOGUBA_FETCH_INTERVAL_MS=600000
TAOGUBA_MAX_POSTS_PER_AUTHOR=30
```

注意：

- `TAOGUBA_COOKIE` 只能放 `.env.local` 或本机密钥存储。
- 日志不打印 Cookie。
- 请求失败、过期、被重定向到登录页时标记 `auth_expired`。

### 3. 手动导入

适合先做 MVP。

支持：

- 粘贴帖子内容。
- 上传导出的 HTML。
- 上传 CSV/JSON。
- 粘贴多个 URL 后由 agent/browser 逐个打开抽取。

## 数据模型

### TaogubaAuthor

```ts
interface TaogubaAuthor {
  id: string
  displayName: string
  profileUrl?: string
  tags: string[]
  enabled: boolean
  lastFetchedAt?: string
}
```

### TaogubaPost

```ts
interface TaogubaPost {
  id: string
  authorId: string
  authorName: string
  title?: string
  content: string
  sourceUrl: string
  publishedAt?: string
  fetchedAt: string
  contentHash: string
  symbols: string[]
  sectors: string[]
  postType: 'post' | 'blog' | 'reply' | 'contest' | 'holding_disclosure'
  visibility: 'public' | 'user_authorized'
  engagement?: {
    views?: number
    replies?: number
    likes?: number
    favorites?: number
  }
}
```

### InferredHolding

```ts
interface InferredHolding {
  id: string
  authorId: string
  authorName: string
  symbol: string
  symbolName?: string
  side: 'holding' | 'bought' | 'sold' | 'cleared' | 'watching' | 'unknown'
  positionPct?: number
  costPrice?: number
  latestPrice?: number
  pnlPct?: number
  eventTime?: string
  extractedAt: string
  sourceUrl: string
  evidenceText: string
  confidence: number
  sourceKind: 'explicit_disclosure' | 'contest_holding' | 'text_inference'
}
```

关键说明：

- `contest_holding`: 来自实盘/比赛/持仓披露页面，可信度最高。
- `explicit_disclosure`: 来自帖子里明确表述，例如“持有”“买入”“清仓”。
- `text_inference`: 来自语义推断，例如“继续格局”“今天加了点”，可信度较低。

## 小作文采集模型

### NarrativeSource

```ts
interface NarrativeSource {
  id: string
  sourceType: 'taoguba' | 'manual' | 'web' | 'rss' | 'wechat_export' | 'telegram_export' | 'feishu'
  sourceName: string
  sourceUrl?: string
  authMode: 'public' | 'user_authorized' | 'manual'
  enabled: boolean
}
```

### NarrativeItem

```ts
interface NarrativeItem {
  id: string
  title?: string
  content: string
  contentHash: string
  sourceId: string
  sourceName: string
  sourceUrl?: string
  publishedAt?: string
  fetchedAt: string
  symbols: string[]
  sectors: string[]
  category: 'rumor' | 'review' | 'news_note' | 'research_excerpt' | 'social_post' | 'user_note'
  catalystScore: number
  confidenceScore: number
  riskScore: number
  aiSummary: string
  evidenceText: string[]
  contradictionIds: string[]
}
```

## 抽取能力

### 标的识别

输入：

- 股票代码：`600498`、`600498.SH`、`sh600498`
- 股票简称：`烽火通信`
- 常见别名：可由本地别名字典维护

输出：

- 标准 symbol：`600498.SH`
- 中文名：`烽火通信`
- 命中位置和证据文本

### 持仓事件识别

规则优先，LLM 辅助。

强规则示例：

```text
买入 / 新开 / 打板 / 低吸 / 半路 / 加仓 -> bought
持有 / 锁仓 / 格局 / 继续拿 -> holding
卖出 / 止盈 / 止损 / 减仓 -> sold
清仓 / 取关 / 全出 -> cleared
观察 / 加自选 / 明天看 -> watching
```

LLM 只做补充：

- 对含糊表述给低置信度。
- 必须输出证据句。
- 不允许凭空补股票或仓位。

### 小作文结构化

抽取字段：

- 涉及股票
- 涉及板块
- 催化类型：订单、政策、业绩、涨价、并购、AI、国产替代等
- 情绪方向：看多、看空、中性、不明确
- 时间敏感度：盘中、今日、短期、长期
- 可信度：来源明确性、是否有链接、是否可交叉验证
- 风险：传闻、滞后、反向兑现、监管、流动性

## 去重和版本

去重键：

```text
contentHash = sha256(normalizedText)
sourceUrl + publishedAt
authorId + contentHash
```

同一大 V 多次更新同一持仓：

- 保留所有原始事件。
- 当前持仓视图用最新事件聚合。
- 清仓事件会关闭对应 symbol 的 active holding。

## 后端设计

建议新增模块：

```text
src/market/social/
├── taoguba-provider.ts
├── narrative-extractor.ts
├── holding-extractor.ts
├── store.ts
└── types.ts
```

新增 API：

```text
GET  /api/market/social/taoguba/auth/status
POST /api/market/social/taoguba/fetch
GET  /api/market/social/taoguba/authors
PUT  /api/market/social/taoguba/authors
GET  /api/market/social/taoguba/posts
GET  /api/market/social/taoguba/holdings
POST /api/market/narratives/fetch
POST /api/market/narratives/import
```

现有接口可兼容：

```text
GET /api/market/influencers
GET /api/market/narratives
```

## 前端设计

Market tab 增加两个视图或子 tab：

- `大V跟踪`
- `小作文`

### 大 V 跟踪

需要展示：

- 授权状态
- 关注大 V 列表
- 最近帖子
- 最近持仓事件
- 当前推断持仓
- 每条持仓的来源链接和证据文本
- 置信度标签：高 / 中 / 低

### 小作文

需要展示：

- 来源配置
- 最近采集文本
- 结构化摘要
- 标的和板块命中
- 催化/风险评分
- 与行情/板块的交叉验证结果

## 调度

建议默认低频：

```bash
TAOGUBA_FETCH_INTERVAL_MS=600000
NARRATIVE_FETCH_INTERVAL_MS=300000
```

执行策略：

- 同一作者串行抓取。
- 全局并发不超过 2。
- 失败指数退避。
- 登录失效停止抓取并提示用户重新授权。

## 存储

建议本地 JSONL 或 SQLite。

MVP 可用：

```text
.market/social/authors.json
.market/social/posts.jsonl
.market/social/holdings.jsonl
.market/social/narratives.jsonl
```

生产化建议 SQLite：

```text
taoguba_authors
taoguba_posts
holding_events
narrative_items
fetch_runs
```

## 合规与安全

- 用户授权优先，所有授权状态本地保存。
- 不在日志输出 Cookie、Token、localStorage。
- 不抓取未授权内容。
- 所有持仓显示来源类型和置信度。
- “文本推断持仓”必须保留原文证据，不可展示成确定持仓。
- UI 需要明确提示：数据用于投研观察，不构成投资建议。

## MVP 实现步骤

1. 增加本地关注大 V 配置和手动 URL 导入。
2. 增加 agent/browser 授权抓取单页帖子正文。
3. 增加标的识别和持仓事件规则抽取。
4. 把抽取结果接入 `GET /api/market/influencers` 和 `GET /api/market/narratives`。
5. 前端 `大V跟踪` 展示帖子、持仓事件、证据句。
6. 增加定时抓取和登录失效提示。
7. 再接实盘/比赛持仓页，作为高置信度 `contest_holding`。

## 验收标准

- 用户能配置至少 3 个淘股吧作者。
- 用户登录授权后，能抓取最近帖子列表。
- 系统能从帖子中识别股票代码/简称。
- 明确持仓语句能生成 holding event。
- 小作文能生成摘要、标的、板块、催化、风险。
- 每条结果都有来源链接、证据句、置信度。
- 登录失效或页面结构变化时返回错误提示，不生成假数据。
