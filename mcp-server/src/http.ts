import { createServer, type ServerResponse } from "node:http";
import { loadRootEnv } from "./env.js";

loadRootEnv();
import {
  analyzeStock,
  getCompanyProfile,
  getFinancialStatements,
  getHistoricalPrices,
  getMarketDashboard,
  getMarketData,
  getStockPrice,
  searchUsStocks,
} from "./marketData.js";
import { getStockNews } from "./news.js";

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        service: "mcp-server",
        status: "ok",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/market-dashboard") {
      const page = Number(url.searchParams.get("page") ?? "1");
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const search = url.searchParams.get("search") ?? "";
      sendJson(
        response,
        200,
        await getMarketDashboard({
          page: Number.isFinite(page) ? page : 1,
          limit: Number.isFinite(limit) ? limit : 50,
          search,
        }),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/stocks/us") {
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const search = url.searchParams.get("search") ?? "";
      sendJson(
        response,
        200,
        await searchUsStocks(
          search,
          Number.isFinite(limit) ? limit : 50,
          Number.isFinite(offset) ? offset : 0,
        ),
      );
      return;
    }

    const marketDataMatch = url.pathname.match(/^\/market-data\/([^/]+)$/);
    if (request.method === "GET" && marketDataMatch) {
      sendJson(response, 200, await getMarketData(decodeURIComponent(marketDataMatch[1]), url.searchParams.get("period") ?? "6mo"));
      return;
    }

    const newsMatch = url.pathname.match(/^\/news\/([^/]+)$/);
    if (request.method === "GET" && newsMatch) {
      sendJson(
        response,
        200,
        await getStockNews(decodeURIComponent(newsMatch[1]), {
          name: url.searchParams.get("name") ?? undefined,
          extract: url.searchParams.get("extract") === "1" || url.searchParams.get("extract") === "true",
        }),
      );
      return;
    }

    const priceMatch = url.pathname.match(/^\/tools\/stock-price\/([^/]+)$/);
    if (request.method === "GET" && priceMatch) {
      const price = await getStockPrice(decodeURIComponent(priceMatch[1]));
      sendJson(response, price ? 200 : 404, price ?? { status: "missing_price" });
      return;
    }

    const historyMatch = url.pathname.match(/^\/tools\/historical-prices\/([^/]+)$/);
    if (request.method === "GET" && historyMatch) {
      sendJson(response, 200, {
        ticker: decodeURIComponent(historyMatch[1]).trim().toUpperCase(),
        period: url.searchParams.get("period") ?? "6mo",
        historical_prices: await getHistoricalPrices(decodeURIComponent(historyMatch[1]), url.searchParams.get("period") ?? "6mo"),
      });
      return;
    }

    const profileMatch = url.pathname.match(/^\/tools\/company-profile\/([^/]+)$/);
    if (request.method === "GET" && profileMatch) {
      sendJson(response, 200, {
        ticker: decodeURIComponent(profileMatch[1]).trim().toUpperCase(),
        company_profile: await getCompanyProfile(decodeURIComponent(profileMatch[1])),
      });
      return;
    }

    const statementsMatch = url.pathname.match(/^\/tools\/financial-statements\/([^/]+)$/);
    if (request.method === "GET" && statementsMatch) {
      sendJson(response, 200, {
        ticker: decodeURIComponent(statementsMatch[1]).trim().toUpperCase(),
        ...(await getFinancialStatements(decodeURIComponent(statementsMatch[1]))),
      });
      return;
    }

    const analyzeMatch = url.pathname.match(/^\/analyze\/([^/]+)$/);
    if (request.method === "GET" && analyzeMatch) {
      const analysis = await analyzeStock(decodeURIComponent(analyzeMatch[1]));

      if (!analysis) {
        sendJson(response, 404, { status: "missing_market_data" });
        return;
      }

      sendJson(response, 200, analysis);
      return;
    }

    sendJson(response, 404, { status: "not_found" });
  } catch {
    sendJson(response, 500, { status: "error" });
  }
});

const port = Number(process.env.PORT ?? 4100);
server.listen(port, "0.0.0.0", () => {
  console.error(`MCP market data HTTP bridge listening on ${port}`);
});
