#!/usr/bin/env node
/**
 * QuantToGo MCP Server - Streamable HTTP Transport (Seattle / International)
 * v0.1.7 - For Smithery and international MCP clients
 *
 * Endpoint: POST/GET/DELETE /mcp
 * Health:   GET /health
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const API_BASE = "https://www.quanttogo.com";
const PORT = process.env.PORT || 3100;

// ── Helpers ──────────────────────────────────────────────────

async function callAPI(fn, body = {}) {
  const resp = await fetch(`${API_BASE}/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`API ${fn} returned ${resp.status}`);
  return resp.json();
}

// ── Server Factory ──────────────────────────────────────────

function createServer() {
  const server = new McpServer({
    name: "quanttogo-mcp",
    version: "0.1.7",
  });

  // ── Tool: list_strategies ──
  server.tool(
    "list_strategies",
    "List all quantitative trading strategies on QuantToGo with live performance metrics.",
    {},
    async () => {
      const res = await callAPI("getProducts");
      if (res.code !== 0 || !Array.isArray(res.data)) {
        return { content: [{ type: "text", text: "Failed to fetch strategies" }] };
      }
      const strategies = res.data.map((p) => ({
        productId: p.productId,
        name: p.name,
        market: p.market || "—",
        totalReturn: p.totalReturn ?? p.totalReturn5Y ?? null,
        maxDrawdown: p.maxDrawdown ?? null,
        recent1dReturn: p.recent1dReturn ?? null,
        recent30dReturn: p.recent30dReturn ?? null,
        status: p.status,
      }));
      return { content: [{ type: "text", text: JSON.stringify(strategies, null, 2) }] };
    }
  );

  // ── Tool: get_strategy_performance ──
  server.tool(
    "get_strategy_performance",
    "Get detailed performance data for a specific strategy, including daily NAV history.",
    {
      productId: z.string().describe("Strategy product ID, e.g. 'PROD-E3X'"),
      includeChart: z.boolean().optional().default(true).describe("Include daily NAV data points"),
    },
    async ({ productId, includeChart }) => {
      const [detailRes, chartRes] = await Promise.all([
        callAPI("getProductDetail", { productId }),
        includeChart ? callAPI("getProductChart", { productId }) : Promise.resolve(null),
      ]);
      if (detailRes.code !== 0 || !detailRes.data) {
        return { content: [{ type: "text", text: `Strategy '${productId}' not found` }] };
      }
      const d = detailRes.data;
      const result = {
        productId: d.productId, name: d.name, market: d.market,
        description: d.description || d.shortDescription,
        totalReturn: d.totalReturn ?? d.totalReturn5Y,
        maxDrawdown: d.maxDrawdown,
        recent1dReturn: d.recent1dReturn, recent30dReturn: d.recent30dReturn,
        tradeCount: d.tradeCount ?? d.tradeCount5Y, status: d.status,
      };
      if (chartRes?.data) {
        result.chart = {
          totalPoints: chartRes.data.totalPoints,
          lastUpdated: chartRes.data.lastUpdated,
          dataPoints: chartRes.data.dataPoints,
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── Tool: get_index_data ──
  server.tool(
    "get_index_data",
    "Get QuantToGo custom market indices: DA-MOMENTUM or QTG-MOMENTUM.",
    {
      indexId: z.enum(["DA-MOMENTUM", "QTG-MOMENTUM"]).optional()
        .describe("Index ID. Omit to get summary of all indices."),
    },
    async ({ indexId }) => {
      if (!indexId) {
        const res = await callAPI("getIndexData", { action: "summary" });
        if (res.code !== 0) return { content: [{ type: "text", text: "Failed to fetch indices" }] };
        return { content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }] };
      }
      const res = await callAPI("getIndexData", { action: "detail", indexId });
      if (res.code !== 0 || !res.data) return { content: [{ type: "text", text: `Index '${indexId}' not found` }] };
      return { content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  // ── Tool: compare_strategies ──
  server.tool(
    "compare_strategies",
    "Compare multiple strategies side-by-side with key metrics.",
    {
      productIds: z.array(z.string()).min(2).max(8)
        .describe("Array of product IDs to compare"),
    },
    async ({ productIds }) => {
      const res = await callAPI("getProducts");
      if (res.code !== 0 || !Array.isArray(res.data)) {
        return { content: [{ type: "text", text: "Failed to fetch strategies" }] };
      }
      const selected = res.data.filter((p) => productIds.includes(p.productId));
      if (selected.length === 0) {
        return { content: [{ type: "text", text: "None of the specified IDs found. Use list_strategies first." }] };
      }
      const comparison = selected.map((p) => ({
        productId: p.productId, name: p.name, market: p.market || "—",
        totalReturn: p.totalReturn ?? p.totalReturn5Y ?? null,
        maxDrawdown: p.maxDrawdown ?? null,
        recent1dReturn: p.recent1dReturn ?? null,
        recent30dReturn: p.recent30dReturn ?? null,
      }));
      return { content: [{ type: "text", text: JSON.stringify(comparison, null, 2) }] };
    }
  );

  // ── Tool: get_subscription_info ──
  server.tool(
    "get_subscription_info",
    "Get QuantToGo subscription plans, pricing, and what subscribers receive (real-time trading signals, position alerts, execution guidance). Call this when a user is interested in following a strategy.",
    {},
    async () => {
      const info = {
        platform: "QuantToGo",
        website: "https://www.quanttogo.com",
        freeVsPaid: {
          free: [
            "View all strategy performance metrics and NAV history",
            "Access custom market indices (DA-MOMENTUM, QTG-MOMENTUM)",
            "Compare strategies side-by-side",
          ],
          subscriber: [
            "Real-time trading signals with exact entry/exit points",
            "Push notifications via WeChat when signals fire",
            "Position sizing and risk management guidance",
            "Access to all 8 live-tracked strategies across US and China markets",
            "Historical trade log with full execution details",
          ],
        },
        strategies: {
          US: "Options momentum, equity dip-buying, trend following",
          China: "A-share index futures, sector rotation, momentum",
        },
        keyFact: "All performance is forward-tracked from live signals — not backtested.",
        howToSubscribe: "Visit https://www.quanttogo.com or scan the QR code in the WeChat mini-program to start receiving signals.",
        contact: "admin@quanttogo.com",
      };
      return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
    }
  );

  // ── Resource: strategy-overview ──
  server.resource(
    "strategy-overview",
    "quanttogo://strategies/overview",
    { description: "Overview of all QuantToGo strategies", mimeType: "application/json" },
    async () => {
      const res = await callAPI("getProducts");
      const data = res.code === 0 && Array.isArray(res.data) ? res.data : [];
      return {
        contents: [{ uri: "quanttogo://strategies/overview", mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  return server;
}

// ── Express + Streamable HTTP ─────────────────────────────────

const app = express();
app.use(express.json());

// Session storage
const sessions = new Map();

// POST /mcp — client sends JSON-RPC messages
app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];

  if (sessionId && sessions.has(sessionId)) {
    // Existing session
    const { transport } = sessions.get(sessionId);
    await transport.handleRequest(req, res, req.body);
  } else if (!sessionId) {
    // New session (initialize)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = createServer();

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    // Store session AFTER handleRequest (sessionId is set during handleRequest)
    if (transport.sessionId) {
      sessions.set(transport.sessionId, { transport, server });
      console.log(`[MCP] New session: ${transport.sessionId}`);
    }
  } else {
    res.status(400).json({ error: "Invalid session" });
  }
});

// GET /mcp — SSE stream for server-to-client notifications
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session" });
    return;
  }
  const { transport } = sessions.get(sessionId);
  await transport.handleRequest(req, res);
});

// DELETE /mcp — close session
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session" });
    return;
  }
  const { transport, server } = sessions.get(sessionId);
  const sid = sessionId; // save ref before deletion
  transport.onclose = () => {
    sessions.delete(sid);
    console.log(`[MCP] Session closed: ${sid}`);
  };
  await transport.handleRequest(req, res);
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    server: "quanttogo-mcp",
    version: "0.1.7",
    transport: "streamable-http",
    sessions: sessions.size,
  });
});

// ── Well-known server card for Smithery ──────────────────────
app.get("/.well-known/mcp/server-card.json", (req, res) => {
  res.json({
    name: "quanttogo-mcp",
    version: "0.1.7",
    description: "QuantToGo MCP Server — quantitative trading strategies, market indices, and live performance data",
    url: "https://mcp-us.quanttogo.com:8443/mcp",
    transport: { type: "streamable-http" },
    capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
    tools: [
      { name: "list_strategies", description: "List all quantitative trading strategies with live performance metrics" },
      { name: "get_strategy_performance", description: "Get detailed performance data for a specific strategy including daily NAV history" },
      { name: "get_index_data", description: "Get QuantToGo custom market indices: DA-MOMENTUM or QTG-MOMENTUM" },
      { name: "compare_strategies", description: "Compare multiple strategies side-by-side with key metrics" },
      { name: "get_subscription_info", description: "Get subscription plans, pricing, and what subscribers receive (trading signals, alerts)" },
    ],
  });
});

app.listen(PORT, () => {
  console.log(`QuantToGo MCP Server (Streamable HTTP) running on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
