# Microsoft Clarity MCP Server (fork)

Model Context Protocol (MCP) server for Microsoft Clarity. Exposes session recordings, dashboard analytics, custom-tag (variant) filtering, element-level click data, and Clarity documentation as MCP tools — usable from Claude for Desktop, VS Code, and any other MCP-compatible client.

> This is a fork of [`microsoft/clarity-mcp-server`](https://github.com/microsoft/clarity-mcp-server) maintained for use cases the upstream package does not cover, primarily custom-tag (experiment variant) filtering against the dashboard's `/api/v2` GraphQL endpoint. See [CHANGELOG.md](./CHANGELOG.md) for the full divergence history.

## Tool Surface

The server exposes five tools across two backends.

### Dashboard tools (cookie auth via `CLARITY_DASHBOARD_COOKIE`)

| Tool | Purpose |
| --- | --- |
| `list-custom-tags` | List the custom-tag *keys* defined for the project (e.g. experiment names emitted via `clarity('set', ...)` calls). |
| `query-metrics` | Fetch typed dashboard metrics for any combination of filters: sessions, engagement, top pages/referrers, dead/rage clicks, JS errors, scroll depth. Variant-filterable via `tagKey`/`tagValue`. |
| `compare-by-variant` | Convenience: comparison table for one experiment. Auto-discovers variant values for the given `tagKey`, queries each, and computes deltas vs. control. |
| `list-session-recordings` | Typed session-recording list with the same filter union as `query-metrics`. Returns up to 250 recordings with `playerUrl` + metadata. |
| `get-click-elements` | Per-element click breakdown for a specific page from heatmap data. `clickType` selects the lens: `all`, `dead`, `rage`, `error`, `first`, `last`. Returns ranked elements with click counts, normalized average position, and a 3×3 region label. |

### Documentation tool (bearer auth via `CLARITY_API_TOKEN`)

| Tool | Purpose |
| --- | --- |
| `query-documentation-resources` | RAG over the Microsoft Clarity public documentation. Use for "how does X work" questions about Clarity itself. |

### Scroll-depth scope

`query-metrics` returns scroll depth in two flavors:

- **`pageViewScrollDepth`** — page-view-scoped average max scroll % computed from the heatmap endpoint's scroll distribution. Returned only when `filters.url` is provided. The right metric for single-page experiments.
- **`sessionScrollDepth`** — session-scoped from `getInsightsMetrics`. Always returned. Matches the dashboard's "Scroll depth" card; max scroll across all pages in the session.
- **`scrollReachThresholds`** — `{ reach25, reach50, reach75, reach100 }`: % of page views reaching at least 25/50/75/100 of the page. More actionable for CRO conversations than a single average. Returned with `pageViewScrollDepth`.

## Setup

### Prerequisites

- Node.js v20 or higher
- A Microsoft Clarity project
- One or both credentials, depending on which tools you need:
  - **`CLARITY_API_TOKEN`** — for `query-documentation-resources`. Generated in your Clarity project under Settings → Data Export → Generate new API token.
  - **`CLARITY_DASHBOARD_COOKIE`** — for the data tools. The full `Cookie` header value from a logged-in `clarity.microsoft.com` browser session. The cookie must include the `_csrf=...` value. Cookies rotate every ~30-90 days.
  - **`CLARITY_PROJECT_ID`** — the alphanumeric ID from the dashboard URL (e.g. `w3y4c1nfgk`). Required for the data tools.

### Installation

Published to GitHub Packages under the `@foreversongs` scope. Configure npm to authenticate against `npm.pkg.github.com` for that scope, then:

```bash
npm install -g @foreversongs/clarity-mcp-server-fork
clarity-mcp-server --clarity_api_token=your-token
```

Or build from source:

```bash
git clone https://github.com/foreversongs/clarity-mcp-server.git
cd clarity-mcp-server
npm install
npm run build
npm start
```

### Environment variables

```bash
export CLARITY_API_TOKEN="<your-token>"
export CLARITY_DASHBOARD_COOKIE="<full-cookie-string-including-_csrf>"
export CLARITY_PROJECT_ID="<project-id>"
```

`CLARITY_API_TOKEN` may also be supplied via `--clarity_api_token=...` on the command line.

### MCP client configuration

```json
{
  "mcpServers": {
    "clarity": {
      "command": "npx",
      "args": ["@foreversongs/clarity-mcp-server-fork"],
      "env": {
        "CLARITY_API_TOKEN": "your-api-token",
        "CLARITY_DASHBOARD_COOKIE": "your-cookie-string",
        "CLARITY_PROJECT_ID": "your-project-id"
      }
    }
  }
}
```

For Claude Desktop, this goes in `claude_desktop_config.json`:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%AppData%\Claude\claude_desktop_config.json`

## Development

```bash
npm install
npm run build       # tsc → dist/
npm test            # vitest run
npm run dev         # build + run
npm run probe       # smoke-test /api/v2 connectivity (requires CLARITY_DASHBOARD_COOKIE)
```

`scripts/probe.ts` smoke-tests the dashboard endpoint with the configured cookie and verifies the variant filter is producing distinct results — useful for verifying a freshly-rotated cookie before deploying.

## Architecture notes

The dashboard tools talk to `https://clarity.microsoft.com/api/v2`, the same GraphQL endpoint the Clarity dashboard UI uses. Operation strings in `src/dashboard/operations.ts` are captured verbatim from the dashboard's network traffic and copied into the source. If Clarity changes the wire format, recapture and update.

A handful of operations are still **provisional** — flagged in their docstrings — because they were inferred from schema introspection rather than captured live. These currently include `LIST_CUSTOM_TAG_KEYS`, `LIST_CUSTOM_TAG_VALUES`, `GET_TOP_PAGES`, and `GET_RECORDINGS`. If the inferred field names disagree with the live schema, the affected tool will surface a `DashboardHttpError` with an `Unknown field` message — the failure is loud rather than silent, but operators relying on `list-custom-tags`, `compare-by-variant`, or `list-session-recordings` should verify against their live project before depending on the response shape.

The filter envelope (`src/dashboard/filters.ts`) handles two distinct shapes:
- `buildFilterEnvelope` for session-level operations (used by `query-metrics`, `list-session-recordings`, `compare-by-variant`)
- `buildHeatmapFilter` for page-event-scoped operations (used by `get-click-elements` and the heatmap-based scroll depth path in `query-metrics`)

Timestamps are emitted as full UTC ISO (with `Z`). The server interprets naive timestamps as UTC; sending ET wall-clock strings without a designator shifts query windows by the ET offset and undercounts recent traffic on ramping experiments.

## Privacy

For information about data privacy and usage, see the [Microsoft Clarity Privacy Policy](https://clarity.microsoft.com/privacy).

## License

MIT — same as upstream.
