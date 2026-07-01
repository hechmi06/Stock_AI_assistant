import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { analyzeStock, getMarketDashboard } from "./marketData.js";

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

const transport = new StdioServerTransport();
await server.connect(transport);
