# AI 股票盯盘与投研辅助系统需求/技术方案

## 文档导航

这篇文档保留为总方案和范围定义。具体安装、运行和环境说明已拆分到子文档：

- Market 文档入口: [docs/market/README.md](/Users/bill/code/kraken-server/docs/market/README.md)
- AKShare / uv 安装: [docs/market/akshare-setup.md](/Users/bill/code/kraken-server/docs/market/akshare-setup.md)
- 数据源说明: [docs/market/data-sources.md](/Users/bill/code/kraken-server/docs/market/data-sources.md)
- 运行与排错: [docs/market/runbook.md](/Users/bill/code/kraken-server/docs/market/runbook.md)
- 环境变量入口: [docs/env/README.md](/Users/bill/code/kraken-server/docs/env/README.md)

## 1. 背景

用户希望在 Kraken Agent 里增加一个新的股票市场工作台，用 AI 辅助完成盘中盯盘、题材/板块强度分析、市场“小作文”研判、淘股吧大 V 动态跟踪、个股技术面分析和智能预警。

本方案把第一阶段定义为“投研辅助 + 盯盘提醒”，不直接自动下单。原因是该能力会触及证券投资建议、数据授权、自动化交易、平台内容抓取等高风险边界。第一版必须先把数据来源、分析依据、预警留痕和人工确认做稳，再评估是否进入模拟交易或实盘交易阶段。

## 2. 产品目标

- 在前端新增 `Market` tab，作为股票盯盘和投研入口。
- 支持自选股、重点板块、题材链、异动提醒、大 V 动态和 AI 分析报告统一展示。
- 支持盘前、盘中、午间、盘后和夜间复盘的自动扫描任务。
- 将“小作文”、论坛观点、公告、新闻、行情和技术指标关联起来，输出可追溯的判断依据。
- 让 AI 做总结、归因、风险提示和问题生成；让确定性计算模块负责行情、指标和评分。
- 所有预警和分析都保留数据来源、时间戳、模型版本和关键依据。

## 3. 非目标

- 第一阶段不接证券账户，不自动下单，不做自动撤单/追单/打板。
- 不承诺收益，不输出“保证上涨”“必买”等确定性结论。
- 不绕过数据平台授权、登录限制、反爬策略或付费墙。
- 不把论坛热度等同于事实，只作为情绪和资金关注度信号。
- 不做高频交易系统、Level-2 行情撮合系统或券商级 OMS。

## 4. 目标用户与核心场景

### 4.1 盘中盯盘

用户打开 `Market` tab 后，能看到：

- 大盘状态：指数涨跌、成交额、涨跌家数、连板/炸板/跌停概况。
- 自选股状态：涨跌幅、成交额、换手率、量比、分时异动、技术信号。
- 热门板块：板块涨幅、成交额、板块内涨停数、龙头股、扩散强度。
- 异动提醒：放量拉升、急跌、突破均线、回踩支撑、板块共振、消息触发。

### 4.2 小作文分析

当系统采集到市场传闻、研报摘录、社区短文或用户粘贴的小作文后：

- 自动提取涉及股票、板块、产业链、人物、机构、政策和时间点。
- 区分信息类型：官方公告、媒体新闻、券商观点、论坛观点、未证实传闻。
- 检查是否有公告、新闻或行情联动印证。
- 给出可信度、催化强度、受益链条、反证信息和风险点。

### 4.3 热门板块分析

系统按分钟级或用户触发扫描：

- 识别当日强势板块、持续性板块、轮动板块和退潮板块。
- 计算板块强度、领涨集中度、跟涨扩散度、成交占比、资金一致性。
- 汇总板块核心逻辑、龙头股、后排股、补涨股、风险股。
- 生成“板块热度变化”和“明日观察点”。

### 4.4 淘股吧大 V 跟踪

系统维护一个关注作者列表：

- 跟踪新帖、跟帖、观点变化、提及股票/板块和互动热度。
- 记录作者历史关注方向、观点命中情况和观点反转情况。
- 不把大 V 观点作为买卖依据，只作为市场情绪、题材扩散和注意力变化输入。
- 采集方式必须基于用户授权、公开页面或平台允许的方式，不做绕过登录或限制的抓取。

### 4.5 技术面分析

对指数、板块和个股生成技术面摘要：

- 趋势：均线排列、斜率、价格所在区间。
- 动量：MACD、RSI、KDJ、涨跌速率。
- 波动：ATR、布林带、振幅、缺口。
- 成交：量比、换手率、成交额、放量/缩量。
- 结构：突破、回踩、支撑/压力、平台整理、趋势破坏。

技术指标由代码计算，AI 只做解释和风险提示。

## 5. 合规与安全边界

### 5.1 投顾边界

若系统向用户提供证券品种选择、买卖时机或类似投资建议功能，需要符合证券投资顾问相关监管要求。第一阶段 UI 文案建议使用：

- “关注信号”
- “风险提示”
- “异动说明”
- “观察清单”
- “分析依据”

避免默认输出：

- “买入”
- “卖出”
- “满仓”
- “保证收益”
- “目标价必达”

### 5.2 数据授权

行情、公告、论坛和新闻均要按来源记录：

- `sourceName`
- `sourceUrl`
- `provider`
- `licenseType`
- `fetchedAt`
- `publishedAt`
- `rawHash`

实时行情优先选择已授权的数据服务；原型阶段可接入 AKShare/Tushare/交易所公开数据做验证，但不能把非授权抓取当作生产实时行情方案。

### 5.3 留痕

所有 AI 输出和预警保留：

- 输入数据快照或引用 ID。
- 模型名、prompt 版本、生成时间。
- 评分明细和阈值。
- 用户是否确认、忽略、收藏或标记错误。

## 6. 总体架构

```text
Market Data Providers
  |-- 行情: 交易所/数据商/AKShare/Tushare
  |-- 公告: 上交所/深交所/巨潮等
  |-- 新闻: RSS/API/授权数据商
  |-- 社区: 淘股吧等授权访问源
  v
src/market/providers/*
  v
Market Service
  |-- normalize
  |-- store
  |-- indicator compute
  |-- sector scoring
  |-- narrative extraction
  |-- alert rules
  v
REST API + WebSocket
  v
src/frontend/components/MarketPanel.tsx
  v
Market tab

Scheduler
  |-- 盘前扫描
  |-- 盘中轮询
  |-- 午间总结
  |-- 盘后复盘
  |-- 夜间大 V/小作文扫描

Agent Service / LLM
  |-- 小作文研判
  |-- 板块逻辑归因
  |-- 技术面解释
  |-- 风险摘要
```

当前仓库已有可复用基础：

- `src/frontend/App.tsx` 已有 tab 切换模式，适合增加 `market`。
- `src/server.ts` 已有 Express API、静态前端、配置接口和 WebSocket 服务。
- `src/scheduler/*` 已有定时任务能力，适合盘前/盘中/盘后任务。
- `src/runtime/agent-service.ts` 可复用为 AI 分析执行入口。
- `src/tools/agent-browser.ts` 可在授权登录场景下辅助读取网页，但不能绕过平台规则。

## 7. 新增前端设计

### 7.1 Tab 结构

在 `src/frontend/App.tsx` 中扩展：

```ts
type ActiveTab =
  | 'chat'
  | 'files'
  | 'scheduled'
  | 'usage'
  | 'evolution'
  | 'json'
  | 'market'
```

新增按钮：

```tsx
<button
  className="panel-tab"
  type="button"
  data-active={activeTab === 'market'}
  onClick={() => setActiveTab('market')}
>
  Market
</button>
```

新增组件：

```text
src/frontend/components/MarketPanel.tsx
src/frontend/hooks/useMarket.ts
```

### 7.2 Market 页面布局

建议第一版使用工作台布局：

- 顶部状态栏：交易日、数据延迟、Provider 状态、市场阶段。
- 左侧：自选股和关注板块。
- 中间：热门板块、异动流、小作文/新闻流。
- 右侧：AI 分析摘要、技术面、告警规则。

二级视图使用 tabs：

- `Overview`：市场总览。
- `Watchlist`：自选股。
- `Sectors`：热门板块。
- `Narratives`：小作文/新闻/公告分析。
- `Influencers`：淘股吧大 V 跟踪。
- `Technicals`：技术面分析。
- `Alerts`：盯盘规则和历史预警。

### 7.3 核心交互

- 点击股票：打开个股详情抽屉，展示行情、技术面、相关新闻、论坛提及、AI 摘要。
- 点击板块：展示板块内个股强弱、龙头、扩散、逻辑和风险。
- 点击小作文：展示原文摘要、实体提取、可信度评分、关联标的、反证信息。
- 点击大 V：展示最新观点、提及股票、历史主题、关注度变化。
- 点击告警：跳到触发依据，允许用户标记“有用/误报/已处理”。

## 8. 后端模块设计

建议新增目录：

```text
src/market/
├── types.ts
├── config.ts
├── store.ts
├── service.ts
├── indicators.ts
├── scoring.ts
├── alerts.ts
├── analysis.ts
├── routes.ts
├── providers/
│   ├── types.ts
│   ├── mock.ts
│   ├── akshare.ts
│   ├── tushare.ts
│   ├── exchange-public.ts
│   └── taoguba.ts
└── jobs/
    ├── premarket.ts
    ├── intraday.ts
    ├── noon-report.ts
    └── close-report.ts
```

职责：

- `providers/*`：只做外部数据获取和字段标准化。
- `store.ts`：持久化 watchlist、行情快照、事件、分析结果和告警。
- `indicators.ts`：纯函数计算技术指标。
- `scoring.ts`：确定性评分，不直接调用模型。
- `analysis.ts`：调用 Agent/LLM 生成自然语言分析。
- `alerts.ts`：规则匹配、去重、升级和静默。
- `routes.ts`：挂载 `/api/market/*`。

## 9. 数据存储

当前项目主要使用 JSON 文件持久化，但行情和事件数据更适合结构化存储。建议：

第一阶段：

- 配置、watchlist、告警规则继续用 JSON。
- 行情快照、事件流、分析结果使用 SQLite。
- 原始文本可保存 JSONL，并用 `rawHash` 去重。

建议目录：

```text
.market/
├── market.sqlite
├── watchlists.json
├── alert-rules.json
├── provider-state.json
└── raw/
    ├── narratives-YYYY-MM-DD.jsonl
    └── taoguba-YYYY-MM-DD.jsonl
```

## 10. 核心数据模型

### 10.1 标的

```ts
interface MarketSymbol {
  symbol: string
  exchange: 'SSE' | 'SZSE' | 'BJSE' | 'HKEX' | 'NASDAQ' | 'NYSE'
  name: string
  assetType: 'stock' | 'index' | 'etf' | 'sector'
  currency: string
  lotSize?: number
  status?: 'active' | 'suspended' | 'delisted'
}
```

### 10.2 行情快照

```ts
interface QuoteSnapshot {
  symbol: string
  ts: string
  price: number
  changePct: number
  open?: number
  high?: number
  low?: number
  previousClose?: number
  volume?: number
  amount?: number
  turnoverRate?: number
  volumeRatio?: number
  limitUp?: boolean
  limitDown?: boolean
  source: MarketSourceRef
}
```

### 10.3 板块强度

```ts
interface SectorHeat {
  sectorId: string
  sectorName: string
  ts: string
  changePct: number
  amount: number
  risingCount: number
  fallingCount: number
  limitUpCount: number
  leaderSymbols: string[]
  strengthScore: number
  diffusionScore: number
  persistenceScore: number
  riskScore: number
}
```

### 10.4 小作文/叙事事件

```ts
interface MarketNarrative {
  id: string
  title: string
  content: string
  contentHash: string
  source: MarketSourceRef
  publishedAt?: string
  fetchedAt: string
  symbols: string[]
  sectors: string[]
  entities: NarrativeEntity[]
  category: 'announcement' | 'news' | 'research' | 'social' | 'rumor' | 'user_note'
  confidenceScore: number
  catalystScore: number
  riskScore: number
  aiSummary?: string
  evidenceIds: string[]
  contradictionIds: string[]
}
```

### 10.5 大 V 动态

```ts
interface InfluencerPost {
  id: string
  platform: 'taoguba'
  authorId: string
  authorName: string
  title?: string
  content: string
  sourceUrl: string
  publishedAt?: string
  fetchedAt: string
  symbols: string[]
  sectors: string[]
  engagement: {
    views?: number
    replies?: number
    likes?: number
    favorites?: number
  }
  stance?: 'bullish' | 'bearish' | 'neutral' | 'unclear'
  noveltyScore: number
  influenceScore: number
}
```

### 10.6 告警

```ts
interface MarketAlert {
  id: string
  level: 'info' | 'watch' | 'urgent'
  title: string
  message: string
  symbols: string[]
  sectors: string[]
  triggeredAt: string
  ruleId?: string
  sourceEventIds: string[]
  status: 'new' | 'seen' | 'dismissed' | 'resolved'
  aiRationale?: string
}
```

## 11. API 设计

### 11.1 REST

```text
GET  /api/market/status
GET  /api/market/overview
GET  /api/market/watchlists
POST /api/market/watchlists
GET  /api/market/quotes?symbols=600000.SH,000001.SZ
GET  /api/market/sectors/hot
GET  /api/market/sectors/:sectorId
GET  /api/market/narratives
POST /api/market/narratives/analyze
GET  /api/market/influencers
POST /api/market/influencers
GET  /api/market/influencers/:authorId/posts
GET  /api/market/technicals/:symbol
GET  /api/market/alerts
POST /api/market/alerts/rules
PATCH /api/market/alerts/:alertId
POST /api/market/reports/run
```

### 11.2 WebSocket

新增 `WsClientMessage`：

```ts
type MarketClientMessage =
  | { type: 'market:subscribe'; requestId: string; payload: { symbols?: string[]; sectors?: string[] } }
  | { type: 'market:unsubscribe'; requestId: string }
  | { type: 'market:refresh'; requestId: string }
```

新增 `WsServerMessage`：

```ts
type MarketServerMessage =
  | { type: 'market:snapshot'; requestId?: string; payload: MarketOverview }
  | { type: 'market:quote'; payload: QuoteSnapshot }
  | { type: 'market:event'; payload: MarketNarrative | InfluencerPost }
  | { type: 'market:alert'; payload: MarketAlert }
```

## 12. 数据源策略

### 12.1 行情数据

推荐分层：

1. `mock` provider：前端和流程开发用。
2. `akshare` / `tushare` provider：原型验证和低频数据。
3. 商业授权 provider：生产实时行情。
4. 交易所公开数据：公告、市场概览、日频统计和公开查询。

Provider 必须声明：

- 是否实时。
- 延迟时间。
- 频率限制。
- 是否允许商用。
- 是否允许缓存。
- 字段覆盖范围。

### 12.2 淘股吧数据

第一阶段只做可配置关注列表和授权访问：

- 用户手工配置作者主页 URL 或作者 ID。
- 如果页面需要登录，使用用户授权的浏览器登录态。
- 请求频率必须低，默认分钟级或更低。
- 保存摘要和引用，不在 UI 大段搬运原文。
- 支持用户关闭采集、删除原始内容和清理 cookie。

### 12.3 新闻和公告

优先级：

1. 交易所公告和上市公司公告。
2. 官方媒体和监管公告。
3. 授权新闻源。
4. 社区/论坛/自媒体。
5. 用户粘贴内容。

AI 评分时，来源优先级直接影响 `confidenceScore`。

## 13. AI 分析流水线

### 13.1 小作文分析流程

```text
raw text
  -> 去重/清洗
  -> 股票/板块/实体提取
  -> 来源分级
  -> 检索公告/新闻/行情确认
  -> 可信度评分
  -> 催化路径分析
  -> 风险/反证生成
  -> 形成 NarrativeAnalysis
```

输出结构：

```ts
interface NarrativeAnalysis {
  summary: string
  keyClaims: string[]
  affectedSymbols: string[]
  affectedSectors: string[]
  confidenceScore: number
  catalystScore: number
  marketConfirmation: string[]
  missingEvidence: string[]
  riskNotes: string[]
  followUpQuestions: string[]
}
```

### 13.2 板块分析流程

```text
sector quotes + constituents + narratives
  -> 板块涨幅/成交额/涨停数
  -> 龙头识别
  -> 扩散强度
  -> 持续性评分
  -> 题材逻辑归因
  -> 风险提示
```

### 13.3 技术面分析流程

```text
OHLCV bars
  -> 计算指标
  -> 识别形态和关键价位
  -> 与板块/消息共振检查
  -> 生成摘要
```

AI prompt 必须要求输出：

- 当前结构。
- 触发条件。
- 失效条件。
- 风险点。
- 不确定性。

## 14. 评分设计

### 14.1 板块强度

```text
strengthScore =
  0.25 * normalizedChangePct
  + 0.20 * normalizedAmountShare
  + 0.20 * limitUpBreadth
  + 0.15 * leaderStrength
  + 0.10 * diffusionScore
  + 0.10 * persistenceScore
```

### 14.2 小作文可信度

```text
confidenceScore =
  sourceCredibility
  + corroborationScore
  + officialEvidenceScore
  + marketConfirmationScore
  - contradictionPenalty
  - rumorPenalty
```

### 14.3 技术面评分

```text
technicalScore =
  trendScore
  + momentumScore
  + volumeScore
  + volatilityScore
  + supportResistanceScore
  - riskPenalty
```

评分只用于排序和提示，不直接转成买卖建议。

## 15. 智能盯盘规则

第一阶段内置规则：

- 个股涨跌幅超过阈值。
- 成交额/量比突然放大。
- 自选股突破 N 日新高或跌破关键均线。
- 板块强度进入全市场前 N。
- 板块内多只个股同向异动。
- 小作文提及自选股且可信度超过阈值。
- 大 V 集中提及同一题材或同一股票。
- 技术面信号与消息/板块共振。

告警去重：

- 同一股票同一规则 N 分钟内只提醒一次。
- 同一小作文 `contentHash` 只分析一次。
- 同一大 V 帖子只生成一次事件。

## 16. 定时任务

可复用现有 `src/scheduler/*`：

```text
09:00  盘前扫描：公告、新闻、隔夜题材、重点关注
09:30  盘中任务开始：行情和告警轮询
11:35  午间总结：上午强势板块、小作文和风险
14:45  尾盘扫描：异动、回落、资金集中方向
15:15  盘后复盘：板块、个股、技术面、明日观察
20:00  夜间扫描：公告、新闻、论坛和大 V
```

实际时间应按交易所交易日历控制，非交易日不执行盘中任务。

## 17. 环境变量

```bash
MARKET_ENABLED=true
MARKET_PROVIDER=akshare-http
MARKET_ALLOW_MOCK_FALLBACK=false
MARKET_DB_PATH=.market/market.sqlite
MARKET_DEFAULT_UNIVERSE=A_SHARE
MARKET_QUOTE_POLL_MS=15000
MARKET_ALERT_COOLDOWN_MS=300000

# 原型数据源
AKSHARE_BASE_URL=http://127.0.0.1:8000
AKSHARE_TIMEOUT_MS=15000
TUSHARE_TOKEN=

# 淘股吧授权访问
TAOGUBA_ENABLED=false
TAOGUBA_POLL_MS=300000
TAOGUBA_AUTHOR_IDS=

# 如果通过 agent-browser 读取授权页面
ALLOW_AGENT_BROWSER=true
AGENT_BROWSER_AUTO_CONNECT=true
```

### 17.1 Provider 切换

当前实现支持两个 provider：

- `akshare-http`：默认 provider，连接本地 AKShare HTTP bridge，行情、日 K 和板块热度优先走真实数据。
- `mock`：仅用于前端开发或离线演示，需要显式设置 `MARKET_PROVIDER=mock`。
- `MARKET_ALLOW_MOCK_FALLBACK=false` 时，`akshare-http` 请求失败会直接返回错误，不再伪造行情或 K 线；板块/小作文/大 V 这类尚未接入真实源的模块返回空列表。

启用方式：

```bash
MARKET_PROVIDER=akshare-http
MARKET_ALLOW_MOCK_FALLBACK=false
AKSHARE_BASE_URL=http://127.0.0.1:8000
AKSHARE_TIMEOUT_MS=15000
```

当前 `akshare-http` 适配层约定三个 HTTP 接口：

```text
GET /api/market/quotes?symbols=600519.SH,300750.SZ
GET /api/market/bars?symbol=600519.SH&timeframe=1d&limit=90
GET /api/market/sectors/hot?limit=12
```

`quotes` 可返回 `{ "quotes": [...] }` 或数组。字段名可用 `symbol/code/ts_code`、`price/close/latest`、`previousClose/pre_close/prev_close`、`changePct/pct_chg/percent`、`volume/vol`、`amount` 等常见形式。

`bars` 可返回 `{ "bars": [...] }` 或数组。字段名可用 `symbol/code/ts_code`、`date/trade_date/datetime`、`open/high/low/close`、`volume/vol`、`amount`。第一阶段只支持日线 `1d`。

仓库提供了一个无额外 Web 框架依赖的 AKShare bridge：

```bash
python3 -m pip install akshare
python3 scripts/market/akshare_http_bridge.py --host 127.0.0.1 --port 8000
```

启动后可检查：

```bash
curl "http://127.0.0.1:8000/api/health"
curl "http://127.0.0.1:8000/api/market/quotes?symbols=600519.SH,300750.SZ"
curl "http://127.0.0.1:8000/api/market/bars?symbol=600519.SH&timeframe=1d&limit=90"
curl "http://127.0.0.1:8000/api/market/sectors/hot?limit=12"
```

然后把 Kraken 配成：

```bash
MARKET_PROVIDER=akshare-http
MARKET_ALLOW_MOCK_FALLBACK=false
AKSHARE_BASE_URL=http://127.0.0.1:8000
```

## 18. 分期实施

### Phase 0：文档和范围确认

- 明确市场范围：A 股优先，是否包含港股/美股另定。
- 明确数据源：原型数据源和生产数据源分开。
- 明确是否只做个人本地使用。

### Phase 1：只读 Market tab

- 新增 `Market` tab 和 `MarketPanel`。
- 新增 `mock` provider。
- 展示自选股、热门板块、技术面样例、告警样例。
- 完成 REST API 和前端 hook。

### Phase 2：行情与技术指标

- 接入一个低频行情 provider。
- 实现 watchlist、quote snapshot、OHLCV、基础指标。
- 实现告警规则和历史告警。

### Phase 3：小作文和大 V 跟踪

- 实现 narrative ingest。
- 实现 AI 小作文分析。
- 实现淘股吧关注作者列表和授权采集。
- 实现作者观点变化和题材提及统计。

### Phase 4：盘中智能盯盘

- 接入 scheduler 定时扫描。
- 实现板块热度、共振信号、异动流。
- 实现盘中/午间/盘后 AI 报告。

### Phase 5：模拟交易和回测

- 只做 paper trading。
- 记录信号触发后的表现。
- 评估误报率、漏报率、胜率、盈亏比和回撤。

### Phase 6：实盘交易评估

必须在合规、券商 API、风控、审计和人工确认全部到位后再评估：

- 交易账户授权。
- 下单二次确认。
- 单日亏损限制。
- 仓位限制。
- 黑名单。
- 全量审计日志。

## 19. 验收标准

Phase 1 完成标准：

- 前端出现 `Market` tab。
- `GET /api/market/overview` 返回市场概览；当真实数据源不可用时返回明确错误，而不是伪造行情。
- 用户能添加/删除自选股。
- 页面能展示热门板块、技术面摘要、异动提醒。
- 配置 `MARKET_PROVIDER=mock` 时系统可进入离线演示模式。

Phase 2 完成标准：

- 至少一个真实行情 provider 可用。
- 自选股能刷新行情。
- 技术指标由代码计算并可复现。
- 告警有去重、状态和历史。

Phase 3 完成标准：

- 用户可提交小作文并获得结构化分析。
- 大 V 跟踪只在授权或公开允许范围内运行。
- 每条分析都能追溯数据来源和时间。

## 20. 主要风险

- 数据源风险：免费/非正式接口可能变更、限流或禁止商用。
- 实时性风险：低频数据不适合做盘中高强度交易决策。
- 合规风险：自动输出具体买卖建议或收费服务可能进入投顾监管范围。
- 内容风险：小作文和论坛内容真假混杂，AI 容易放大未经证实的信息。
- 模型风险：LLM 可能幻觉，需要结构化证据和反证约束。
- 操作风险：如果未来接入实盘，下单必须人工确认和强风控。

## 21. 参考依据

- 中国证监会《证券投资顾问业务暂行规定》：软件工具提供投资建议或类似功能时，应说明功能、风险、数据来源、方法和局限，并保留服务依据。参考：https://www.gov.cn/gongbao/content/2011/content_1808618.htm
- 上交所官网和对外公示数据目录：可作为公开市场数据、公告和统计信息来源之一。参考：https://www.sse.com.cn/
- 深交所官网市场数据：可作为公开市场数据、公告和统计信息来源之一。参考：https://www.szse.cn/
- Tushare 数据平台：可作为原型阶段的数据接入参考。参考：https://tushare.pro/
- AKShare 在线文档和源码仓库：可作为原型阶段的数据接入参考。参考：https://akshare-hh.readthedocs.io/en/latest/index.html 和 https://github.com/akfamily/akshare
- 淘股吧隐私协议和官网：社区内容采集需注意个人信息、账号、日志和授权边界。参考：https://www.tgb.cn/aboutus/privacy 和 https://tgb.cn/newIndex/
