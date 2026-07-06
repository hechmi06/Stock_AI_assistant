import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  analyzeStock,
  getCompanyProfile,
  getFinancialStatements,
  getHistoricalPrices,
  getMarketDashboard,
  getMarketData,
  getStockPrice,
} from "./marketData.js";
import { getStockNews } from "./news.js";

const server = new McpServer({
  name: "stock-ai-assistant-mcp",
  version: "0.1.0",
});

server.tool("market_dashboard", {}, async () => {
  const dashboard = await getMarketDashboard();

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(dashboard, null, 2),
      },
    ],
  };
});

server.tool(
  "analyze_stock",
  {
    ticker: z.string().min(1).describe("Stock ticker to analyze, for example AAPL"),
  },
  async ({ ticker }) => {
    const analysis = await analyzeStock(ticker);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            analysis ?? {
              ticker: ticker.trim().toUpperCase(),
              status: "fallback_required",
              summary: "No live market data was returned by the MCP market tool.",
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.tool(
  "get_stock_price",
  {
    ticker: z.string().min(1).describe("Stock ticker, for example AAPL"),
  },
  async ({ ticker }) => {
    const price = await getStockPrice(ticker);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(price ?? { ticker: ticker.trim().toUpperCase(), status: "missing_price" }, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "get_historical_prices",
  {
    ticker: z.string().min(1).describe("Stock ticker, for example AAPL"),
    period: z.string().default("6mo").describe("yfinance period, for example 1mo, 6mo, 1y"),
  },
  async ({ ticker, period }) => {
    const history = await getHistoricalPrices(ticker, period);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ticker: ticker.trim().toUpperCase(), period, historical_prices: history }, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "get_company_profile",
  {
    ticker: z.string().min(1).describe("Stock ticker, for example AAPL"),
  },
  async ({ ticker }) => {
    const profile = await getCompanyProfile(ticker);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ticker: ticker.trim().toUpperCase(), company_profile: profile }, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "get_financial_statements",
  {
    ticker: z.string().min(1).describe("Stock ticker, for example AAPL"),
  },
  async ({ ticker }) => {
    const statements = await getFinancialStatements(ticker);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ticker: ticker.trim().toUpperCase(), ...statements }, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "get_market_data",
  {
    ticker: z.string().min(1).describe("Stock ticker, for example AAPL"),
    period: z.string().default("6mo").describe("yfinance historical period"),
  },
  async ({ ticker, period }) => {
    const marketData = await getMarketData(ticker, period);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(marketData, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "get_stock_news",
  {
    ticker: z.string().min(1).describe("Stock ticker, for example AAPL"),
  },
  async ({ ticker }) => {
    const news = await getStockNews(ticker);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(news, null, 2),
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
