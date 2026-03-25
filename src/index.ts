#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = "https://www.quanttogo.com";

// ── Helpers ──────────────────────────────────────────────────

async function callAPI(fn: string, body: Record<string, unknown> = {}): Promise<unknown> {
  const resp = await fetch(`${API_BASE}/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`API ${fn} returned ${resp.status}`);
  return resp.json();
}

async function validateApiKey(apiKey: string): Promise<{ valid: boolean; message: string }> {
  const res = (await callAPI("getApiStatus", { apiKey })) as {
    code: number;
    message: string;
  };
  if (res.code === 401) return { valid: false, message: "Invalid API key. Use register_trial with your email to get a valid key." };
  if (res.code === 403) return { valid: false, message: "Trial expired. Email admin@quanttogo.com to subscribe." };
  if (res.code !== 0) return { valid: false, message: res.message || "API key validation failed." };
  return { valid: true, message: "ok" };
}

// ── Server Factory ──────────────────────────────────────────

function createServer(): McpServer {
  const server = new McpServer({
    name: "quanttogo-mcp",
    version: "0.3.0",
  });

  registerTools(server);
  registerPrompts(server);
  return server;
}

// ── Register Tools ──────────────────────────────────────────

function registerTools(server: McpServer): void {

// ── Tool: list_strategies ────────────────────────────────────

server.tool(
  "list_strategies",
  "List all available trading strategies with live performance data. Returns strategy name, market (US/China), total return, drawdown, and recent returns.",
  {},
  async () => {
    const res = (await callAPI("getProducts")) as {
      code: number;
      data: Record<string, unknown>[];
    };
    if (res.code !== 0 || !Array.isArray(res.data)) {
      return { content: [{ type: "text" as const, text: "Failed to fetch strategies" }] };
    }

    const strategies = res.data.map((p) => ({
      productId: p.productId,
      name: p.name,
      market: p.market || "—",
      totalReturn: p.totalReturn ?? p.totalReturn5Y ?? null,
      metricsYearLabel: p.metricsYearLabel || null,
      maxDrawdown: p.maxDrawdown ?? null,
      recent1dReturn: p.recent1dReturn ?? null,
      recent30dReturn: p.recent30dReturn ?? null,
      status: p.status,
    }));

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(strategies, null, 2),
        },
      ],
    };
  }
);

// ── Tool: get_strategy_performance ───────────────────────────

server.tool(
  "get_strategy_performance",
  "Get detailed performance for a specific strategy — returns, drawdown, Sharpe, win rate, and daily NAV history for charting. Requires API key (get one free via register_trial).",
  {
    apiKey: z.string().describe("Your API key from register_trial (starts with 'qtg_')"),
    productId: z.string().describe("Strategy product ID, e.g. 'PROD-E3X'"),
    includeChart: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include daily NAV data points for charting"),
  },
  async ({ apiKey, productId, includeChart }) => {
    const auth = await validateApiKey(apiKey);
    if (!auth.valid) {
      return { content: [{ type: "text" as const, text: auth.message }] };
    }

    const [detailRes, chartRes] = await Promise.all([
      callAPI("getProductDetail", { productId }) as Promise<{
        code: number;
        data: Record<string, unknown>;
      }>,
      includeChart
        ? (callAPI("getProductChart", { productId }) as Promise<{
            code: number;
            data: Record<string, unknown>;
          }>)
        : Promise.resolve(null),
    ]);

    if (detailRes.code !== 0 || !detailRes.data) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Strategy '${productId}' not found`,
          },
        ],
      };
    }

    const d = detailRes.data;
    const result: Record<string, unknown> = {
      productId: d.productId,
      name: d.name,
      market: d.market,
      description: d.description || d.shortDescription,
      totalReturn: d.totalReturn ?? d.totalReturn5Y,
      metricsYearLabel: d.metricsYearLabel,
      maxDrawdown: d.maxDrawdown,
      recent1dReturn: d.recent1dReturn,
      recent30dReturn: d.recent30dReturn,
      tradeCount: d.tradeCount ?? d.tradeCount5Y,
      status: d.status,
    };

    if (chartRes?.data) {
      const cd = chartRes.data;
      result.chart = {
        totalPoints: cd.totalPoints,
        lastUpdated: cd.lastUpdated,
        dataPoints: cd.dataPoints, // [{d, nav}, ...]
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

// ── Tool: get_index_data ─────────────────────────────────────

server.tool(
  "get_index_data",
  "Get custom market indices — China A-share momentum and strategy-weighted momentum. Requires API key (get one free via register_trial).",
  {
    apiKey: z.string().describe("Your API key from register_trial (starts with 'qtg_')"),
    indexId: z
      .enum(["DA-MOMENTUM", "QTG-MOMENTUM"])
      .optional()
      .describe("Index ID. Omit to get summary of all indices."),
  },
  async ({ apiKey, indexId }) => {
    const auth = await validateApiKey(apiKey);
    if (!auth.valid) {
      return { content: [{ type: "text" as const, text: auth.message }] };
    }

    if (!indexId) {
      // Summary mode
      const res = (await callAPI("getIndexData", {
        action: "summary",
      })) as { code: number; data: Record<string, unknown>[] };
      if (res.code !== 0) {
        return {
          content: [{ type: "text" as const, text: "Failed to fetch indices" }],
        };
      }
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(res.data, null, 2) },
        ],
      };
    }

    // Detail mode
    const res = (await callAPI("getIndexData", {
      action: "detail",
      indexId,
    })) as { code: number; data: Record<string, unknown> };
    if (res.code !== 0 || !res.data) {
      return {
        content: [
          { type: "text" as const, text: `Index '${indexId}' not found` },
        ],
      };
    }

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(res.data, null, 2) },
      ],
    };
  }
);

// ── Tool: compare_strategies ─────────────────────────────────

server.tool(
  "compare_strategies",
  "Compare multiple strategies side-by-side — returns, drawdown, and recent performance.",
  {
    productIds: z
      .array(z.string())
      .min(2)
      .max(8)
      .describe("Array of product IDs to compare, e.g. ['PROD-E3X', 'PROD-PCR']"),
  },
  async ({ productIds }) => {
    const res = (await callAPI("getProducts")) as {
      code: number;
      data: Record<string, unknown>[];
    };
    if (res.code !== 0 || !Array.isArray(res.data)) {
      return {
        content: [{ type: "text" as const, text: "Failed to fetch strategies" }],
      };
    }

    const selected = res.data.filter((p) =>
      productIds.includes(p.productId as string)
    );

    if (selected.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `None of the specified product IDs were found. Use list_strategies to see available IDs.`,
          },
        ],
      };
    }

    const comparison = selected.map((p) => ({
      productId: p.productId,
      name: p.name,
      market: p.market || "—",
      totalReturn: p.totalReturn ?? p.totalReturn5Y ?? null,
      maxDrawdown: p.maxDrawdown ?? null,
      recent1dReturn: p.recent1dReturn ?? null,
      recent30dReturn: p.recent30dReturn ?? null,
    }));

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(comparison, null, 2) },
      ],
    };
  }
);

// ── Tool: get_subscription_info ──────────────────────────────

server.tool(
  "get_subscription_info",
  "Get subscription plans and free trial info.",
  {},
  async () => {
    const info = {
      website: "https://www.quanttogo.com",
      freeTrial: "30 days, all strategies, instant activation via register_trial",
      howToStart: {
        step1: "Call register_trial with your email → get API key instantly",
        step2: "Call get_signals with API key + productId → see buy/sell signals",
        step3: "Call check_subscription to check trial status",
      },
      plans: {
        free: "Browse strategies and compare performance",
        trial: "Full signal access for 30 days — all 8 strategies, US + China",
        subscriber: "Ongoing access + push notifications + position sizing",
      },
      upgrade: "admin@quanttogo.com",
    };
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(info, null, 2),
        },
      ],
    };
  }
);

// ── Tool: register_trial ─────────────────────────────────────

server.tool(
  "register_trial",
  "Start a free 30-day trial. Provide your email, get an API key instantly. Calling again with the same email returns your existing account.",
  {
    email: z.string().email().describe("Your email address for registration and credential recovery"),
  },
  async ({ email }) => {
    const res = (await callAPI("registerTrial", { email, source: "mcp" })) as {
      code: number;
      message: string;
      data?: {
        apiKey: string;
        inviteCode: string;
        status: string;
        trialEnd: string;
        alreadyRegistered: boolean;
      };
    };

    if (res.code !== 0 || !res.data) {
      return {
        content: [
          {
            type: "text" as const,
            text: res.message || "Registration failed. Please try again or contact admin@quanttogo.com.",
          },
        ],
      };
    }

    const d = res.data;
    const result = {
      apiKey: d.apiKey,
      inviteCode: d.inviteCode,
      status: d.status,
      trialEnd: d.trialEnd,
      alreadyRegistered: d.alreadyRegistered,
      nextSteps: {
        getSignals: `Call get_signals with apiKey="${d.apiKey}" and a productId from list_strategies`,
        checkStatus: `Call check_subscription with apiKey="${d.apiKey}" to check your trial status`,
        webLogin: `Use invite code ${d.inviteCode} at https://www.quanttogo.com`,
      },
      important: "Save your API key — you'll need it for future sessions.",
    };

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

// ── Tool: get_signals ────────────────────────────────────────

server.tool(
  "get_signals",
  "Get today's buy/sell signals for a strategy. Requires API key from register_trial.",
  {
    apiKey: z.string().describe("Your API key from register_trial (starts with 'qtg_')"),
    productId: z.string().describe("Strategy product ID from list_strategies, e.g. 'PROD-E3X'"),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe("Number of recent signals to return (max 50)"),
  },
  async ({ apiKey, productId, limit }) => {
    const res = (await callAPI("getSignalsAPI", { apiKey, productId, limit })) as {
      code: number;
      message: string;
      data?: {
        productId: string;
        productName: string;
        signalCount: number;
        signals: Array<{
          date: string;
          time: string;
          direction: string;
          symbol: string;
          price: number | null;
          source?: string;
        }>;
        subscription: {
          status: string;
          trialEnd: string | null;
          daysRemaining: number | null;
        };
      };
    };

    if (res.code === 401) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Invalid API key. Use register_trial with your email to get a valid key.",
          },
        ],
      };
    }

    if (res.code === 403) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Trial expired. Email admin@quanttogo.com to subscribe for continued signal access.",
          },
        ],
      };
    }

    if (res.code !== 0 || !res.data) {
      return {
        content: [
          {
            type: "text" as const,
            text: res.message || "Failed to fetch signals.",
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(res.data, null, 2),
        },
      ],
    };
  }
);

// ── Tool: check_subscription ─────────────────────────────────

server.tool(
  "check_subscription",
  "Check subscription status and remaining trial days. Requires API key from register_trial.",
  {
    apiKey: z.string().describe("Your API key from register_trial (starts with 'qtg_')"),
  },
  async ({ apiKey }) => {
    const res = (await callAPI("getApiStatus", { apiKey })) as {
      code: number;
      message: string;
      data?: {
        email: string | null;
        status: string;
        inviteCode: string | null;
        trialEnd: string | null;
        daysRemaining: number;
        maxProducts: number;
        registeredAt: string | null;
        message: string;
        upgradeContact?: string;
      };
    };

    if (res.code === 401) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Invalid API key. Use register_trial with your email to get a valid key.",
          },
        ],
      };
    }

    if (res.code !== 0 || !res.data) {
      return {
        content: [
          {
            type: "text" as const,
            text: res.message || "Failed to check subscription.",
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(res.data, null, 2),
        },
      ],
    };
  }
);

// ── Resource: strategy-overview ──────────────────────────────

  server.resource(
    "strategy-overview",
    "quanttogo://strategies/overview",
    {
      description:
        "Overview of all available trading strategies and their live performance",
      mimeType: "application/json",
    },
    async () => {
      const res = (await callAPI("getProducts")) as {
        code: number;
        data: Record<string, unknown>[];
      };
      const data = res.code === 0 && Array.isArray(res.data) ? res.data : [];
      return {
        contents: [
          {
            uri: "quanttogo://strategies/overview",
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );
} // end registerTools

// ── Register Prompts ─────────────────────────────────────────

function registerPrompts(server: McpServer): void {
  server.prompt(
    "quick-start",
    "Get started in 30 seconds — see strategies, pick one, and start a free trial",
    {},
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: "Show me all available strategies with list_strategies, then pick the best-performing one this month, and register me for a free trial with register_trial using my email.",
          },
        },
      ],
    })
  );

  server.prompt(
    "daily-check",
    "Check today's buy/sell signals across all your subscribed strategies",
    {
      apiKey: z.string().describe("Your API key from register_trial"),
    },
    async ({ apiKey }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Check my subscription status with check_subscription (apiKey: ${apiKey}), then get today's signals for all strategies using get_signals. Summarize: which strategies say buy, which say sell, which are flat.`,
          },
        },
      ],
    })
  );

  server.prompt(
    "compare-top",
    "Compare the top strategies and recommend a combination for your risk profile",
    {},
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: "Use list_strategies to get all strategies, then compare_strategies on the top 3 by total return. Recommend a combination balancing US and China market exposure with moderate risk.",
          },
        },
      ],
    })
  );

  server.prompt(
    "china-signals",
    "Focus on China A-share strategies and market indices",
    {},
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: "Show me all China A-share strategies using list_strategies (filter for China market), get the DA-MOMENTUM index with get_index_data, and summarize the current China market outlook based on the data.",
          },
        },
      ],
    })
  );
}

// ── Start ────────────────────────────────────────────────────

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
