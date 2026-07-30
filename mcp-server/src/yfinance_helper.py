import argparse
import json
import math
import os
import re
import time
from datetime import datetime
from pathlib import Path


CACHE_DIR = Path(
    os.getenv(
        "YFINANCE_CACHE_DIR",
        str(Path(__file__).resolve().parent.parent / ".cache" / "yfinance"),
    )
)


def env_seconds(name, default):
    try:
        return max(0, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


CACHE_TTL_SECONDS = env_seconds("YFINANCE_CACHE_TTL_SECONDS", 6 * 60 * 60)
PARTIAL_CACHE_TTL_SECONDS = env_seconds("YFINANCE_PARTIAL_CACHE_TTL_SECONDS", 15 * 60)
COOLDOWN_SECONDS = env_seconds("YFINANCE_COOLDOWN_SECONDS", 15 * 60)
MAX_STALE_SECONDS = env_seconds("YFINANCE_MAX_STALE_SECONDS", 7 * 24 * 60 * 60)
CACHE_SCHEMA_VERSION = 2


def clean_number(value):
    try:
        if value is None:
            return None
        number = float(value)
        if math.isnan(number) or math.isinf(number):
            return None
        return number
    except (TypeError, ValueError):
        return None


def clean_int(value):
    number = clean_number(value)
    return int(number) if number is not None else None


def clean_string(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def latest_statement_value(frame, row_name):
    try:
        if frame is None or frame.empty or row_name not in frame.index:
            return None
        return clean_number(frame.loc[row_name].iloc[0])
    except Exception:
        return None


def latest_statement_date(frame):
    try:
        if frame is None or frame.empty:
            return None
        value = frame.columns[0]
        if hasattr(value, "date"):
            return value.date().isoformat()
        return clean_string(value)
    except Exception:
        return None


def empty_payload(symbol):
    return {
        "ticker": symbol,
        "price": None,
        "historical_prices": [],
        "company_profile": {
            "name": None,
            "sector": None,
            "industry": None,
            "country": None,
            "website": None,
            "market_cap": None,
            "currency": None,
            "exchange": None,
        },
        "financial_ratios": {},
        "financial_statements_summary": {
            "fiscal_date": None,
            "total_revenue": None,
            "net_income": None,
            "total_assets": None,
            "total_debt": None,
            "operating_cashflow": None,
        },
        "errors": [],
    }


def cache_file(symbol, period):
    safe_key = re.sub(r"[^A-Z0-9._-]", "_", f"{symbol}-{period}")
    return CACHE_DIR / f"{safe_key}.json"


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None


def write_json(path, value):
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(f"{path.suffix}.{os.getpid()}.tmp")
        temporary.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")
        temporary.replace(path)
    except OSError:
        return


def read_cached_payload(symbol, period):
    cached = read_json(cache_file(symbol, period))
    if (
        not isinstance(cached, dict)
        or cached.get("schema_version") != CACHE_SCHEMA_VERSION
        or not isinstance(cached.get("payload"), dict)
    ):
        return None, None
    try:
        age_seconds = max(0, time.time() - float(cached.get("cached_at", 0)))
    except (TypeError, ValueError):
        return None, None
    return cached["payload"], age_seconds


def write_cached_payload(symbol, period, payload):
    write_json(
        cache_file(symbol, period),
        {
            "schema_version": CACHE_SCHEMA_VERSION,
            "cached_at": time.time(),
            "payload": payload,
        },
    )


def cooldown_age():
    cooldown = read_json(CACHE_DIR / "rate-limit.json")
    if not isinstance(cooldown, dict):
        return None
    try:
        return max(0, time.time() - float(cooldown.get("started_at", 0)))
    except (TypeError, ValueError):
        return None


def start_cooldown():
    write_json(CACHE_DIR / "rate-limit.json", {"started_at": time.time()})


def clear_cooldown():
    try:
        (CACHE_DIR / "rate-limit.json").unlink(missing_ok=True)
    except OSError:
        return


def is_rate_limit_error(exc):
    message = str(exc).lower()
    class_name = exc.__class__.__name__.lower()
    return (
        "ratelimit" in class_name
        or "rate limit" in message
        or "too many requests" in message
        or "429" in message
    )


def deduplicate_errors(errors):
    return list(dict.fromkeys(error for error in errors if error))


def payload_has_data(payload):
    return bool(
        payload.get("price")
        or payload.get("historical_prices")
        or payload.get("company_profile", {}).get("name")
        or any(value is not None for value in payload.get("financial_ratios", {}).values())
        or any(
            value is not None
            for value in payload.get("financial_statements_summary", {}).values()
        )
    )


def stale_payload_with_warning(cached_payload, age_seconds, reason):
    payload = json.loads(json.dumps(cached_payload))
    payload["errors"] = deduplicate_errors(
        [
            *payload.get("errors", []),
            reason,
            f"yfinance stale cache reused (age {int(age_seconds)}s).",
        ]
    )
    return payload


def fetch_live_payload(symbol, period, history_only=False):
    import yfinance as yf

    payload = empty_payload(symbol)
    errors = payload["errors"]
    rate_limited = False

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if hasattr(yf, "set_tz_cache_location"):
        yf.set_tz_cache_location(str(CACHE_DIR / "library"))

    stock = yf.Ticker(symbol)

    # History is the most useful yfinance result. Stop querying Yahoo as soon
    # as it returns a rate limit; subsequent calls would only extend the block.
    try:
        history = stock.history(period=period, interval="1d", auto_adjust=False)
    except Exception as exc:
        history = None
        rate_limited = is_rate_limit_error(exc)
        errors.append(f"yfinance history unavailable: {exc}")

    historical_prices = []
    if history is not None and not history.empty:
        # Preserve long histories for walk-forward validation. The old 180-row
        # cap made a requested 5-year period look valid while retaining only
        # about six months.
        for index, row in history.tail(2600).iterrows():
            close = clean_number(row.get("Close"))
            if close is None:
                continue
            date = index.date().isoformat() if hasattr(index, "date") else datetime.utcnow().date().isoformat()
            historical_prices.append(
                {
                    "date": date,
                    "open": clean_number(row.get("Open")),
                    "high": clean_number(row.get("High")),
                    "low": clean_number(row.get("Low")),
                    "close": close,
                    "volume": clean_int(row.get("Volume")),
                }
            )
    elif history is not None:
        errors.append("yfinance history returned no rows.")

    payload["historical_prices"] = historical_prices
    if history_only:
        if historical_prices:
            payload["price"] = {
                "ticker": symbol,
                "price": historical_prices[-1]["close"],
                "change_percent": None,
                "currency": None,
                "exchange": None,
                "market_state": None,
                "source": "yfinance",
            }
        payload["errors"] = deduplicate_errors(errors)
        return payload, rate_limited

    if rate_limited:
        return payload, True

    try:
        info = stock.info or {}
    except Exception as exc:
        info = {}
        rate_limited = is_rate_limit_error(exc)
        errors.append(f"yfinance info unavailable: {exc}")

    last_close = historical_prices[-1]["close"] if historical_prices else clean_number(
        info.get("currentPrice") or info.get("regularMarketPrice")
    )
    previous_close = clean_number(info.get("previousClose"))
    change_percent = None
    if last_close is not None and previous_close not in (None, 0):
        change_percent = ((last_close - previous_close) / previous_close) * 100

    if last_close is not None:
        payload["price"] = {
            "ticker": symbol,
            "price": last_close,
            "change_percent": clean_number(change_percent),
            "currency": clean_string(info.get("currency")),
            "exchange": clean_string(info.get("exchange") or info.get("fullExchangeName")),
            "market_state": clean_string(info.get("marketState")),
            "source": "yfinance",
        }

    payload["company_profile"] = {
        "name": clean_string(info.get("longName") or info.get("shortName")),
        "sector": clean_string(info.get("sector")),
        "industry": clean_string(info.get("industry")),
        "country": clean_string(info.get("country")),
        "website": clean_string(info.get("website")),
        "market_cap": clean_number(info.get("marketCap")),
        "currency": clean_string(info.get("currency")),
        "exchange": clean_string(info.get("exchange") or info.get("fullExchangeName")),
    }
    payload["financial_ratios"] = {
        "trailing_pe": clean_number(info.get("trailingPE")),
        "forward_pe": clean_number(info.get("forwardPE")),
        "price_to_book": clean_number(info.get("priceToBook")),
        "debt_to_equity": clean_number(info.get("debtToEquity")),
        "profit_margin": clean_number(info.get("profitMargins")),
        "return_on_equity": clean_number(info.get("returnOnEquity")),
        "beta": clean_number(info.get("beta")),
        # Signaux forward-looking pour l'estimation de potentiel de rendement.
        "peg_ratio": clean_number(info.get("trailingPegRatio") or info.get("pegRatio")),
        "earnings_growth": clean_number(info.get("earningsGrowth")),
        "revenue_growth": clean_number(info.get("revenueGrowth")),
    }

    if rate_limited:
        return payload, True

    frames = {}
    for key, label, attribute in (
        ("financials", "financials", "financials"),
        ("balance_sheet", "balance sheet", "balance_sheet"),
        ("cashflow", "cashflow", "cashflow"),
    ):
        try:
            frames[key] = getattr(stock, attribute)
        except Exception as exc:
            frames[key] = None
            rate_limited = is_rate_limit_error(exc)
            errors.append(f"yfinance {label} unavailable: {exc}")
            if rate_limited:
                break

    financials = frames.get("financials")
    balance_sheet = frames.get("balance_sheet")
    cashflow = frames.get("cashflow")
    payload["financial_statements_summary"] = {
        "fiscal_date": latest_statement_date(financials),
        "total_revenue": latest_statement_value(financials, "Total Revenue"),
        "net_income": latest_statement_value(financials, "Net Income"),
        "total_assets": latest_statement_value(balance_sheet, "Total Assets"),
        "total_debt": latest_statement_value(balance_sheet, "Total Debt"),
        "operating_cashflow": latest_statement_value(cashflow, "Operating Cash Flow"),
    }
    payload["errors"] = deduplicate_errors(errors)
    return payload, rate_limited


def build_payload(ticker, period, history_only=False):
    symbol = ticker.strip().upper()
    cached_payload, cache_age = read_cached_payload(symbol, period)
    if cached_payload is not None and cache_age is not None:
        ttl = PARTIAL_CACHE_TTL_SECONDS if cached_payload.get("errors") else CACHE_TTL_SECONDS
        if cache_age <= ttl:
            return cached_payload

    active_cooldown_age = cooldown_age()
    if (
        not history_only
        and active_cooldown_age is not None
        and active_cooldown_age < COOLDOWN_SECONDS
    ):
        reason = f"yfinance cooldown active after rate limit ({int(active_cooldown_age)}s elapsed)."
        if cached_payload is not None and cache_age is not None and cache_age <= MAX_STALE_SECONDS:
            return stale_payload_with_warning(cached_payload, cache_age, reason)
        payload = empty_payload(symbol)
        payload["errors"] = [reason]
        return payload

    payload, rate_limited = fetch_live_payload(symbol, period, history_only=history_only)
    if rate_limited:
        start_cooldown()
        if cached_payload is not None and cache_age is not None and cache_age <= MAX_STALE_SECONDS:
            return stale_payload_with_warning(
                cached_payload,
                cache_age,
                "yfinance live request rate-limited.",
            )
    else:
        clear_cooldown()

    if payload_has_data(payload):
        write_cached_payload(symbol, period, payload)
    return payload


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ticker", required=True)
    parser.add_argument("--period", default="6mo")
    parser.add_argument("--history-only", action="store_true")
    args = parser.parse_args()

    try:
        payload = build_payload(args.ticker, args.period, history_only=args.history_only)
    except Exception as exc:
        payload = empty_payload(args.ticker.strip().upper())
        payload["errors"] = [f"yfinance helper failed: {exc}"]

    print(json.dumps(payload, separators=(",", ":")))


if __name__ == "__main__":
    main()
