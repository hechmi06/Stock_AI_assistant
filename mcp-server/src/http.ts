import { createServer, type ServerResponse } from "node:http";
import { analyzeStock, getMarketDashboard } from "./marketData.js";

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
      sendJson(response, 200, await getMarketDashboard());
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
