# quanttogo-mcp

MCP server for [QuantToGo](https://www.quanttogo.com) — a quantitative trading platform with live-tracked strategies across US and China markets.

> **4 tools, 1 resource, zero config.** Real-time quantitative strategy data from QuantToGo's production API. No API key required.

## Quick Start

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "quanttogo": {
      "command": "npx",
      "args": ["-y", "quanttogo-mcp"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "quanttogo": {
      "command": "npx",
      "args": ["-y", "quanttogo-mcp"]
    }
  }
}
```

### Remote (Streamable HTTP)

No installation needed — connect directly via URL:

```
https://mcp-us.quanttogo.com:8443/mcp
```

Works with any MCP client that supports Streamable HTTP transport (Smithery, Coze, etc.).

## Tools

### `list_strategies`

List all quantitative trading strategies with live performance metrics.

- **Parameters:** none
- **Returns:** Array of strategies with `productId`, `name`, `market`, `totalReturn`, `maxDrawdown`, `recent1dReturn`, `recent30dReturn`, `status`

<details>
<summary>Example response</summary>

```json
[
  {
    "productId": "PROD-E3X",
    "name": "US Options Momentum",
    "market": "US",
    "totalReturn": 1.85,
    "maxDrawdown": -0.32,
    "recent1dReturn": 0.012,
    "recent30dReturn": 0.08,
    "status": "active"
  },
  {
    "productId": "PROD-A1M",
    "name": "A-Share Sector Rotation",
    "market": "CN",
    "totalReturn": 0.67,
    "maxDrawdown": -0.18,
    "recent1dReturn": -0.003,
    "recent30dReturn": 0.05,
    "status": "active"
  }
]
```

> Values are live and update daily. `totalReturn` of 1.85 = +185% cumulative return.

</details>

### `get_strategy_performance`

Get detailed performance data for a single strategy, including daily NAV (net asset value) history.

- **Parameters:**
  - `productId` (string, required) — Strategy ID from `list_strategies`, e.g. `"PROD-E3X"`
  - `includeChart` (boolean, optional, default: true) — Include daily NAV data points
- **Returns:** Strategy details + chart data with daily NAV time series

<details>
<summary>Example response</summary>

```json
{
  "productId": "PROD-E3X",
  "name": "US Options Momentum",
  "market": "US",
  "description": "Weekly SPY/QQQ options strategy based on momentum signals",
  "totalReturn": 1.85,
  "maxDrawdown": -0.32,
  "recent1dReturn": 0.012,
  "recent30dReturn": 0.08,
  "tradeCount": 156,
  "status": "active",
  "chart": {
    "totalPoints": 520,
    "lastUpdated": "2026-03-10",
    "dataPoints": [
      { "d": "2024-01-02", "nav": 1.0 },
      { "d": "2024-06-15", "nav": 1.42 },
      { "d": "2026-03-10", "nav": 2.85 }
    ]
  }
}
```

> `dataPoints` array contains daily NAV values. Shown truncated — actual response includes all trading days.

</details>

### `get_index_data`

Get QuantToGo custom market indices.

- **Parameters:**
  - `indexId` (enum, optional) — `"DA-MOMENTUM"` or `"QTG-MOMENTUM"`. Omit for summary of all indices.
- **Returns:**
  - Summary mode: Array of `{ indexId, name, shortDesc, latestValue, dailyChange, dailyChangePercent, updateDate }`
  - Detail mode: Full index data including `dataPoints` and `components`

| Index | Description |
|-------|-------------|
| `DA-MOMENTUM` | China A-share momentum-weighted index (CSI300 + ChiNext) |
| `QTG-MOMENTUM` | Strategy-weighted momentum index across all QuantToGo products |

### `compare_strategies`

Compare 2–8 strategies side by side.

- **Parameters:**
  - `productIds` (string[], required, 2–8 items) — Array of product IDs
- **Returns:** Array of `{ productId, name, market, totalReturn, maxDrawdown, recent1dReturn, recent30dReturn }`

## Resource

| URI | Description |
|-----|-------------|
| `quanttogo://strategies/overview` | JSON overview of all strategies and current performance |

## About QuantToGo

QuantToGo runs 8 live-tracked quantitative strategies spanning US equities (options, momentum, dip-buying) and China A-shares (index futures, sector rotation). All performance data is forward-tracked daily via automated signal pipelines — not backtested.

## License

MIT
