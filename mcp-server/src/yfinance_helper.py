import argparse
import json
import math
from datetime import datetime


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


def build_payload(ticker, period):
    import yfinance as yf

    symbol = ticker.strip().upper()
    errors = []
    stock = yf.Ticker(symbol)

    try:
        info = stock.info or {}
    except Exception as exc:
        info = {}
        errors.append(f"yfinance info unavailable: {exc}")

    try:
        history = stock.history(period=period, interval="1d", auto_adjust=False)
    except Exception as exc:
        history = None
        errors.append(f"yfinance history unavailable: {exc}")

    historical_prices = []
    if history is not None and not history.empty:
        for index, row in history.tail(180).iterrows():
            close = clean_number(row.get("Close"))
            if close is None:
                continue
            if hasattr(index, "date"):
                date = index.date().isoformat()
            else:
                date = datetime.utcnow().date().isoformat()
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
    else:
        errors.append("yfinance history returned no rows.")

    last_close = historical_prices[-1]["close"] if historical_prices else clean_number(info.get("currentPrice") or info.get("regularMarketPrice"))
    previous_close = clean_number(info.get("previousClose"))
    change_percent = None
    if last_close is not None and previous_close not in (None, 0):
        change_percent = ((last_close - previous_close) / previous_close) * 100

    try:
        financials = stock.financials
    except Exception as exc:
        financials = None
        errors.append(f"yfinance financials unavailable: {exc}")

    try:
        balance_sheet = stock.balance_sheet
    except Exception as exc:
        balance_sheet = None
        errors.append(f"yfinance balance sheet unavailable: {exc}")

    try:
        cashflow = stock.cashflow
    except Exception as exc:
        cashflow = None
        errors.append(f"yfinance cashflow unavailable: {exc}")

    payload = {
        "ticker": symbol,
        "price": {
            "ticker": symbol,
            "price": last_close,
            "change_percent": clean_number(change_percent),
            "currency": clean_string(info.get("currency")),
            "exchange": clean_string(info.get("exchange") or info.get("fullExchangeName")),
            "market_state": clean_string(info.get("marketState")),
            "source": "yfinance",
        }
        if last_close is not None
        else None,
        "historical_prices": historical_prices,
        "company_profile": {
            "name": clean_string(info.get("longName") or info.get("shortName")),
            "sector": clean_string(info.get("sector")),
            "industry": clean_string(info.get("industry")),
            "country": clean_string(info.get("country")),
            "website": clean_string(info.get("website")),
            "market_cap": clean_number(info.get("marketCap")),
            "currency": clean_string(info.get("currency")),
            "exchange": clean_string(info.get("exchange") or info.get("fullExchangeName")),
        },
        "financial_ratios": {
            "trailing_pe": clean_number(info.get("trailingPE")),
            "forward_pe": clean_number(info.get("forwardPE")),
            "price_to_book": clean_number(info.get("priceToBook")),
            "debt_to_equity": clean_number(info.get("debtToEquity")),
            "profit_margin": clean_number(info.get("profitMargins")),
            "return_on_equity": clean_number(info.get("returnOnEquity")),
            "beta": clean_number(info.get("beta")),
        },
        "financial_statements_summary": {
            "fiscal_date": latest_statement_date(financials),
            "total_revenue": latest_statement_value(financials, "Total Revenue"),
            "net_income": latest_statement_value(financials, "Net Income"),
            "total_assets": latest_statement_value(balance_sheet, "Total Assets"),
            "total_debt": latest_statement_value(balance_sheet, "Total Debt"),
            "operating_cashflow": latest_statement_value(cashflow, "Operating Cash Flow"),
        },
        "errors": errors,
    }
    return payload


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ticker", required=True)
    parser.add_argument("--period", default="6mo")
    args = parser.parse_args()

    try:
        payload = build_payload(args.ticker, args.period)
    except Exception as exc:
        payload = {
            "ticker": args.ticker.strip().upper(),
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
            "errors": [f"yfinance helper failed: {exc}"],
        }

    print(json.dumps(payload, separators=(",", ":")))


if __name__ == "__main__":
    main()
