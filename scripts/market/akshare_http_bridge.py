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
import traceback
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse


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
    ak = import_akshare()
    rows = normalize_table(ak.stock_zh_a_spot_em())
    by_symbol: dict[str, dict[str, Any]] = {}
    for row in rows:
        symbol = normalize_symbol(get_any(row, ["代码", "symbol", "code"]))
        if symbol:
            by_symbol[symbol] = row

    quotes = []
    for symbol in symbols:
        row = by_symbol.get(symbol)
        if not row:
            continue
        price = to_float(get_any(row, ["最新价", "price", "close"]))
        previous_close = to_float(get_any(row, ["昨收", "previousClose", "pre_close"])) or price
        change_pct = to_float(get_any(row, ["涨跌幅", "changePct", "pct_chg"]))
        change = to_float(get_any(row, ["涨跌额", "change"]))
        quotes.append({
            "symbol": symbol,
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
    ak_symbol = symbol.split(".")[0]
    rows = normalize_table(ak.stock_zh_a_hist(
        symbol=ak_symbol,
        period="daily",
        adjust="",
    ))
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
