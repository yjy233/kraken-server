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
import hashlib
import json
import math
import os
import sys
import time
import traceback
from datetime import date, datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse
import requests

QUOTE_CACHE_TTL_SECONDS = 20
INDEX_CACHE_TTL_SECONDS = 20
SECTOR_CACHE_TTL_SECONDS = 60
DRAGON_TIGER_CACHE_TTL_SECONDS = 6 * 60 * 60
DRAGON_TIGER_DETAIL_CACHE_TTL_SECONDS = 24 * 60 * 60
DRAGON_TIGER_BROKER_CACHE_TTL_SECONDS = 24 * 60 * 60
DRAGON_TIGER_ARCHIVE_CACHE_TTL_SECONDS = 10 * 365 * 24 * 60 * 60
DRAGON_TIGER_TODAY_CACHE_TTL_SECONDS = 30 * 60
DISK_CACHE_VERSION = 1
DISK_CACHE_ROOT = Path(os.environ.get("AKSHARE_CACHE_DIR") or ".cache/akshare-http")

_CACHE: dict[str, tuple[float, Any]] = {}


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Kraken AKShare HTTP bridge")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--cache-dir", default=os.environ.get("AKSHARE_CACHE_DIR") or ".cache/akshare-http")
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()

    global DISK_CACHE_ROOT
    DISK_CACHE_ROOT = Path(args.cache_dir).expanduser()
    DISK_CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    handler = build_handler(debug=args.debug)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"AKShare HTTP bridge listening on http://{args.host}:{args.port}", flush=True)
    print(f"AKShare disk cache: {DISK_CACHE_ROOT}", flush=True)
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
                if parsed.path == "/api/market/cache/status":
                    self.respond_json({"ok": True, "cache": get_cache_status()})
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
                    if timeframe not in {"1d", "1m", "5m", "15m", "30m", "60m", "1mo", "1y"}:
                        self.respond_json({"ok": False, "error": "only 1m, 5m, 15m, 30m, 60m, 1d, 1mo, and 1y timeframes are supported"}, HTTPStatus.BAD_REQUEST)
                        return
                    self.respond_json({"ok": True, "bars": get_bars(symbol, timeframe, limit)})
                    return
                if parsed.path == "/api/market/sectors/hot":
                    limit = parse_int(first(query, "limit"), 12)
                    self.respond_json({"ok": True, "sectors": get_hot_sectors(limit)})
                    return
                if parsed.path == "/api/market/dragon-tiger":
                    window = first(query, "window") or "近14天"
                    limit = parse_int(first(query, "limit"), 20)
                    self.respond_json({"ok": True, "stocks": get_dragon_tiger_stocks(window, limit)})
                    return
                if parsed.path == "/api/market/dragon-tiger/daily":
                    window = first(query, "window") or "近14天"
                    limit = parse_int(first(query, "limit"), 160)
                    self.respond_json({"ok": True, "dailyStocks": get_dragon_tiger_daily_stocks(window, limit)})
                    return
                if parsed.path == "/api/market/dragon-tiger/seats":
                    symbol = normalize_symbol(first(query, "symbol"))
                    trade_date = first(query, "tradeDate") or ""
                    if not symbol:
                        self.respond_json({"ok": False, "error": "symbol is required"}, HTTPStatus.BAD_REQUEST)
                        return
                    self.respond_json({"ok": True, "seats": get_dragon_tiger_seats(symbol, trade_date)})
                    return
                if parsed.path == "/api/market/dragon-tiger/institutions":
                    window = first(query, "window") or "近一月"
                    limit = parse_int(first(query, "limit"), 20)
                    self.respond_json({"ok": True, "institutions": get_dragon_tiger_institutions(window, limit)})
                    return
                if parsed.path == "/api/market/dragon-tiger/broker-trades":
                    broker_name = first(query, "brokerName")
                    broker_code = first(query, "brokerCode")
                    trade_date = first(query, "tradeDate")
                    limit = parse_int(first(query, "limit"), 12)
                    if not broker_name and not broker_code:
                        self.respond_json({"ok": False, "error": "brokerName or brokerCode is required"}, HTTPStatus.BAD_REQUEST)
                        return
                    self.respond_json({
                        "ok": True,
                        "trades": get_dragon_tiger_broker_trades(broker_name, broker_code, trade_date, limit),
                    })
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
            body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
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


def get_bars(symbol: str, timeframe: str, limit: int) -> list[dict[str, Any]]:
    ak = import_akshare()
    if is_minute_timeframe(timeframe):
        rows = get_minute_bar_rows(ak, symbol, timeframe)
    else:
        calendar_days = max(limit * 3, 120)
        if timeframe == "1mo":
            calendar_days = max(limit * 35, 420)
        elif timeframe == "1y":
            calendar_days = max(limit * 380, 760)
        rows = get_daily_bar_rows(ak, symbol, calendar_days)
        if timeframe == "1mo":
            rows = aggregate_bar_rows(rows, "month")
        elif timeframe == "1y":
            rows = aggregate_bar_rows(rows, "year")
    bars = []
    max_rows = 240 if timeframe == "1m" else 300 if timeframe == "1d" else 180
    for row in rows[-max(1, min(limit, max_rows)):]:
        date_value = get_any(row, ["时间", "日期", "date", "trade_date", "day"])
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
    max_rows = max(1, min(limit, 100))
    rows = get_cached(
        "sectors:hot",
        SECTOR_CACHE_TTL_SECONDS,
        lambda: load_hot_sector_rows(ak, max_rows),
    )
    sectors = []
    for row in rows[:max_rows]:
        change_pct = to_float(get_any(row, ["涨跌幅", "changePct", "pct_chg"]))
        rising_count = to_float(get_any(row, ["上涨家数", "risingCount"]))
        falling_count = to_float(get_any(row, ["下跌家数", "fallingCount"]))
        diffusion_score = compute_diffusion_score(rising_count, falling_count)
        if rising_count <= 0 and falling_count <= 0:
            diffusion_score = clamp_score(50 + change_pct * 6)
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
            "diffusionScore": diffusion_score,
            "persistenceScore": clamp_score(to_float(get_any(row, ["persistenceScore"])) or 50 + change_pct * 4),
            "riskScore": clamp_score(to_float(get_any(row, ["riskScore"])) or max(25, 68 - max(change_pct, 0) * 3)),
            "sourceName": normalize_text(get_any(row, ["sourceName"])) or "AKShare",
            "ts": now_iso(),
        })
    return sectors


def load_hot_sector_rows(ak: Any, limit: int) -> list[dict[str, Any]]:
    loaders = [
        ("eastmoney-industry", "industry_name_em", lambda: normalize_table(ak.stock_board_industry_name_em())),
        ("eastmoney-concept", "concept_name_em", lambda: normalize_table(ak.stock_board_concept_name_em())),
        ("ths-industry", "industry_name_ths", lambda: load_ths_industry_sector_rows(ak, limit)),
    ]
    errors: list[str] = []
    for source_name, cache_key, loader in loaders:
        try:
            rows = get_disk_cached(
                "sectors",
                cache_key,
                30 * 60,
                loader,
            )
            normalized_rows = [dict(row, sourceName=source_name) for row in rows if isinstance(row, dict)]
            if normalized_rows:
                return normalized_rows
        except Exception as exc:  # noqa: BLE001 - keep bridge resilient across public data sources.
            errors.append(f"{source_name}: {exc}")
            continue
    if errors:
        print("AKShare sector loaders failed: " + " | ".join(errors), file=sys.stderr, flush=True)
    return []


def load_ths_industry_sector_rows(ak: Any, limit: int) -> list[dict[str, Any]]:
    name_rows = normalize_table(ak.stock_board_industry_name_ths())
    candidates = name_rows[: max(limit * 3, 24)]
    end_date = date.today()
    start_date = end_date - timedelta(days=14)
    rows: list[dict[str, Any]] = []
    for item in candidates:
        sector_name = normalize_text(get_any(item, ["name", "板块名称", "名称"]))
        sector_code = normalize_text(get_any(item, ["code", "板块代码"]))
        if not sector_name:
            continue
        try:
            index_rows = normalize_table(ak.stock_board_industry_index_ths(
                symbol=sector_name,
                start_date=start_date.strftime("%Y%m%d"),
                end_date=end_date.strftime("%Y%m%d"),
            ))
        except Exception as exc:  # noqa: BLE001 - one sector failure should not blank the whole tab.
            print(f"AKShare THS sector index failed for {sector_name}: {exc}", file=sys.stderr, flush=True)
            continue
        if len(index_rows) < 2:
            continue
        previous_row = index_rows[-2]
        latest_row = index_rows[-1]
        previous_close = to_float(get_any(previous_row, ["收盘价", "收盘", "close"]))
        latest_close = to_float(get_any(latest_row, ["收盘价", "收盘", "close"]))
        change_pct = (latest_close - previous_close) / previous_close * 100 if previous_close else 0.0
        amount = to_float(get_any(latest_row, ["成交额", "amount"]))
        rows.append({
            "板块代码": sector_code,
            "板块名称": sector_name,
            "涨跌幅": change_pct,
            "成交额": amount,
            "上涨家数": 0,
            "下跌家数": 0,
            "涨停家数": 0,
            "领涨股票代码": "",
            "persistenceScore": compute_sector_persistence_score(index_rows),
            "riskScore": compute_sector_risk_score(index_rows),
        })
    rows.sort(key=lambda row: (to_float(get_any(row, ["涨跌幅"])), to_float(get_any(row, ["成交额"]))), reverse=True)
    return rows[: max(limit, 1)]


def compute_sector_persistence_score(rows: list[dict[str, Any]]) -> int:
    recent_rows = rows[-5:]
    if len(recent_rows) < 2:
        return 50
    up_days = 0
    comparisons = 0
    for index in range(1, len(recent_rows)):
        previous_close = to_float(get_any(recent_rows[index - 1], ["收盘价", "收盘", "close"]))
        close = to_float(get_any(recent_rows[index], ["收盘价", "收盘", "close"]))
        if previous_close:
            comparisons += 1
            if close >= previous_close:
                up_days += 1
    return clamp_score(35 + (up_days / comparisons * 55 if comparisons else 15))


def compute_sector_risk_score(rows: list[dict[str, Any]]) -> int:
    recent_rows = rows[-6:]
    if len(recent_rows) < 2:
        return 50
    changes: list[float] = []
    for index in range(1, len(recent_rows)):
        previous_close = to_float(get_any(recent_rows[index - 1], ["收盘价", "收盘", "close"]))
        close = to_float(get_any(recent_rows[index], ["收盘价", "收盘", "close"]))
        if previous_close:
            changes.append((close - previous_close) / previous_close * 100)
    if not changes:
        return 50
    volatility = sum(abs(value) for value in changes) / len(changes)
    latest_change = changes[-1]
    return clamp_score(38 + volatility * 8 + max(0, latest_change) * 3)


def get_dragon_tiger_stocks(window: str, limit: int) -> list[dict[str, Any]]:
    ak = import_akshare()
    normalized_window = window if window in {"近14天", "14天", "近一月", "近三月", "近六月", "近一年"} else "近14天"
    end_date = date.today()
    start_date = end_date - timedelta(days=14 if normalized_window in {"近14天", "14天"} else 20)
    detail_rows = get_dragon_tiger_detail_rows(ak, start_date, end_date)

    if normalized_window in {"近14天", "14天"}:
        return build_dragon_tiger_stocks_from_detail(detail_rows, limit)

    stats_rows = get_cached(
        f"dragon_tiger_stats:{normalized_window}",
        300,
        lambda: get_disk_cached(
            "dragon_tiger_stats",
            normalized_window,
            DRAGON_TIGER_CACHE_TTL_SECONDS,
            lambda: normalize_table(ak.stock_lhb_stock_statistic_em(symbol=normalized_window)),
        ),
    )
    detail_by_symbol: dict[str, dict[str, Any]] = {}
    for row in detail_rows:
        symbol = normalize_symbol(get_any(row, ["代码", "symbol", "code"]))
        if not symbol:
            continue
        listed_at = normalize_date(get_any(row, ["上榜日", "date"]))
        current = detail_by_symbol.get(symbol)
        current_date = normalize_date(get_any(current, ["上榜日", "date"])) if current else ""
        if not current or listed_at > current_date:
            detail_by_symbol[symbol] = row

    stocks = []
    for row in stats_rows[: max(1, min(limit, 100))]:
        symbol = normalize_symbol(get_any(row, ["代码", "symbol", "code"]))
        if not symbol:
            continue
        detail = detail_by_symbol.get(symbol, {})
        latest_listed_at = normalize_date(get_any(row, ["最近上榜日", "上榜日", "date"])) or normalize_date(get_any(detail, ["上榜日", "date"]))
        stocks.append({
            "symbol": symbol,
            "name": get_any(row, ["名称", "name"]),
            "latestListedAt": latest_listed_at,
            "closePrice": to_float(get_any(row, ["收盘价", "close"])),
            "changePct": to_float(get_any(row, ["涨跌幅", "pct_chg"])),
            "listingCount": parse_int(str(get_any(row, ["上榜次数", "count"]) or 0), 0),
            "netBuyAmount": to_float(get_any(row, ["龙虎榜净买额", "netBuyAmount"])),
            "buyAmount": to_float(get_any(row, ["龙虎榜买入额", "buyAmount"])),
            "sellAmount": to_float(get_any(row, ["龙虎榜卖出额", "sellAmount"])),
            "totalAmount": to_float(get_any(row, ["龙虎榜总成交额", "龙虎榜成交额", "totalAmount"])),
            "institutionBuyCount": parse_int(str(get_any(row, ["买方机构次数", "institutionBuyCount"]) or 0), 0),
            "institutionSellCount": parse_int(str(get_any(row, ["卖方机构次数", "institutionSellCount"]) or 0), 0),
            "institutionNetBuyAmount": to_float(get_any(row, ["机构买入净额", "institutionNetBuyAmount"])),
            "interpretation": normalize_text(get_any(detail, ["解读", "interpretation"])),
            "listingReason": normalize_text(get_any(detail, ["上榜原因", "reason"])),
            "after1DayReturn": to_float(get_any(detail, ["上榜后1日", "after1DayReturn"])),
            "after2DayReturn": to_float(get_any(detail, ["上榜后2日", "after2DayReturn"])),
            "after5DayReturn": to_float(get_any(detail, ["上榜后5日", "after5DayReturn"])),
            "after10DayReturn": to_float(get_any(detail, ["上榜后10日", "after10DayReturn"])),
            "ts": now_iso(),
        })
    return stocks


def get_dragon_tiger_daily_stocks(window: str, limit: int) -> list[dict[str, Any]]:
    ak = import_akshare()
    normalized_window = window if window in {"近14天", "14天", "近一月"} else "近14天"
    end_date = date.today()
    start_date = end_date - timedelta(days=14 if normalized_window in {"近14天", "14天"} else 31)
    detail_rows = get_dragon_tiger_detail_rows(ak, start_date, end_date)
    daily_rows: list[dict[str, Any]] = []
    for row in detail_rows:
        raw_index = parse_int(str(get_any(row, ["序号", "index"]) or 0), 0)
        symbol = normalize_symbol(get_any(row, ["代码", "symbol", "code"]))
        trade_date = normalize_date(get_any(row, ["上榜日", "日期", "date"]))
        if not symbol or not trade_date:
            continue
        daily_rows.append({
            "rawIndex": raw_index,
            "tradeDate": trade_date,
            "symbol": symbol,
            "name": normalize_text(get_any(row, ["名称", "name"])),
            "closePrice": to_float(get_any(row, ["收盘价", "close"])),
            "changePct": to_float(get_any(row, ["涨跌幅", "pct_chg"])),
            "netBuyAmount": to_float(get_any(row, ["龙虎榜净买额", "netBuyAmount"])),
            "buyAmount": to_float(get_any(row, ["龙虎榜买入额", "buyAmount"])),
            "sellAmount": to_float(get_any(row, ["龙虎榜卖出额", "sellAmount"])),
            "totalAmount": to_float(get_any(row, ["龙虎榜成交额", "龙虎榜总成交额", "totalAmount"])),
            "marketAmount": to_float(get_any(row, ["市场总成交额", "marketAmount"])),
            "netBuyRatio": to_float(get_any(row, ["净买额占总成交比", "netBuyRatio"])),
            "turnoverAmountRatio": to_float(get_any(row, ["成交额占总成交比", "turnoverAmountRatio"])),
            "turnoverRate": to_float(get_any(row, ["换手率", "turnoverRate"])),
            "floatMarketCap": to_float(get_any(row, ["流通市值", "floatMarketCap"])),
            "interpretation": normalize_text(get_any(row, ["解读", "interpretation"])),
            "listingReason": normalize_text(get_any(row, ["上榜原因", "reason"])),
            "after1DayReturn": to_float(get_any(row, ["上榜后1日", "after1DayReturn"])),
            "after2DayReturn": to_float(get_any(row, ["上榜后2日", "after2DayReturn"])),
            "after5DayReturn": to_float(get_any(row, ["上榜后5日", "after5DayReturn"])),
            "after10DayReturn": to_float(get_any(row, ["上榜后10日", "after10DayReturn"])),
            "ts": now_iso(),
            "raw": row,
        })
    daily_rows.sort(key=lambda item: (
        -parse_int(str(item["tradeDate"]).replace("-", ""), 0),
        parse_int(str(item.get("rawIndex") or 999999), 999999),
    ))
    return daily_rows[: max(1, min(limit, 500))]


def build_dragon_tiger_stocks_from_detail(detail_rows: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    by_symbol: dict[str, dict[str, Any]] = {}
    for row in detail_rows:
        symbol = normalize_symbol(get_any(row, ["代码", "symbol", "code"]))
        if not symbol:
            continue
        listed_at = normalize_date(get_any(row, ["上榜日", "date"]))
        item = by_symbol.setdefault(symbol, {
            "symbol": symbol,
            "name": get_any(row, ["名称", "name"]),
            "latestListedAt": listed_at,
            "closePrice": to_float(get_any(row, ["收盘价", "close"])),
            "changePct": to_float(get_any(row, ["涨跌幅", "pct_chg"])),
            "listingCount": 0,
            "netBuyAmount": 0.0,
            "buyAmount": 0.0,
            "sellAmount": 0.0,
            "totalAmount": 0.0,
            "institutionBuyCount": 0,
            "institutionSellCount": 0,
            "institutionNetBuyAmount": 0.0,
            "interpretation": normalize_text(get_any(row, ["解读", "interpretation"])),
            "listingReason": normalize_text(get_any(row, ["上榜原因", "reason"])),
            "after1DayReturn": to_float(get_any(row, ["上榜后1日", "after1DayReturn"])),
            "after2DayReturn": to_float(get_any(row, ["上榜后2日", "after2DayReturn"])),
            "after5DayReturn": to_float(get_any(row, ["上榜后5日", "after5DayReturn"])),
            "after10DayReturn": to_float(get_any(row, ["上榜后10日", "after10DayReturn"])),
            "ts": now_iso(),
        })
        item["listingCount"] += 1
        item["netBuyAmount"] += to_float(get_any(row, ["龙虎榜净买额", "netBuyAmount"]))
        item["buyAmount"] += to_float(get_any(row, ["龙虎榜买入额", "buyAmount"]))
        item["sellAmount"] += to_float(get_any(row, ["龙虎榜卖出额", "sellAmount"]))
        item["totalAmount"] += to_float(get_any(row, ["龙虎榜总成交额", "龙虎榜成交额", "totalAmount"]))
        item["institutionNetBuyAmount"] += extract_institution_net_buy(row)
        if listed_at > str(item.get("latestListedAt") or ""):
            item["latestListedAt"] = listed_at
            item["name"] = get_any(row, ["名称", "name"])
            item["closePrice"] = to_float(get_any(row, ["收盘价", "close"]))
            item["changePct"] = to_float(get_any(row, ["涨跌幅", "pct_chg"]))
            item["interpretation"] = normalize_text(get_any(row, ["解读", "interpretation"]))
            item["listingReason"] = normalize_text(get_any(row, ["上榜原因", "reason"]))
            item["after1DayReturn"] = to_float(get_any(row, ["上榜后1日", "after1DayReturn"]))
            item["after2DayReturn"] = to_float(get_any(row, ["上榜后2日", "after2DayReturn"]))
            item["after5DayReturn"] = to_float(get_any(row, ["上榜后5日", "after5DayReturn"]))
            item["after10DayReturn"] = to_float(get_any(row, ["上榜后10日", "after10DayReturn"]))

    stocks = sorted(
        by_symbol.values(),
        key=lambda item: (int(item.get("listingCount") or 0), abs(float(item.get("netBuyAmount") or 0))),
        reverse=True,
    )
    return stocks[: max(1, min(limit, 100))]


def get_dragon_tiger_detail_rows(ak: Any, start_date: date, end_date: date) -> list[dict[str, Any]]:
    cache_key = f"dragon_tiger_detail_daily:{start_date.strftime('%Y%m%d')}:{end_date.strftime('%Y%m%d')}"
    return get_cached(
        cache_key,
        300,
        lambda: load_dragon_tiger_detail_rows_by_day(ak, start_date, end_date),
    )


def load_dragon_tiger_detail_rows_by_day(ak: Any, start_date: date, end_date: date) -> list[dict[str, Any]]:
    requested_dates = list(iter_calendar_dates(start_date, end_date))
    cached_by_day: dict[str, list[dict[str, Any]]] = {}
    missing_dates: list[str] = []
    for day in requested_dates:
        day_key = day.strftime("%Y%m%d")
        cached_rows = read_dragon_tiger_day_cache(day_key)
        if cached_rows is None:
            if is_probably_closed_market_day(day):
                cached_by_day[day_key] = []
                write_dragon_tiger_day_cache(day_key, [])
                continue
            missing_dates.append(day_key)
            continue
        cached_by_day[day_key] = cached_rows

    if missing_dates:
        fetched_by_day = fetch_dragon_tiger_detail_rows_for_days(ak, missing_dates)
        for day_key in missing_dates:
            day_rows = fetched_by_day.get(day_key, [])
            write_dragon_tiger_day_cache(day_key, day_rows)
            cached_by_day[day_key] = day_rows

    merged_rows: list[dict[str, Any]] = []
    for day in requested_dates:
        merged_rows.extend(cached_by_day.get(day.strftime("%Y%m%d"), []))
    return merged_rows


def fetch_dragon_tiger_detail_rows_for_days(ak: Any, day_keys: list[str]) -> dict[str, list[dict[str, Any]]]:
    by_day: dict[str, list[dict[str, Any]]] = {day_key: [] for day_key in day_keys}
    fetchable_days = [day_key for day_key in day_keys if not is_probably_closed_market_day(parse_compact_date(day_key))]
    if not fetchable_days:
        return by_day

    try:
        fetched_rows = normalize_table(
            ak.stock_lhb_detail_em(
                start_date=min(fetchable_days),
                end_date=max(fetchable_days),
            )
        )
        fetched_by_day = split_rows_by_trade_date(fetched_rows, fetchable_days)
        for day_key in fetchable_days:
            by_day[day_key] = fetched_by_day.get(day_key, [])
        return by_day
    except Exception:
        for day_key in fetchable_days:
            try:
                fetched_rows = normalize_table(
                    ak.stock_lhb_detail_em(
                        start_date=day_key,
                        end_date=day_key,
                    )
                )
                by_day[day_key] = split_rows_by_trade_date(fetched_rows, [day_key]).get(day_key, [])
            except Exception:
                by_day[day_key] = []
        return by_day


def iter_calendar_dates(start_date: date, end_date: date) -> list[date]:
    if start_date > end_date:
        return []
    days: list[date] = []
    current = start_date
    while current <= end_date:
        days.append(current)
        current += timedelta(days=1)
    return days


def split_rows_by_trade_date(rows: list[dict[str, Any]], expected_dates: list[str] | None = None) -> dict[str, list[dict[str, Any]]]:
    by_day: dict[str, list[dict[str, Any]]] = {day: [] for day in (expected_dates or [])}
    for row in rows:
        day_key = normalize_trade_date(get_any(row, ["上榜日", "日期", "date"]))
        if not day_key:
            continue
        by_day.setdefault(day_key, []).append(row)
    return by_day


def read_dragon_tiger_day_cache(day_key: str) -> list[dict[str, Any]] | None:
    path = build_disk_cache_path("dragon_tiger_detail_daily", day_key)
    try:
        if not path.exists():
            return None
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if payload.get("version") != DISK_CACHE_VERSION:
            return None
        fetched_at = float(payload.get("fetchedAtEpoch") or 0)
        if fetched_at <= 0:
            return None
        today_key = date.today().strftime("%Y%m%d")
        fetched_day_key = datetime.fromtimestamp(fetched_at).strftime("%Y%m%d")
        if day_key < today_key and fetched_day_key <= day_key:
            return None
        if time.time() - fetched_at > get_dragon_tiger_day_cache_ttl(day_key):
            return None
        data = payload.get("data")
        return data if isinstance(data, list) else None
    except Exception:
        return None


def write_dragon_tiger_day_cache(day_key: str, rows: list[dict[str, Any]]) -> None:
    write_disk_cache(build_disk_cache_path("dragon_tiger_detail_daily", day_key), rows)


def get_dragon_tiger_day_cache_ttl(day_key: str) -> int:
    today_key = date.today().strftime("%Y%m%d")
    if day_key >= today_key:
        return DRAGON_TIGER_TODAY_CACHE_TTL_SECONDS
    return DRAGON_TIGER_ARCHIVE_CACHE_TTL_SECONDS


def is_probably_closed_market_day(value: date | None) -> bool:
    if value is None:
        return False
    return value.weekday() >= 5


def extract_institution_net_buy(row: dict[str, Any]) -> float:
    value = get_any(row, ["机构买入净额", "institutionNetBuyAmount"])
    if value is not None:
        return to_float(value)
    interpretation = normalize_text(get_any(row, ["解读", "interpretation"]))
    if "机构买入" in interpretation and "机构卖出" not in interpretation:
        return to_float(get_any(row, ["龙虎榜净买额", "netBuyAmount"]))
    if "机构卖出" in interpretation and "机构买入" not in interpretation:
        return -abs(to_float(get_any(row, ["龙虎榜净买额", "netBuyAmount"])))
    return 0.0


def get_dragon_tiger_seats(symbol: str, trade_date: str) -> list[dict[str, Any]]:
    ak = import_akshare()
    normalized_symbol = normalize_symbol(symbol)
    code = normalized_symbol.split(".")[0]
    available_dates = get_cached(
        f"dragon_tiger_dates:{code}",
        300,
        lambda: get_disk_cached(
            "dragon_tiger_dates",
            code,
            DRAGON_TIGER_DETAIL_CACHE_TTL_SECONDS,
            lambda: normalize_table(ak.stock_lhb_stock_detail_date_em(symbol=code)),
        ),
    )
    resolved_date = normalize_trade_date(trade_date)
    if not resolved_date:
        for row in available_dates:
            resolved_date = normalize_trade_date(get_any(row, ["交易日", "date"]))
            if resolved_date:
                break
    if not resolved_date:
        return []

    seats: list[dict[str, Any]] = []
    for flag, side in [("买入", "buy"), ("卖出", "sell")]:
        rows = get_cached(
            f"dragon_tiger_seats:{code}:{resolved_date}:{flag}",
            300,
            lambda flag=flag: get_disk_cached(
                "dragon_tiger_seats",
                f"{code}:{resolved_date}:{flag}",
                DRAGON_TIGER_DETAIL_CACHE_TTL_SECONDS,
                lambda: normalize_table(ak.stock_lhb_stock_detail_em(symbol=code, date=resolved_date, flag=flag)),
            ),
        )
        for row in rows[:10]:
            broker_name = normalize_text(get_any(row, ["交易营业部名称", "营业部名称", "brokerName"]))
            seats.append({
                "symbol": normalized_symbol,
                "tradeDate": resolved_date,
                "side": side,
                "rank": parse_int(str(get_any(row, ["序号", "rank"]) or 0), 0),
                "brokerName": broker_name,
                "buyAmount": to_float(get_any(row, ["买入金额", "buyAmount"])),
                "buyAmountRatio": to_float(get_any(row, ["买入金额-占总成交比例", "buyAmountRatio"])),
                "sellAmount": to_float(get_any(row, ["卖出金额", "sellAmount"])),
                "sellAmountRatio": to_float(get_any(row, ["卖出金额-占总成交比例", "sellAmountRatio"])),
                "netAmount": to_float(get_any(row, ["净额", "netAmount"])),
                "seatType": infer_seat_type(broker_name),
                "reason": normalize_text(get_any(row, ["类型", "reason"])),
                "ts": now_iso(),
            })
    return seats


def get_dragon_tiger_institutions(window: str, limit: int) -> list[dict[str, Any]]:
    ak = import_akshare()
    normalized_window = window if window in {"近一月", "近三月", "近六月", "近一年"} else "近一月"
    rows = get_cached(
        f"dragon_tiger_institutions:{normalized_window}",
        300,
        lambda: get_disk_cached(
            "dragon_tiger_institutions",
            normalized_window,
            DRAGON_TIGER_CACHE_TTL_SECONDS,
            lambda: normalize_table(ak.stock_lhb_jgstatistic_em(symbol=normalized_window)),
        ),
    )
    institutions = []
    for row in rows[: max(1, min(limit, 100))]:
        symbol = normalize_symbol(get_any(row, ["代码", "symbol", "code"]))
        if not symbol:
            continue
        institutions.append({
            "symbol": symbol,
            "name": normalize_text(get_any(row, ["名称", "name"])),
            "closePrice": to_float(get_any(row, ["收盘价", "close"])),
            "changePct": to_float(get_any(row, ["涨跌幅", "pct_chg"])),
            "totalAmount": to_float(get_any(row, ["龙虎榜成交金额", "totalAmount"])),
            "listingCount": parse_int(str(get_any(row, ["上榜次数", "count"]) or 0), 0),
            "institutionBuyAmount": to_float(get_any(row, ["机构买入额", "institutionBuyAmount"])),
            "institutionBuyCount": parse_int(str(get_any(row, ["机构买入次数", "institutionBuyCount"]) or 0), 0),
            "institutionSellAmount": to_float(get_any(row, ["机构卖出额", "institutionSellAmount"])),
            "institutionSellCount": parse_int(str(get_any(row, ["机构卖出次数", "institutionSellCount"]) or 0), 0),
            "institutionNetBuyAmount": to_float(get_any(row, ["机构净买额", "institutionNetBuyAmount"])),
            "oneMonthChangePct": to_float(get_any(row, ["近1个月涨跌幅", "oneMonthChangePct"])),
            "ts": now_iso(),
        })
    return institutions


def get_dragon_tiger_broker_trades(broker_name: str, broker_code: str, trade_date: str, limit: int) -> list[dict[str, Any]]:
    ak = import_akshare()
    resolved_code = resolve_broker_code(ak, broker_name, broker_code, trade_date)
    if not resolved_code:
        return []
    rows = get_cached(
        f"dragon_tiger_broker_trades:{resolved_code}",
        300,
        lambda: get_disk_cached(
            "dragon_tiger_broker_trades",
            resolved_code,
            DRAGON_TIGER_BROKER_CACHE_TTL_SECONDS,
            lambda: normalize_table(ak.stock_lhb_yyb_detail_em(symbol=resolved_code)),
        ),
    )
    trades = []
    for row in rows[: max(1, min(limit, 200))]:
        symbol = normalize_symbol(get_any(row, ["股票代码", "symbol", "code"]))
        row_broker_name = normalize_text(get_any(row, ["营业部名称", "brokerName"])) or normalize_text(broker_name)
        if not symbol or not row_broker_name:
            continue
        trades.append({
            "brokerCode": normalize_broker_code(get_any(row, ["营业部代码", "brokerCode"])) or resolved_code,
            "brokerName": row_broker_name,
            "brokerShortName": normalize_text(get_any(row, ["营业部简称", "brokerShortName"])),
            "tradeDate": normalize_date(get_any(row, ["交易日期", "交易日", "date"])),
            "symbol": symbol,
            "name": normalize_text(get_any(row, ["股票名称", "名称", "name"])),
            "changePct": to_float(get_any(row, ["涨跌幅", "changePct"])),
            "buyAmount": to_float(get_any(row, ["买入金额", "buyAmount"])),
            "sellAmount": to_float(get_any(row, ["卖出金额", "sellAmount"])),
            "netAmount": to_float(get_any(row, ["净额", "netAmount"])),
            "listingReason": normalize_text(get_any(row, ["上榜原因", "listingReason"])),
            "after1DayReturn": to_float(get_any(row, ["1日后涨跌幅", "after1DayReturn"])),
            "after2DayReturn": to_float(get_any(row, ["2日后涨跌幅", "after2DayReturn"])),
            "after3DayReturn": to_float(get_any(row, ["3日后涨跌幅", "after3DayReturn"])),
            "after5DayReturn": to_float(get_any(row, ["5日后涨跌幅", "after5DayReturn"])),
            "after10DayReturn": to_float(get_any(row, ["10日后涨跌幅", "after10DayReturn"])),
            "after20DayReturn": to_float(get_any(row, ["20日后涨跌幅", "after20DayReturn"])),
            "after30DayReturn": to_float(get_any(row, ["30日后涨跌幅", "after30DayReturn"])),
            "ts": now_iso(),
        })
    return trades


def resolve_broker_code(ak: Any, broker_name: str, broker_code: str, trade_date: str) -> str:
    normalized_code = normalize_broker_code(broker_code)
    if normalized_code:
        return normalized_code
    normalized_name = normalize_text(broker_name)
    if not normalized_name or normalized_name == "机构专用":
        return ""

    for start_date, end_date in build_broker_lookup_windows(trade_date):
        rows = get_cached(
            f"dragon_tiger_brokers:{start_date}:{end_date}",
            600,
            lambda start_date=start_date, end_date=end_date: get_disk_cached(
                "dragon_tiger_brokers",
                f"{start_date}:{end_date}",
                DRAGON_TIGER_BROKER_CACHE_TTL_SECONDS,
                lambda: normalize_table(
                    ak.stock_lhb_hyyyb_em(start_date=start_date, end_date=end_date)
                ),
            ),
        )
        code = find_broker_code(rows, normalized_name)
        if code:
            return code
    return ""


def build_broker_lookup_windows(trade_date: str) -> list[tuple[str, str]]:
    today = date.today()
    center = parse_compact_date(trade_date)
    if center:
        end = min(today, center + timedelta(days=7))
        start = center - timedelta(days=10)
        if start > end:
            start = end - timedelta(days=20)
        wide_start = center - timedelta(days=45)
        wide_end = min(today, center + timedelta(days=45))
        if wide_start > wide_end:
            wide_start = wide_end - timedelta(days=60)
        return [
            (start.strftime("%Y%m%d"), end.strftime("%Y%m%d")),
            (wide_start.strftime("%Y%m%d"), wide_end.strftime("%Y%m%d")),
        ]
    return [
        ((today - timedelta(days=30)).strftime("%Y%m%d"), today.strftime("%Y%m%d")),
        ((today - timedelta(days=120)).strftime("%Y%m%d"), today.strftime("%Y%m%d")),
    ]


def find_broker_code(rows: list[dict[str, Any]], broker_name: str) -> str:
    target = normalize_broker_name_for_match(broker_name)
    if not target:
        return ""
    fuzzy_matches: list[dict[str, Any]] = []
    for row in rows:
        row_name = normalize_text(get_any(row, ["营业部名称", "brokerName"]))
        row_key = normalize_broker_name_for_match(row_name)
        if not row_key:
            continue
        if row_key == target:
            return normalize_broker_code(get_any(row, ["营业部代码", "brokerCode"]))
        if target in row_key or row_key in target:
            fuzzy_matches.append(row)
    for row in fuzzy_matches:
        code = normalize_broker_code(get_any(row, ["营业部代码", "brokerCode"]))
        if code:
            return code
    return ""


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


def get_daily_bar_rows(ak: Any, symbol: str, calendar_days: int) -> list[dict[str, Any]]:
    tx_symbol = to_tx_symbol(symbol)
    start_date = (date.today() - timedelta(days=max(120, calendar_days))).strftime("%Y%m%d")
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
        try:
            return normalize_table(ak.stock_zh_a_hist(
                symbol=ak_symbol,
                period="daily",
                start_date=start_date,
                end_date=end_date,
                adjust="",
            ))
        except TypeError:
            return normalize_table(ak.stock_zh_a_hist(
                symbol=ak_symbol,
                period="daily",
                adjust="",
            ))


def get_minute_bar_rows(ak: Any, symbol: str, timeframe: str) -> list[dict[str, Any]]:
    tx_symbol = to_tx_symbol(symbol)
    period = timeframe[:-1]
    try:
        rows = normalize_table(ak.stock_zh_a_minute(
            symbol=tx_symbol,
            period=period,
            adjust="",
        ))
        if rows:
            return filter_latest_date_rows(rows)
    except Exception:
        pass
    try:
        return filter_latest_date_rows(normalize_table(ak.stock_zh_a_hist_min_em(
            symbol=symbol.split(".")[0],
            period=period,
            adjust="",
        )))
    except Exception:
        return []


def aggregate_bar_rows(rows: list[dict[str, Any]], mode: str) -> list[dict[str, Any]]:
    buckets: list[tuple[str, list[dict[str, Any]]]] = []
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        raw_date = normalize_date(get_any(row, ["日期", "date", "trade_date"]))
        if not raw_date:
            continue
        if mode == "year":
            bucket = raw_date[:4]
        else:
            bucket = raw_date[:7]
        if bucket not in grouped:
            grouped[bucket] = []
            buckets.append((bucket, grouped[bucket]))
        grouped[bucket].append(row)

    aggregated: list[dict[str, Any]] = []
    for bucket, bucket_rows in buckets:
        if not bucket_rows:
            continue
        first_row = bucket_rows[0]
        last_row = bucket_rows[-1]
        high = max(to_float(get_any(item, ["最高", "high"])) for item in bucket_rows)
        low = min(to_float(get_any(item, ["最低", "low"])) for item in bucket_rows)
        volume = sum(to_float(get_any(item, ["成交量", "volume", "vol"])) for item in bucket_rows)
        amount = sum(to_float(get_any(item, ["成交额", "amount"])) for item in bucket_rows)
        aggregated.append({
            "日期": normalize_date(get_any(last_row, ["日期", "date", "trade_date"])),
            "开盘": to_float(get_any(first_row, ["开盘", "open"])),
            "最高": high,
            "最低": low,
            "收盘": to_float(get_any(last_row, ["收盘", "close"])),
            "成交量": volume,
            "成交额": amount,
        })
    return aggregated


def is_minute_timeframe(timeframe: str) -> bool:
    return timeframe in {"1m", "5m", "15m", "30m", "60m"}


def filter_latest_date_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    dated_rows: list[tuple[str, dict[str, Any]]] = []
    latest_key = ""
    for row in rows:
        key = extract_date_key(get_any(row, ["时间", "日期", "date", "trade_date", "day"]))
        if not key:
            continue
        dated_rows.append((key, row))
        if key > latest_key:
            latest_key = key
    if not dated_rows or not latest_key:
        return rows
    filtered = [row for key, row in dated_rows if key == latest_key]
    return filtered or rows


def extract_date_key(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if len(raw) >= 10 and raw[4] == "-" and raw[7] == "-":
        return raw[:10]
    if len(raw) >= 8 and raw[:8].isdigit():
        return f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}"
    if "T" in raw:
        return raw.split("T", 1)[0]
    if " " in raw and len(raw) >= 10:
        return raw[:10]
    return raw[:10]


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


def get_disk_cached(namespace: str, key: str, ttl_seconds: int, loader):
    cache_key = f"{namespace}:{key}"
    now = time.time()
    cached = _CACHE.get(cache_key)
    if cached and now - cached[0] < ttl_seconds:
        return cached[1]

    cache_path = build_disk_cache_path(namespace, key)
    cached_value = read_disk_cache(cache_path, ttl_seconds)
    if cached_value is not None:
        _CACHE[cache_key] = (now, cached_value)
        return cached_value

    value = loader()
    write_disk_cache(cache_path, value)
    _CACHE[cache_key] = (now, value)
    return value


def build_disk_cache_path(namespace: str, key: str) -> Path:
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:20]
    safe_key = "".join(ch if ch.isalnum() else "-" for ch in key)[:48].strip("-") or "default"
    return DISK_CACHE_ROOT / namespace / f"{safe_key}-{digest}.json"


def read_disk_cache(path: Path, ttl_seconds: int) -> Any | None:
    try:
        if not path.exists():
            return None
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if payload.get("version") != DISK_CACHE_VERSION:
            return None
        fetched_at = float(payload.get("fetchedAtEpoch") or 0)
        if fetched_at <= 0 or time.time() - fetched_at > ttl_seconds:
            return None
        data = payload.get("data")
        return data if data is not None else None
    except Exception:
        return None


def write_disk_cache(path: Path, value: Any) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": DISK_CACHE_VERSION,
            "fetchedAtEpoch": time.time(),
            "fetchedAt": now_iso(),
            "data": sanitize_for_json(value),
        }
        tmp_path = path.with_suffix(f".{os.getpid()}.tmp")
        with tmp_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        tmp_path.replace(path)
    except Exception:
        return


def get_cache_status() -> dict[str, Any]:
    files = list(DISK_CACHE_ROOT.rglob("*.json")) if DISK_CACHE_ROOT.exists() else []
    by_namespace: dict[str, int] = {}
    latest_by_namespace: dict[str, str] = {}
    total_bytes = 0
    for path in files:
        namespace = path.parent.name
        by_namespace[namespace] = by_namespace.get(namespace, 0) + 1
        current_latest = latest_by_namespace.get(namespace)
        if current_latest is None or path.name > current_latest:
            latest_by_namespace[namespace] = path.name
        try:
            total_bytes += path.stat().st_size
        except OSError:
            pass
    return {
        "cacheDir": str(DISK_CACHE_ROOT),
        "fileCount": len(files),
        "totalBytes": total_bytes,
        "memoryKeys": len(_CACHE),
        "namespaces": by_namespace,
        "latestFiles": latest_by_namespace,
    }


def sanitize_for_json(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, list):
        return [sanitize_for_json(item) for item in value]
    if isinstance(value, tuple):
        return [sanitize_for_json(item) for item in value]
    if isinstance(value, dict):
        return {str(key): sanitize_for_json(item) for key, item in value.items()}
    return str(value)


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
        if raw.startswith("8") or raw.startswith("4") or raw.startswith("9"):
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
        parsed = float(value)
        return parsed if math.isfinite(parsed) else 0.0
    raw = str(value).strip().replace(",", "").replace("%", "")
    if raw in {"", "-", "None", "nan"}:
        return 0.0
    try:
        return float(raw)
    except ValueError:
        return 0.0


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (int, float)) and not math.isfinite(float(value)):
        return ""
    raw = str(value).strip()
    if raw in {"", "-", "None", "nan", "NaN"}:
        return ""
    return raw


def normalize_date(value: Any) -> str:
    raw = str(value or "").strip()
    if len(raw) == 8 and raw.isdigit():
        return f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}"
    return raw


def normalize_trade_date(value: Any) -> str:
    raw = normalize_date(value)
    if not raw:
        return ""
    if len(raw) >= 10 and raw[4] == "-" and raw[7] == "-":
        return raw[:10].replace("-", "")
    if len(raw) >= 8 and raw[:8].isdigit():
        return raw[:8]
    return ""


def parse_compact_date(value: Any) -> date | None:
    raw = normalize_trade_date(value)
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%Y%m%d").date()
    except ValueError:
        return None


def normalize_broker_code(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return str(int(value))
    raw = str(value).strip()
    if raw.endswith(".0") and raw[:-2].isdigit():
        return raw[:-2]
    return raw if raw and raw not in {"-", "None", "nan", "NaN"} else ""


def normalize_broker_name_for_match(value: Any) -> str:
    return normalize_text(value).replace(" ", "").replace("　", "")


def infer_seat_type(name: str) -> str:
    if "机构" in name:
        return "institution"
    if "股通" in name:
        return "northbound"
    if name:
        return "broker"
    return "unknown"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


if __name__ == "__main__":
    raise SystemExit(main())
