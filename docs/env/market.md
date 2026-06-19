# Market 环境配置

## 推荐配置

本地真实行情模式：

```bash
MARKET_ENABLED=true
MARKET_PROVIDER=akshare-http
MARKET_ALLOW_MOCK_FALLBACK=false
AKSHARE_BASE_URL=http://127.0.0.1:8000
AKSHARE_TIMEOUT_MS=15000
```

说明：

- `MARKET_PROVIDER=akshare-http`: 使用本地 Python bridge。
- `MARKET_ALLOW_MOCK_FALLBACK=false`: 不允许失败后回落样本数据。
- `AKSHARE_BASE_URL`: bridge 地址。
- `AKSHARE_TIMEOUT_MS`: Kraken 调 bridge 的超时。`overview` 会拉 K 线和技术指标，建议至少 15000。

## 离线演示模式

如果没有 bridge，也想看 UI：

```bash
MARKET_PROVIDER=mock
```

注意：这是显式样本模式，不应当用于真实盯盘。

## Bridge 启动

使用 uv：

```bash
uv sync
uv run python scripts/market/akshare_http_bridge.py --host 127.0.0.1 --port 8000
```

使用系统 Python：

```bash
python3 -m pip install akshare
python3 scripts/market/akshare_http_bridge.py --host 127.0.0.1 --port 8000
```

## 验证

```bash
curl "http://127.0.0.1:8000/api/health"
curl "http://127.0.0.1:8000/api/market/quotes?symbols=600519.SH,300750.SZ"
curl "http://127.0.0.1:3011/api/market/quotes?symbols=600519.SH,300750.SZ"
```

## 当前 no-mock 行为

| 数据类型 | 失败行为 |
| --- | --- |
| quotes | 返回 API 错误 |
| bars | 返回 API 错误 |
| sectors | 返回空列表 |
| narratives | 返回空列表 |
| influencers | 返回空列表 |

这符合当前策略：不伪造行情，不用样本数据冒充真实数据。
