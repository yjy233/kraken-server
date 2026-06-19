# AKShare 与 uv 安装

## 目的

Kraken 的 `Market` tab 不直接调用 Python。它通过本地 HTTP bridge 间接读取行情：

```text
Kraken Server (Node/TS)
  -> http://127.0.0.1:8000
  -> scripts/market/akshare_http_bridge.py
  -> akshare / 新浪 / 腾讯 / 公开网页源
```

因此要让 `Market` tab 有真实数据，必须先准备 Python 依赖并启动 bridge。

## 1. 使用 uv 安装

仓库根目录已经提供 [`pyproject.toml`](/Users/bill/code/kraken-server/pyproject.toml)。

如果本机还没装 `uv`：

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

在仓库根目录执行：

```bash
uv sync
```

这会安装 `akshare` 到 uv 管理的虚拟环境。

## 2. 启动 AKShare bridge

推荐用 `uv run`，这样不依赖系统 Python 当前环境：

```bash
uv run python scripts/market/akshare_http_bridge.py --host 127.0.0.1 --port 8000
```

启动成功后应看到：

```text
AKShare HTTP bridge listening on http://127.0.0.1:8000
```

## 3. 健康检查

先检查 bridge：

```bash
curl "http://127.0.0.1:8000/api/health"
curl "http://127.0.0.1:8000/api/market/quotes?symbols=600519.SH,300750.SZ"
curl "http://127.0.0.1:8000/api/market/bars?symbol=600519.SH&timeframe=1d&limit=30"
```

再检查 Kraken：

```bash
curl "http://127.0.0.1:3011/api/market/status"
curl "http://127.0.0.1:3011/api/market/quotes?symbols=600519.SH,300750.SZ"
curl "http://127.0.0.1:3011/api/market/overview"
```

## 4. 当前 Python 依赖

当前只固定了一个 Python 依赖：

```toml
akshare==1.18.64
```

如果后面 bridge 增加单独的 `requests`、`pandas` 或缓存库，再补充到 `pyproject.toml`。

## 5. 常见错误

### `AKShare HTTP quotes failed: fetch failed`

通常是 bridge 没启动：

```bash
lsof -iTCP:8000 -sTCP:LISTEN -n -P
```

如果没有监听，先启动：

```bash
uv run python scripts/market/akshare_http_bridge.py --host 127.0.0.1 --port 8000
```

### `akshare is not installed`

说明 bridge 用的 Python 环境里没有安装依赖，重新执行：

```bash
uv sync
```

### `This operation was aborted`

说明 Kraken 请求 bridge 时超时了。优先检查：

- bridge 是否真的启动
- `AKSHARE_BASE_URL` 是否正确
- `AKSHARE_TIMEOUT_MS` 是否过小

当前建议超时值：

```bash
AKSHARE_TIMEOUT_MS=15000
```
