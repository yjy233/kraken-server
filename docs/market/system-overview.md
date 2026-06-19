# AI 股票系统技术概览

## 目标

在 Kraken Agent 内提供一个只读投研工作台，用于：

- A 股盯盘
- 自选股监控
- 热门板块观察
- 小作文结构化分析
- 淘股吧大 V 跟踪预留
- 技术面分析
- 研究型报告

系统只做投研辅助，不自动下单，不输出交易指令。

## 当前模块

```text
src/market/
├── indicators.ts
├── routes.ts
├── service.ts
├── store.ts
├── types.ts
└── providers/
    ├── akshare-http.ts
    ├── index.ts
    ├── mock.ts
    ├── types.ts
    └── unavailable.ts
```

前端入口：

```text
src/frontend/components/MarketPanel.tsx
src/frontend/hooks/useMarket.ts
```

Bridge 脚本：

```text
scripts/market/akshare_http_bridge.py
```

## 接口

当前 Market 接口：

```text
GET    /api/market/status
GET    /api/market/overview
GET    /api/market/watchlists
POST   /api/market/watchlists
PUT    /api/market/watchlists
DELETE /api/market/watchlists/:symbol
GET    /api/market/quotes
GET    /api/market/sectors/hot
GET    /api/market/narratives
POST   /api/market/narratives/analyze
GET    /api/market/influencers
GET    /api/market/technicals/:symbol
GET    /api/market/bars/:symbol
GET    /api/market/alerts
POST   /api/market/reports/run
```

## Provider 切换

入口：

```text
src/market/providers/index.ts
```

环境变量：

```bash
MARKET_PROVIDER=akshare-http
MARKET_ALLOW_MOCK_FALLBACK=false
```

支持：

- `akshare-http`：默认真实数据 bridge
- `mock`：显式样本数据模式
- 未知 provider：返回明确错误

## 技术指标

代码位置：

```text
src/market/indicators.ts
```

当前指标：

- MA5 / MA10 / MA20
- RSI6
- MACD
- ATR14
- 支撑 / 压力
- 量能状态

## 下一步建议

优先级从高到低：

1. 为 K 线增加 bridge 侧缓存，降低 `overview` 首次加载时间。
2. 为板块热度改接更稳定直连源。
3. 增加公告/新闻 provider。
4. 增加淘股吧授权采集 provider。
5. 把 report 接入 scheduler，生成盘中/盘后自动报告。
