# Market 数据源说明

## 当前数据链路

```text
MarketPanel
  -> /api/market/*
  -> src/market/service.ts
  -> src/market/providers/akshare-http.ts
  -> scripts/market/akshare_http_bridge.py
  -> 公开市场数据源
```

## 已接入

### 1. 实时行情 quotes

当前 bridge 直接调用新浪 quote API：

```text
https://hq.sinajs.cn/list=sh600519,sz300750,sh000001
```

用途：

- 自选股现价
- 指数现价
- 涨跌额 / 涨跌幅
- 开高低收
- 成交量 / 成交额

为什么不用 `ak.stock_zh_a_spot()` 做实时行情：

- 它会扫全市场 5000 多只股票
- 冷启动可能超过 10 秒
- 多个请求并发时容易拖慢 Market 首页

因此当前实时行情使用更轻的“按指定 symbol 查询”。

### 2. 日 K / 技术面

当前 bridge 优先用 AKShare 的腾讯历史行情接口：

```python
ak.stock_zh_a_hist_tx(symbol="sh600519", start_date="...", end_date="...", adjust="")
```

失败时 fallback 到 AKShare 东方财富历史行情：

```python
ak.stock_zh_a_hist(symbol="600519", period="daily", adjust="")
```

用途：

- MA5 / MA10 / MA20
- RSI6
- MACD
- ATR14
- 支撑 / 压力
- 技术摘要

### 3. 指数行情

指数同样走新浪 quote API：

```text
sh000001 -> 000001.SH
sz399001 -> 399001.SZ
sz399006 -> 399006.SZ
```

用途：

- 上证指数
- 深证成指
- 创业板指

## 已预留但当前不强制显示

### 1. 板块热度

当前代码预留：

```python
ak.stock_board_industry_name_em()
```

这一路上游当前不稳定，失败时返回空列表。系统不会使用 mock 板块填充。

后续可替换为：

- 东方财富行业/概念接口的更稳定直连
- Tushare Pro
- Choice / Wind / iFinD
- 用户自有数据商接口

### 2. 小作文 / 新闻 / 公告

当前只支持用户手动粘贴小作文并结构化分析。

后续按用户授权源接入，详见：

```text
docs/market/taoguba-and-narratives.md
```

可接入：

- 公告源
- 新闻源
- 研报源
- 社区传闻源
- 淘股吧帖子 / 博客 / 实盘披露
- 用户导出的群聊或网页文本

### 3. 淘股吧大 V

当前没有真实授权源。

要求：

- 不绕过登录
- 不绕过平台限制
- 优先用户授权浏览器会话
- 或用户提供合法 API / 导出数据
- 所有持仓必须标注来源类型：实盘披露、明确文本自述、文本推断

## 严格禁用 mock 策略

默认配置：

```bash
MARKET_PROVIDER=akshare-http
MARKET_ALLOW_MOCK_FALLBACK=false
```

行为：

- 行情请求失败：API 返回明确错误
- K 线请求失败：API 返回明确错误
- 板块上游失败：返回空列表
- 小作文 / 大 V 未配置真实源：返回空列表
- 只有显式设置 `MARKET_PROVIDER=mock` 才使用样本数据

## 生产化建议

AKShare 适合原型和个人投研，不适合生产级交易系统主行情源。

后续生产化建议分层：

- `free`：AKShare / 新浪 / 腾讯公开源
- `licensed`：Tushare Pro / Choice / Wind / iFinD
- `broker`：券商行情和交易 API

Provider 接口已经集中在：

```text
src/market/providers/*
```

后续换源时不要改前端，只新增 provider 并在环境变量中切换。
