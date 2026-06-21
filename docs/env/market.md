# Market 环境配置

## 推荐配置

本地真实行情模式：

```bash
MARKET_ENABLED=true
MARKET_PROVIDER=akshare-http
MARKET_ALLOW_MOCK_FALLBACK=false
AKSHARE_BASE_URL=http://127.0.0.1:8000
AKSHARE_TIMEOUT_MS=15000
AKSHARE_CACHE_DIR=.cache/akshare-http
```

说明：

- `MARKET_PROVIDER=akshare-http`: 使用本地 Python bridge。
- `MARKET_ALLOW_MOCK_FALLBACK=false`: 不允许失败后回落样本数据。
- `AKSHARE_BASE_URL`: bridge 地址。
- `AKSHARE_TIMEOUT_MS`: Kraken 调 bridge 的超时。`overview` 会拉 K 线和技术指标，建议至少 15000。
- `AKSHARE_CACHE_DIR`: Python bridge 的磁盘缓存目录。未设置时默认 `.cache/akshare-http`。

## Bridge 缓存

AKShare 某些接口很慢，特别是龙虎榜、营业部活跃榜和营业部历史明细。现在默认龙虎榜只看近 14 天；bridge 会先查内存缓存，再查磁盘缓存；只有缓存缺失或过期时才请求 AKShare。

默认缓存策略：

| 数据 | 缓存方式 | 默认有效期 |
| --- | --- | --- |
| 实时 quotes | 内存 | 20 秒 |
| 热门板块 | 内存 + 磁盘 | 30 分钟 |
| 龙虎榜股票/机构统计 | 内存 + 磁盘 | 6 小时 |
| 龙虎榜席位/营业部战绩 | 内存 + 磁盘 | 24 小时 |

缓存只保存真实 AKShare 返回结果，不会生成样本数据。删除缓存目录后会重新拉取。

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
uv run python scripts/market/akshare_http_bridge.py --host 127.0.0.1 --port 8000 --cache-dir .cache/akshare-http
```

使用系统 Python：

```bash
python3 -m pip install akshare
python3 scripts/market/akshare_http_bridge.py --host 127.0.0.1 --port 8000 --cache-dir .cache/akshare-http
```

## 验证

```bash
curl "http://127.0.0.1:8000/api/health"
curl "http://127.0.0.1:8000/api/market/cache/status"
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

## 淘股吧与小作文预留配置

这些变量用于后续授权采集，不应提交真实 Cookie。

```bash
TAOGUBA_ENABLED=false
TAOGUBA_AUTH_MODE=browser
TAOGUBA_COOKIE=
TAOGUBA_USER_AGENTS=
TAOGUBA_FETCH_INTERVAL_MS=600000
TAOGUBA_MAX_POSTS_PER_AUTHOR=30
NARRATIVE_FETCH_INTERVAL_MS=300000
```

说明：

- `TAOGUBA_AUTH_MODE=browser`: 用户通过浏览器/agent 手动登录后采集。
- `TAOGUBA_AUTH_MODE=cookie`: 用户自己提供合法 Cookie。
- `TAOGUBA_USER_AGENTS`: 关注的大 V 名称或 ID，逗号分隔。
- `TAOGUBA_COOKIE`: 只能放 `.env.local` 或本机密钥存储，日志不得输出。
- 采集结果必须保留来源链接、证据句和置信度。

## 淘股吧热门股票热榜

热门股票页可以直接通过 `agent-browser` 打开淘股吧页面抓取，不再依赖自选股生成热榜。用户需要自己完成登录/授权；系统不会绕过验证码、付费墙或站点权限。抓取失败时返回空结果和错误信息，不会 mock 热榜。

```bash
ALLOW_AGENT_BROWSER=true
AGENT_BROWSER_ALLOWED_DOMAINS=tgb.cn,www.tgb.cn
TAOGUBA_HOTSTOCKS_ENABLED=true
TAOGUBA_HOTSTOCKS_URLS=https://www.tgb.cn/search/hotPop
TAOGUBA_HOTSTOCKS_LIMIT=20
TAOGUBA_HOTSTOCKS_CACHE_TTL_MS=300000
TAOGUBA_HOTSTOCKS_TIMEOUT_MS=30000
```

说明：

- `ALLOW_AGENT_BROWSER=true`: 允许 Kraken 调用本机 `agent-browser`。
- `AGENT_BROWSER_ALLOWED_DOMAINS`: 限定浏览器工具只能访问淘股吧域名。
- `TAOGUBA_HOTSTOCKS_ENABLED=true`: 启用淘股吧热门股票采集。
- `TAOGUBA_HOTSTOCKS_URLS`: 默认使用淘股吧搜索热度页，可配置多个 URL，用逗号分隔。
- `TAOGUBA_HOTSTOCKS_CACHE_TTL_MS`: 热榜缓存时间，避免页面刷新时频繁打开浏览器。
- `TAOGUBA_HOTSTOCKS_TIMEOUT_MS`: 单次浏览器命令超时。

安装 `agent-browser`：

```bash
npm install
npx agent-browser install
```

如果你使用全局安装，也可以设置：

```bash
AGENT_BROWSER_BIN=agent-browser
```

启动后先在本机浏览器/agent-browser 会话里完成淘股吧登录，再刷新 Market 页面。热门股票卡片会优先展示淘股吧热榜，行情和技术面由当前 `MARKET_PROVIDER` 补齐；如果 provider 没有返回热榜标的行情，页面会显示“待补行情”。
