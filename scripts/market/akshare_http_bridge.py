#!/usr/bin/env python3
"""
Small AKShare HTTP bridge for Kraken Market.

It exposes the minimal API consumed by MARKET_PROVIDER=akshare-http:

  GET /api/market/quotes?symbols=600519.SH,300750.SZ
  GET /api/market/bars?symbol=600519.SH&timeframe=1d&limit=90

Install dependency separately:

  python3 -m pip install akshare

This bridge intentionally has no Flask/FastAPI dependency so it can run in a
plain Python environment.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from datetime import date, datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse
import requests

QUOTE_CACHE_TTL_SECONDS = 20
INDEX_CACHE_TTL_SECONDS = 20
SECTOR_CACHE_TTL_SECONDS = 60

_CACHE: dict[str, tuple[float, Any]] = {}


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Kraken AKShare HTTP bridge")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()

    handler = build_handler(debug=args.debug)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"AKShare HTTP bridge listening on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping AKShare HTTP bridge", flush=True)
    finally:
        server.server_close()
    return 0


def build_handler(debug: bool):
    class Handler(BaseHTTPRequestHandler):
        server_version = "KrakenAKShareBridge/0.1"

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            try:
                if parsed.path == "/api/health":
                    self.respond_json({"ok": True, "provider": "akshare-http", "now": now_iso()})
                    return
                if parsed.path == "/api/market/quotes":
                    symbols = parse_symbols(query.get("symbols", [""])[0])
                    self.respond_json({"ok": True, "quotes": get_quotes(symbols)})
                    return
                if parsed.path == "/api/market/bars":
                    symbol = normalize_symbol(first(query, "symbol"))
                    timeframe = first(query, "timeframe") or "1d"
                    limit = parse_int(first(query, "limit"), 90)
                    if not symbol:
                        self.respond_json({"ok": False, "error": "symbol is required"}, HTTPStatus.BAD_REQUEST)
                        return
                    if timeframe != "1d":
                        self.respond_json({"ok": False, "error": "only 1d timeframe is supported"}, HTTPStatus.BAD_REQUEST)
                        return
                    self.respond_json({"ok": True, "bars": get_bars(symbol, limit)})
                    return
                if parsed.path == "/api/market/sectors/hot":
                    limit = parse_int(first(query, "limit"), 12)
                    self.respond_json({"ok": True, "sectors": get_hot_sectors(limit)})
                    return
                self.respond_json({"ok": False, "error": "not found"}, HTTPStatus.NOT_FOUND)
            except Exception as exc:  # noqa: BLE001 - this is a boundary process.
                payload: dict[str, Any] = {"ok": False, "error": str(exc)}
                if debug:
                    payload["traceback"] = traceback.format_exc()
                self.respond_json(payload, HTTPStatus.INTERNAL_SERVER_ERROR)

        def log_message(self, fmt: str, *args: Any) -> None:
            sys.stderr.write("%s - - [%s] %s\n" % (
                self.address_string(),
                self.log_date_time_string(),
                fmt % args,
            ))

        def respond_json(self, payload: dict[str, Any], status: int = HTTPStatus.OK) -> None:
            body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            self.send_response(int(status))
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("content-length", str(len(body)))
            self.send_header("access-control-allow-origin", "*")
            self.end_headers()
            self.wfile.write(body)

    return Handler


def get_quotes(symbols: list[str]) -> list[dict[str, Any]]:
    rows = load_sina_quote_rows(symbols)
    quotes: list[dict[str, Any]] = []
    for symbol in symbols:
        row = rows.get(symbol)
        if not row:
            continue
        price = to_float(get_any(row, ["最新价", "price", "close"]))
        previous_close = to_float(get_any(row, ["昨收", "previousClose", "pre_close"])) or price
        change_pct = to_float(get_any(row, ["涨跌幅", "changePct", "pct_chg"]))
        change = to_float(get_any(row, ["涨跌额", "change"]))
        quotes.append({
            "symbol": symbol,
            "name": str(get_any(row, ["名称", "name"]) or ""),
            "price": price,
            "change": change if change else price - previous_close,
            "changePct": change_pct,
            "open": to_float(get_any(row, ["今开", "open"])) or price,
            "high": to_float(get_any(row, ["最高", "high"])) or price,
            "low": to_float(get_any(row, ["最低", "low"])) or price,
            "previousClose": previous_close,
            "volume": to_float(get_any(row, ["成交量", "volume", "vol"])),
            "amount": to_float(get_any(row, ["成交额", "amount"])),
            "turnoverRate": to_float(get_any(row, ["换手率", "turnoverRate"])),
            "volumeRatio": to_float(get_any(row, ["量比", "volumeRatio"])) or 1,
            "ts": now_iso(),
        })
    return quotes


def get_bars(symbol: str, limit: int) -> list[dict[str, Any]]:
    ak = import_akshare()
    rows = get_daily_bar_rows(ak, symbol, limit)
    bars = []
    for row in rows[-max(1, min(limit, 300)):]:
        date_value = get_any(row, ["日期", "date", "trade_date"])
        bars.append({
            "symbol": symbol,
            "date": normalize_date(date_value),
            "open": to_float(get_any(row, ["开盘", "open"])),
            "high": to_float(get_any(row, ["最高", "high"])),
            "low": to_float(get_any(row, ["最低", "low"])),
            "close": to_float(get_any(row, ["收盘", "close"])),
            "volume": to_float(get_any(row, ["成交量", "volume", "vol"])),
            "amount": to_float(get_any(row, ["成交额", "amount"])),
        })
    return bars


def get_hot_sectors(limit: int) -> list[dict[str, Any]]:
    ak = import_akshare()
    rows = get_cached("sectors", SECTOR_CACHE_TTL_SECONDS, lambda: normalize_table(ak.stock_board_industry_name_em()))
    sectors = []
    for row in rows[: max(1, min(limit, 100))]:
        change_pct = to_float(get_any(row, ["涨跌幅", "changePct", "pct_chg"]))
        rising_count = to_float(get_any(row, ["上涨家数", "risingCount"]))
        falling_count = to_float(get_any(row, ["下跌家数", "fallingCount"]))
        sectors.append({
            "sectorId": get_any(row, ["板块代码", "code"]),
            "sectorName": get_any(row, ["板块名称", "名称", "name"]),
            "changePct": change_pct,
            "amount": to_float(get_any(row, ["成交额", "amount"])),
            "risingCount": rising_count,
            "fallingCount": falling_count,
            "limitUpCount": to_float(get_any(row, ["涨停家数", "limitUpCount"])),
            "leaderSymbol": normalize_symbol(get_any(row, ["领涨股票代码", "leaderSymbol"])),
            "strengthScore": clamp_score(50 + change_pct * 8),
            "diffusionScore": compute_diffusion_score(rising_count, falling_count),
            "ts": now_iso(),
        })
    return sectors


def load_stock_spot_rows(ak: Any) -> dict[str, dict[str, Any]]:
    rows = get_cached("stock_zh_a_spot", QUOTE_CACHE_TTL_SECONDS, lambda: normalize_table(ak.stock_zh_a_spot()))
    by_symbol: dict[str, dict[str, Any]] = {}
    for row in rows:
        symbol = normalize_symbol(get_any(row, ["代码", "symbol", "code"]))
        if symbol:
            by_symbol[symbol] = row
    return by_symbol


def load_index_spot_rows(ak: Any) -> dict[str, dict[str, Any]]:
    rows = get_cached("stock_zh_index_spot", INDEX_CACHE_TTL_SECONDS, lambda: normalize_table(ak.stock_zh_index_spot_sina()))
    aliases = {
        "SH000001": "000001.SH",
        "SZ399001": "399001.SZ",
        "SZ399006": "399006.SZ",
        "000001": "000001.SH",
        "399001": "399001.SZ",
        "399006": "399006.SZ",
    }
    by_symbol: dict[str, dict[str, Any]] = {}
    for row in rows:
        raw_code = str(get_any(row, ["代码", "symbol", "code"]) or "").strip().upper()
        symbol = aliases.get(raw_code) or aliases.get(raw_code.replace("SH", "").replace("SZ", "")) or normalize_symbol(raw_code)
        if symbol:
            by_symbol[symbol] = row
    return by_symbol


def load_sina_quote_rows(symbols: list[str]) -> dict[str, dict[str, Any]]:
    if not symbols:
        return {}
    query_symbols = [to_sina_symbol(symbol) for symbol in symbols]
    cache_key = "sina_quotes:" + ",".join(query_symbols)
    return get_cached(cache_key, QUOTE_CACHE_TTL_SECONDS, lambda: fetch_sina_quote_rows(symbols, query_symbols))


def fetch_sina_quote_rows(symbols: list[str], query_symbols: list[str]) -> dict[str, dict[str, Any]]:
    response = requests.get(
        "https://hq.sinajs.cn/list=" + ",".join(query_symbols),
        headers={"Referer": "https://finance.sina.com.cn"},
        timeout=8,
    )
    response.raise_for_status()
    response.encoding = "GB18030"
    rows: dict[str, dict[str, Any]] = {}
    for symbol, line in zip(symbols, response.text.splitlines()):
        row = parse_sina_quote_line(line)
        if row:
            rows[symbol] = row
    return rows


def parse_sina_quote_line(line: str) -> dict[str, Any] | None:
    if '="' not in line:
        return None
    raw = line.split('="', 1)[1].rstrip('";')
    fields = raw.split(",")
    if len(fields) < 32 or not fields[0]:
        return None
    return {
        "名称": fields[0],
        "今开": fields[1],
        "昨收": fields[2],
        "最新价": fields[3],
        "最高": fields[4],
        "最低": fields[5],
        "成交量": fields[8],
        "成交额": fields[9],
        "日期": fields[30],
        "时间": fields[31],
        "涨跌额": to_float(fields[3]) - to_float(fields[2]),
        "涨跌幅": ((to_float(fields[3]) - to_float(fields[2])) / to_float(fields[2]) * 100) if to_float(fields[2]) else 0,
    }


def get_daily_bar_rows(ak: Any, symbol: str, limit: int) -> list[dict[str, Any]]:
    tx_symbol = to_tx_symbol(symbol)
    start_date = (date.today() - timedelta(days=max(120, limit * 3))).strftime("%Y%m%d")
    end_date = (date.today() + timedelta(days=1)).strftime("%Y%m%d")
    try:
        return normalize_table(ak.stock_zh_a_hist_tx(
            symbol=tx_symbol,
            start_date=start_date,
            end_date=end_date,
            adjust="",
        ))
    except Exception:
        ak_symbol = symbol.split(".")[0]
        return normalize_table(ak.stock_zh_a_hist(
            symbol=ak_symbol,
            period="daily",
            adjust="",
        ))


def import_akshare():
    try:
        import akshare as ak  # type: ignore
    except ImportError as exc:
        raise RuntimeError("akshare is not installed. Run: python3 -m pip install akshare") from exc
    return ak


def normalize_table(table: Any) -> list[dict[str, Any]]:
    if hasattr(table, "to_dict"):
        return table.to_dict(orient="records")
    if isinstance(table, list):
        return [row for row in table if isinstance(row, dict)]
    return []


def parse_symbols(value: str) -> list[str]:
    return [symbol for symbol in (normalize_symbol(item) for item in value.split(",")) if symbol]


def get_cached(key: str, ttl_seconds: int, loader):
    now = time.time()
    cached = _CACHE.get(key)
    if cached and now - cached[0] < ttl_seconds:
      return cached[1]
    value = loader()
    _CACHE[key] = (now, value)
    return value


def normalize_symbol(value: Any) -> str:
    raw = str(value or "").strip().upper()
    if not raw:
        return ""
    if raw.endswith(".SH") or raw.endswith(".SZ") or raw.endswith(".BJ"):
        return raw
    if raw.startswith("SH") and len(raw) == 8:
        return f"{raw[2:]}.SH"
    if raw.startswith("SZ") and len(raw) == 8:
        return f"{raw[2:]}.SZ"
    if raw.startswith("BJ") and len(raw) == 8:
        return f"{raw[2:]}.BJ"
    if len(raw) == 6 and raw.isdigit():
        if raw.startswith("6"):
            return f"{raw}.SH"
        if raw.startswith("8") or raw.startswith("4"):
            return f"{raw}.BJ"
        return f"{raw}.SZ"
    return raw


def to_sina_symbol(symbol: str) -> str:
    normalized = normalize_symbol(symbol)
    code, _, exchange = normalized.partition(".")
    if exchange == "SH":
        return f"sh{code}"
    if exchange == "SZ":
        return f"sz{code}"
    if exchange == "BJ":
        return f"bj{code}"
    return normalized.lower()


def is_index_symbol(symbol: str) -> bool:
    return symbol in {"000001.SH", "399001.SZ", "399006.SZ"}


def to_tx_symbol(symbol: str) -> str:
    normalized = normalize_symbol(symbol)
    code, _, exchange = normalized.partition(".")
    if exchange == "SH":
        return f"sh{code}"
    if exchange == "SZ":
        return f"sz{code}"
    if exchange == "BJ":
        return f"bj{code}"
    return normalized.lower()


def get_any(row: dict[str, Any], keys: list[str]) -> Any:
    for key in keys:
        if key in row:
            return row[key]
    return None


def first(query: dict[str, list[str]], key: str) -> str:
    values = query.get(key, [])
    return values[0] if values else ""


def parse_int(value: str, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def compute_diffusion_score(rising_count: float, falling_count: float) -> int:
    total = rising_count + falling_count
    if total <= 0:
        return 50
    return clamp_score(rising_count / total * 100)


def clamp_score(value: float) -> int:
    return max(0, min(100, round(value)))


def to_float(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    raw = str(value).strip().replace(",", "").replace("%", "")
    if raw in {"", "-", "None", "nan"}:
        return 0.0
    try:
        return float(raw)
    except ValueError:
        return 0.0


def normalize_date(value: Any) -> str:
    raw = str(value or "").strip()
    if len(raw) == 8 and raw.isdigit():
        return f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}"
    return raw


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


if __name__ == "__main__":
    raise SystemExit(main())
