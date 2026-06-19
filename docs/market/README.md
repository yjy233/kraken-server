# Market 文档

这组文档只覆盖 `Market` tab、AKShare bridge、行情数据源和投研工作台相关内容。

## 文档索引

- [系统方案总览](./system-overview.md)
- [AKShare 与 uv 安装](./akshare-setup.md)
- [数据源说明](./data-sources.md)
- [运行与排错](./runbook.md)

## 当前实现边界

- 默认市场 provider：`akshare-http`
- 默认不允许 fallback 到 mock
- 实时 quotes：当前 bridge 直接调用新浪 quote 接口
- 日 K / 技术指标: 当前 bridge 走 AKShare / 腾讯历史行情
- 板块热度：预留为真实源；当前上游不稳定时返回空列表，不造假
- 小作文 / 大 V: 还没有接入真实授权源

## 相关文件

- Bridge 脚本：[`scripts/market/akshare_http_bridge.py`](/Users/bill/code/kraken-server/scripts/market/akshare_http_bridge.py)
- 方案文档: [`docs/ai-stock-trading-system.md`](/Users/bill/code/kraken-server/docs/ai-stock-trading-system.md)
- 环境示例: [`.env.example`](/Users/bill/code/kraken-server/.env.example)
- Python 依赖: [`pyproject.toml`](/Users/bill/code/kraken-server/pyproject.toml)
