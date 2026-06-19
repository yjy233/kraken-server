# Market 启动与排错

## 启动顺序

1. 安装 Node 依赖
2. 安装 Python 依赖
3. 启动 AKShare bridge
4. 启动 Kraken Server

建议命令：

```bash
bun install
uv sync
uv run python scripts/market/akshare_http_bridge.py --host 127.0.0.1 --port 8000
PATH=/opt/homebrew/bin:$PATH ./node_modules/.bin/tsx src/server.ts
```

## 关键端口

- Kraken Server: `3011`
- AKShare bridge: `8000`

检查端口：

```bash
lsof -iTCP:3011 -sTCP:LISTEN -n -P
lsof -iTCP:8000 -sTCP:LISTEN -n -P
```

## 最小可用检查

### bridge 检查

```bash
curl "http://127.0.0.1:8000/api/health"
curl "http://127.0.0.1:8000/api/market/quotes?symbols=600519.SH,300750.SZ"
curl "http://127.0.0.1:8000/api/market/bars?symbol=600519.SH&timeframe=1d&limit=30"
```

### Kraken 检查

```bash
curl "http://127.0.0.1:3011/api/market/status"
curl "http://127.0.0.1:3011/api/market/quotes?symbols=600519.SH,300750.SZ"
curl "http://127.0.0.1:3011/api/market/overview"
```

## 常见故障

### 1. `AKShare HTTP quotes failed: fetch failed`

原因通常是：

- `AKSHARE_BASE_URL` 配错
- bridge 没启动
- 8000 端口没监听

排查：

```bash
curl "http://127.0.0.1:8000/api/health"
```

### 2. `AKShare HTTP quotes failed: This operation was aborted`

原因通常是：

- quotes 冷启动耗时
- `AKSHARE_TIMEOUT_MS` 太小

建议：

```bash
AKSHARE_TIMEOUT_MS=15000
```

### 3. `akshare is not installed`

说明 bridge 当前 Python 环境里没装依赖。

修复：

```bash
uv sync
```

### 4. Market 首页有行情，但板块为空

这是当前预期行为之一。

说明：

- 行情真实源已通
- 板块热度源当前不稳定
- 系统选择返回空列表，而不是 mock

### 5. `MARKET_PROVIDER` 配错后看不到行情

现在系统不会自动回到 mock。

如果要明确进入样本模式，必须显式设置：

```bash
MARKET_PROVIDER=mock
```

## 运行建议

### 本地个人使用建议

- `MARKET_PROVIDER=akshare-http`
- `MARKET_ALLOW_MOCK_FALLBACK=false`
- `AKSHARE_TIMEOUT_MS=15000`

### 离线演示模式

```bash
MARKET_PROVIDER=mock
```

### 持续开发建议

- Node 服务单独跑
- bridge 单独跑
- 两边日志分开看

这样定位问题最快。
