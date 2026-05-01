# Clarity Variant Tools — Design

**Status:** draft
**Author:** Angel Rojas
**Date:** 2026-05-01
**Repo:** `angelrojasm/clarity-mcp-server` (fork of `microsoft/clarity-mcp-server`)
**Drives:** Cody (ForeverSongs CRO agent) reporting per-variant Clarity behavior data

---

## Problem

Cody is the ForeverSongs CRO agent. He has access to Microsoft's official Clarity MCP today, with three tools: `query-analytics-dashboard` (NL → metrics), `list-session-recordings` (typed → filtered recordings), and `query-documentation-resources` (RAG over Clarity docs).

Two issues with this surface:

1. **No variant filtering.** Cody cannot filter any data by experiment-variant **custom tags** (`clarity('set', 'cro-cart-3way', '1')`). Variant-aware behavior analysis is the most common ask in `#songs-cro` and the boss has flagged this gap directly. Empirical probing confirms the official MCP backend at `clarity.microsoft.com/mcp/*` silently ignores `customTags` in any field-name shape — distributions across all variants and gibberish fields are statistically indistinguishable. The public Data Export API doesn't support custom-tag filtering either.
2. **The NL parser is incorrectly broad.** `query-analytics-dashboard`'s NL layer confuses "custom tag" with SmartEvent names, so the moment a question crosses into variant territory it produces wrong answers — and Cody has no way to detect this from the response shape.

The dashboard at `clarity.microsoft.com` uses a different, undocumented GraphQL endpoint at `/api/v2` that **does** support custom-tag filtering and serves the dashboard's full filter surface (40+ dimensions). Direct calls confirm the variant filter works: variant 0 returns 4,080 sessions for `cro-cart-3way`, variant 1 returns 1,018 — a clean 4× delta the official `/mcp/*` backend cannot reproduce. The dashboard sends every filter (URL, device, browser, country, scroll depth, JS errors, custom tags, etc.) through a uniform GraphQL `filters` envelope, so once we wire the envelope we can expose the full filter surface.

This spec replaces the two official **data** tools with `/api/v2`-backed equivalents that natively support custom-tag filtering as one of many optional filters, adds a tag-discovery tool and a per-variant comparison convenience tool, and **keeps `query-documentation-resources` unchanged** (it's the only official tool with no `/api/v2` equivalent and the bearer-auth infrastructure already supports it).

## Non-goals

- Modifying any of Microsoft's existing code (`src/tools.ts`, `src/types.ts`). Their code stays in the fork as reference for future maintainers but is not registered with the MCP server.
- Building a heatmap viewer or recording playback. Recording **links** are enough — humans click them in Slack.
- Time-series breakdowns, smart-event-tagged tools, or per-element click drill-downs. Out of v1; revisit if asked.
- Publishing to the public npm registry under a Microsoft-adjacent name.
- Headless browser / Playwright auth flows. Cookie comes from a manual login on the operator's machine.

## Why we replace the two official data tools (instead of adding alongside)

We initially considered adding 3 narrow variant-only tools alongside the existing 6, on the theory that "minimum addition" was the safest path. We rejected that direction because narrow new tools force an ambiguous routing problem on compound questions:

| Question | Routing under "add alongside" | Result |
|---|---|---|
| "Dead click rate for v1?" | `compare-by-variant` (variant-only) | ✅ |
| "Dead click rate for /cart last 7 days?" | `query-analytics-dashboard` (NL) | ✅ |
| **"Dead click rate for v1 on mobile?"** | Neither tool fits cleanly | **❌ Falls through gaps** |

A narrow `compare-by-variant` doesn't accept device filters. The NL `query-analytics-dashboard` confuses "v1" tag with SmartEvent names. The compound case is exactly where Cody's reports go wrong — and the boss's questions in transcripts routinely cross dimensions (variant + URL + device).

The fix is to make the new tools strict supersets of what they replace, with `tagKey/tagValue` as just two more entries in a unified filter schema. Once that's the design, keeping the old tools creates pure redundancy with no use case the new tools don't cover. Two tools doing the same job is a misuse hotspot — Cody could pick the wrong one and silently get worse data.

So: replace the two data tools, retain `query-documentation-resources` (unique capability with no equivalent), and let the new tools be one obvious choice for any data question.

## Architecture

### Home

The new code lives in **`angelrojasm/clarity-mcp-server`** (the existing fork). The package is renamed:

```diff
- "name": "@microsoft/clarity-mcp-server"
+ "name": "clarity-mcp-server-fs"
```

The bin name (`clarity-mcp-server`) stays — the executable is unchanged. The unscoped package name avoids any implication of Microsoft authorship.

### File layout

```
clarity-mcp-server/
├── src/
│   ├── constants.ts          ← extend: add DASHBOARD_API_URL + cookie env
│   ├── tools.ts              ← UNCHANGED (Microsoft's code, kept as reference; not registered)
│   ├── types.ts              ← UNCHANGED (Microsoft's code, kept as reference; not registered)
│   ├── instructions.ts       ← rewrite: describe new tool surface
│   ├── utils.ts              ← UNCHANGED
│   ├── dashboard-client.ts   ← NEW — POST to /api/v2 with cookie auth + CSRF
│   ├── dashboard-types.ts    ← NEW — Zod schemas for new tools (broad filter type)
│   ├── dashboard-tools.ts    ← NEW — implementations of the 4 dashboard tools
│   ├── docs-tool.ts          ← NEW — wraps Microsoft's documentation tool (extracted from tools.ts)
│   └── index.ts              ← rewrite: register the 5 new/kept tools only
├── docs/
│   └── superpowers/specs/
│       └── 2026-05-01-clarity-variant-tools-design.md   ← this file
└── package.json              ← rename
```

`tools.ts` and `types.ts` are kept verbatim from upstream but no longer registered in `index.ts`. They serve as a code-level reference so a future maintainer can see exactly what Microsoft's tools did and how they mapped to the `/mcp/*` endpoints. We extract only the documentation tool into `docs-tool.ts` because it's the one whose implementation we're keeping.

### Auth model

Two independent env-driven credentials. Each tool uses exactly one:

| Tool | Env var | Format |
|---|---|---|
| `query-documentation-resources` | `CLARITY_API_TOKEN` (or `--clarity_api_token`) | Bearer JWT |
| All four dashboard tools | `CLARITY_DASHBOARD_COOKIE` | Raw `Cookie:` header value, captured from a logged-in browser session |

The two never mix. If a tool's required credential is missing, the tool returns a clear text error — `"Clarity API token not set. Provide via CLARITY_API_TOKEN env or --clarity_api_token CLI flag."` or `"Clarity dashboard session expired or missing. Run 'pulumi config set --secret clarityDashboardCookie <cookie>' and redeploy."` — but the MCP starts and serves regardless of which credential is present. Cody can use whichever tools have credentials configured; missing creds for one tool don't block the others.

CSRF token is parsed at request time from the `_csrf=...` value within the cookie string and sent as a `csrf-token` header alongside `Cookie`.

### Wire-level call shape

Every dashboard tool POSTs to `https://clarity.microsoft.com/api/v2` with:

```http
POST /api/v2 HTTP/1.1
Host: clarity.microsoft.com
Content-Type: application/json
Cookie: <CLARITY_DASHBOARD_COOKIE verbatim>
csrf-token: <_csrf cookie value>

{ "operationName": "...", "variables": {...}, "query": "..." }
```

GraphQL `query` strings are lifted verbatim from captured dashboard requests. The `filters` JSON envelope is the dashboard's own format — a single shape that handles all 40+ filter dimensions:

```json
{
  "operator": "And",
  "filters": [
    { "field": "minEnqueuedTimestamp", "dataType": "Number", "operator": "Range",
      "value": { "min": "...", "max": "..." } },
    { "field": "pageDuration", "dataType": "Number", "operator": "Greater", "value": 0 },
    { "operator": "Or", "filters": [
        { "field": "Variables", "dataType": "Other", "operator": "Contains",
          "value": "cro-cart-3way=1", "invert": false }
    ]}
  ]
}
```

The custom-tag filter is just one more entry in this envelope. URL filters use `field: "URL"`, device uses `field: "Device"`, etc. Our `dashboard-client.ts` ships a single `buildFilterEnvelope(filters: TypedFilters)` helper that maps a typed input object onto this shape.

The full dimension → field map is captured during implementation by triggering each filter in the dashboard UI under Playwright and recording the resulting GraphQL request. We do this once and table-drive the rest.

## Tools

### `list-custom-tags`

**Purpose:** discovery. Returns the list of custom-tag *keys* defined for the project.

**Input:** none.

**Output:**
```json
[
  "checkout_error_code",
  "cro-cart-3way",
  "cro-cart-control-v2-v5",
  ...
]
```

**Implementation note:** the dashboard exposes this list via a query that runs when the tag-key dropdown opens. We replicate that query. Response is cached in memory for the MCP process's lifetime (cheap, low value to refresh per call).

### `query-metrics`

**Purpose:** the workhorse. Returns aggregate Clarity dashboard metrics for any combination of filters, including optional variant filters. Replaces Microsoft's `query-analytics-dashboard` (no NL parsing — typed inputs only).

**Input:**
```ts
{
  filters?: {
    url?: { value: string, operator?: "contains" | "startsWith" | "endsWith" | "equals" | "matchesRegex" }[],
    device?: ("Mobile" | "PC" | "Tablet" | ...)[],
    browser?: string[],
    os?: string[],
    country?: string[],
    state?: string[],
    city?: string[],
    referrer?: string,
    channel?: string[],
    source?: string[],
    medium?: string[],
    campaign?: string[],
    smartEvents?: string[],
    javascriptErrors?: string[],
    scrollDepth?: { min?: number, max?: number },
    sessionDuration?: { min?: number, max?: number },
    pagesCount?: { min?: number, max?: number },
    tagKey?: string,                    // ← variant filter: which custom tag
    tagValue?: string,                  // ← variant filter: which value
    // ...full schema captured during implementation
  },
  metrics?: ("sessions" | "engagement" | "newVsReturning" | "topPages" | "topReferrers"
            | "scrollDepth" | "deadClicks" | "rageClicks" | "jsErrors")[],
                                        // default: all of the above
  dateRange?: string                    // default: "last 7 days"
}
```

**Output:**
```json
{
  "filters": { ... resolved filters as applied ... },
  "dateRange": { "start": "...", "end": "..." },
  "sessions":      { "total": 4080, "bot": 337 },
  "engagement":    { "totalTime": 412, "activeTime": 298 },
  "newVsReturning":{ "new": 3801, "returning": 279 },
  "topReferrers":  [{ "item": "facebook.com", "count": 612 }, ...],
  "topPages":      [{ "item": "/cart", "count": 871 }, ...],
  "scrollDepth":   95.2,
  "deadClickRate": 11.4,
  "rageClickRate": 0.13,
  "jsErrorRate":   0.7,
  "topDeadClickTargets": [{ "selector": "h2.order-header", "count": 3948 }, ...],
  "topClickedElements":  [{ "selector": "button.cta-primary", "count": 6797 }, ...]
}
```

**Behavior:** internally fans out 4–8 GraphQL queries in parallel to populate the requested `metrics`. The `filters` and `dateRange` are translated once into the GraphQL filter envelope and reused across all sub-queries.

**Failure mode:** if any sub-query fails, the corresponding field is `null` and a `_warnings: string[]` array is included with which sub-queries failed. Auth failure (cookie expired) fails the whole call with the cookie-rotation error.

### `list-session-recordings`

**Purpose:** typed list of session recording links matching a filter. Replaces Microsoft's tool of the same name (re-using the name preserves continuity for any prompts that reference it; the schema is a strict superset).

**Input:**
```ts
{
  filters?: {
    // same union as query-metrics' filters
    // ... including tagKey, tagValue, url, device, country, etc.
  },
  count?: number,                       // default: 10, max: 250
  sortBy?: "newest" | "oldest" | "longest" | "shortest" | "most-clicks" | "most-pages",
                                        // default: "newest"
  dateRange?: string                    // default: "last 7 days"
}
```

**Output:**
```json
{
  "filters": { ... resolved filters as applied ... },
  "dateRange": { "start": "...", "end": "..." },
  "count": 10,
  "recordings": [
    {
      "playerUrl": "https://clarity.microsoft.com/player/w3y4c1nfgk/.../...",
      "timestamp": "2026-04-30 18:22:14",
      "totalDuration": "00:04:12",
      "activeDuration": "00:02:48",
      "pages": 5,
      "clickCount": 22,
      "country": "United States",
      "device": "Mobile",
      "url": "https://foreversongs.com/cart"
    },
    ...
  ]
}
```

**Implementation:** the dashboard's *Recordings* page query on `/api/v2` with the typed `filters` mapped into the shared filter envelope.

### `compare-by-variant`

**Purpose:** convenience built on top of `query-metrics`. Auto-discovers all values for a tag key and returns one row per variant with deltas vs. control pre-computed. This is the tool Cody reaches for when writing his "variant comparison table" reports.

**Input:**
```ts
{
  tagKey: string,                        // e.g. "cro-cart-3way"
  additionalFilters?: { /* same union as query-metrics' filters, EXCEPT tagKey/tagValue */ },
  metrics?: ("sessions" | "engagement" | "topPages" | ...)[],
                                         // default: all
  dateRange?: string                     // default: "last 7 days"
}
```

**Output:**
```json
{
  "tagKey": "cro-cart-3way",
  "additionalFilters": { ... },
  "dateRange": { "start": "...", "end": "..." },
  "variants": [
    { "value": "0", "isControl": true, ... query-metrics output ... },
    { "value": "1", "isControl": false, ... metrics ...,
      "deltas": { "sessions": "-75.0%", "engagement.activeTime": "+3.2%", ... }
    },
    { "value": "2", ... }
  ]
}
```

**Behavior:**
1. Discover values via the tag-value query the dashboard uses for the value combobox.
2. For each value, call the same fan-out as `query-metrics`, with the variant's `tagKey/tagValue` merged into `additionalFilters`.
3. Designate the lowest-numerically-sorted value (or `"control"` if literally present) as control.
4. Compute `deltas` for non-control variants as `(metric - control) / control` formatted as a signed percentage. Pre-computing prevents Cody from doing the math wrong.
5. Return.

This tool is strictly a convenience — Cody could call `query-metrics` N times manually with different `tagValue` values and merge the results — but baking the fan-out and delta computation in keeps reports consistent and makes variant comparison a one-tool-call operation.

### `query-documentation-resources`

**Purpose:** RAG over Microsoft Clarity documentation. **Unchanged from Microsoft's implementation.**

**Input/output:** identical to upstream — a free-form NL query, returns documentation snippets.

**Implementation:** extracted from Microsoft's `tools.ts` into a small `docs-tool.ts` file, registered separately. Continues to use `CLARITY_API_TOKEN` (bearer) and `clarity.microsoft.com/mcp/documentation/query`. The bearer-auth infrastructure already exists in the fork; this avoids re-engineering it.

This is the only tool that uses bearer auth in the new design. If this tool is registered without `CLARITY_API_TOKEN` set, it returns the standard "API token not set" error like upstream did.

## Defaults & ergonomics

- **Date range default:** `"last 7 days"`. Parsed by a small in-process parser, no NL pass through an LLM.
- **Date range formats accepted:** `"yesterday"`, `"today"`, `"last N days"` (1–90), `"YYYY-MM-DD..YYYY-MM-DD"` (any historical window the project retains).
- **Filter union:** `query-metrics`, `list-session-recordings`, and `compare-by-variant`'s `additionalFilters` all accept the SAME filter type (a single Zod schema, exported from `dashboard-types.ts` and reused). One mental model for callers.
- **Metric subset:** `query-metrics` and `compare-by-variant` accept an optional `metrics` array to skip work when only a subset is needed. Default is "everything." Useful when Cody knows he only wants e.g. dead-click counts.
- **Count default for recordings:** `10`; max `250` (matches upstream's max).
- **Variant order in `compare-by-variant`:** ascending by value. If values are numeric, sort numerically; if string-like (`control`, `v1`, `v3`), sort with `control` first, then natural sort.
- **Pre-computed deltas:** `compare-by-variant` always computes `delta` columns vs. control to prevent Cody from doing the math wrong.
- **Self-documenting errors:** every error message includes the action to take. Cookie expired → "rotate via Pulumi". Unknown tag key → "valid keys: [...]" using the cached `list-custom-tags` result.

## Instructions update

`src/instructions.ts` is rewritten. The new top-level guidance to Claude (Cody):

> This MCP exposes 5 tools for Microsoft Clarity:
>
> **Data tools (cookie auth):**
> - `query-metrics` — typed dashboard metrics for any filter combo (URL, device, country, variant, etc.)
> - `list-session-recordings` — typed recording list for any filter combo
> - `compare-by-variant` — convenience: variant comparison table for one experiment, auto-discovers values
> - `list-custom-tags` — discovery: which custom tags are defined for the project
>
> **Documentation tool (bearer auth):**
> - `query-documentation-resources` — RAG over Microsoft Clarity docs
>
> **Routing rules:**
> - For ANY data question — variant or not — use `query-metrics` (single metrics) or `list-session-recordings` (recording list). Variant filters are just two optional fields (`tagKey`, `tagValue`).
> - For variant comparison reports specifically, prefer `compare-by-variant` — it auto-discovers values and pre-computes deltas, saving multiple tool calls.
> - For "what custom tags exist for this project" use `list-custom-tags`.
> - For Clarity-doc questions ("how do smart events work?") use `query-documentation-resources`.

## Integration with Cody

Cody's runtime: ECS Fargate task built from `Dockerfile.cody`, MCPs registered via mcporter at startup in `entrypoint-cody.sh:75-138`. Both env vars flow through `infra/src/secrets.ts` and `infra/src/agents.ts`.

### Dockerfile change

Replace the global install line:

```diff
- RUN npm install -g @microsoft/clarity-mcp-server
+ RUN npm install -g git+ssh://git@github.com/angelrojasm/clarity-mcp-server.git
```

(For early iteration we can vendor the repo into the docker context and install from a local path; switch to git+ssh once the fork stabilizes.)

### Entrypoint change

The existing Clarity mcporter block in `entrypoint-cody.sh` is updated to pass both credentials:

```diff
  "clarity": {
    "command": "clarity-mcp-server",
-   "args": ["--clarity_api_token=${CLARITY_API_TOKEN}"]
+   "args": ["--clarity_api_token=${CLARITY_API_TOKEN}"],
+   "env": { "CLARITY_DASHBOARD_COOKIE": "${CLARITY_DASHBOARD_COOKIE}" }
  }
```

Both vars stay set; if either is missing, the affected tools fail loudly while the others continue to work.

### Pulumi changes

- `infra/src/secrets.ts`: add `clarityDashboardCookie` mirror of `clarityApiToken` (lines ~89–93 pattern).
- `infra/src/agents.ts`: inject the new secret into Cody's container alongside `CLARITY_API_TOKEN` (lines ~145–149 pattern).
- Provision: `pulumi config set --secret clarityDashboardCookie "<cookie>"`, then `pulumi up`.

### Cookie capture (manual, by operator)

For v1, cookie capture is manual:

1. Operator logs into `https://clarity.microsoft.com` in Chrome (the team uses the ForeverSongs admin account).
2. DevTools → Application → Cookies → `clarity.microsoft.com`. Copy all cookies as a single `Cookie:` header string.
3. `pulumi config set --secret clarityDashboardCookie "<paste>"` and `pulumi up`.

Empirically the cookie remains valid for weeks. When tools start returning the "session expired" error, repeat. v2 (out of scope for this spec) can ship a small CLI helper to automate steps 1–2.

## Risks & stability

### The endpoint is undocumented

`clarity.microsoft.com/api/v2` is internal/private — Microsoft has published no contract, no schema, no SLA. All shape information used in this design is reverse-engineered from the dashboard's own network calls. Implications:

- **Microsoft can change anything without notice.** Operation names, field names, auth model, response shape — any of these may change in a deploy.
- **Mitigation:** keep `dashboard-client.ts` thin. GraphQL `query` strings live as named constants near the top of the file. Field-name mapping for filters is a single table (filter dimension → `field`/`dataType`/`operator`). Replacing a renamed operation = update one string + one table row; no architectural change.
- **Smoke test:** add a `npm run probe` script that hits a representative subset of operations with no-op filters and asserts the response shapes. Run before each deploy. If shape drifts, we know before Cody breaks.

### Auth via session cookies

Captured cookies are bearer credentials with the same effective scope as the operator's logged-in browser. Risks:

- **Leakage:** the cookie value in Pulumi config has the same trust level as the operator's Microsoft account on this project. Treat as a high-sensitivity secret. AWS Secrets Manager only.
- **Rotation:** Microsoft session cookies typically expire in 30–90 days. We expect ≥4 manual rotations per year. v2 helper script reduces friction.
- **Revocation:** Microsoft can invalidate the session at any time (suspicious traffic patterns, operator logout, etc.).
- **Single-credential failure:** when the cookie expires, ALL data tools go offline simultaneously (4 of 5 tools fail). `query-documentation-resources` continues working on its own bearer token. Mitigation: rotate cookies proactively before expiry; clear self-healing error messages tell Cody (and the operator reading Cody's Slack output) exactly what to do.

### Terms of Service

Reverse-engineering and programmatically calling an undocumented Microsoft endpoint to query *your own* project's data on *your own* account is generally permissible, but worth a 5-minute review of Clarity's Terms before shipping. The realistic risk profile is "Microsoft revokes the project's access," not legal action.

**Action:** before merging this spec into implementation, the impl plan adds a step to read clarity.microsoft.com/terms and note any clauses that bear on automated access. If anything looks restrictive, we revisit (e.g., file the upstream issue and live with the gap until Microsoft responds).

### Coexistence with the official MCP

If Microsoft ever exposes custom-tag filtering on the official `/mcp/*` backend, the new tools deprecate cleanly:

1. Reroute the dashboard tools to the official endpoint with the new filter shape.
2. Eventually delete `dashboard-client.ts` / `dashboard-types.ts` if the official tools fully cover the surface.

The fork is structured so this swap is a localized change in `dashboard-client.ts` only.

### Loss of NL dashboard query

We're removing the NL `query-analytics-dashboard` tool. Any prompt that relies on free-form English ("how many sessions had errors yesterday?") now has to be expressed via typed inputs. Two mitigations:

- The new `instructions.ts` tells Cody about the typed surface explicitly with examples. Claude is good at translating informal phrasing into typed parameters when the schema is exposed.
- Cody has not, in any captured transcript, used `query-analytics-dashboard` for a query that *required* NL parsing. Every example we have is one where typed parameters would have served as well or better. Loss is theoretical.

If this turns out to be wrong in production, we can re-add a minimal `query-by-natural-language` tool in v1.1 that maps NL to typed inputs locally — without ever calling the broken `/mcp/*` NL parser.

## Parallel track: upstream feature request

Open an issue at `microsoft/clarity-mcp-server` titled "Support filtering by custom tags (`clarity('set', ...)` data)". Body:

- Concrete use case (variant-level analysis of A/B experiments).
- Evidence from this work that the data exists (custom-tag filter works in the dashboard UI) and that the public MCP backend does not honor it (probe results).
- Request: expose `customTags` filtering on `/mcp/recordings/sample` and a working interpretation in the `/mcp/dashboard/query` NL parser.
- Link to this fork as a reference implementation.
- Mention existing issue #24 (similar request, no response since March 2026) to consolidate the ask.

Independent of this spec's implementation. Owner: Angel.

## Open questions / TODOs surfaced for the implementation plan

1. **Capture full GraphQL operation set.** The dashboard issues many GraphQL ops per page render; we sampled only ~5. The implementation plan starts by re-running the Playwright capture and recording every operation that fires when the dashboard renders a fully-filtered view. Output: a static map of `{operation_name → {query_string, response_extract_path}}` we ship in `dashboard-client.ts`.
2. **Capture filter-dimension → GraphQL field map.** Trigger each filter in the dashboard UI under Playwright (URL, device, country, etc., one at a time) and record the resulting filter envelope. Output: a table-driven `buildFilterEnvelope()` function. ~40 dimensions; mostly mechanical.
3. **List-tags discovery query.** The dropdown population query is one of the unsampled operations from #1. Capture it.
4. **Recording-list query.** Same — capture before implementing.
5. **Date range parser.** Single-purpose, no LLM. Test cases: `"yesterday"`, `"today"`, `"last 7 days"`, `"last 30 days"`, `"2026-04-29..2026-05-01"`, malformed input. Use America/New_York timezone (Cody is US-only).
6. **Project ID.** The dashboard URL embeds it (`w3y4c1nfgk` for ForeverSongs). Pass via `CLARITY_PROJECT_ID` env var (simpler than parsing from cookie).
7. **Caching scope.** `list-custom-tags` is cached for the MCP process lifetime. Cody redeploys monthly+, so this is fine. If we ever see staleness, add a `?refresh=true` flag.
8. **NL fallback decision.** Confirm during implementation that no captured Cody Clarity workflow requires NL parsing. If one shows up, add a minimal local NL→typed shim to v1.

## Acceptance criteria

The implementation is done when:

1. The fork builds clean (`npm run build`) with the new files; Microsoft's `tools.ts`/`types.ts` are present but not imported by `index.ts`.
2. `npm run probe` (a new script) successfully exercises a representative sample of operations with `Variables` filters and asserts response shapes.
3. `list-custom-tags` returns the same 9 tag keys we observed on 2026-05-01 (subject to drift as new experiments are tagged).
4. `query-metrics` with no `tagKey` reproduces unfiltered Clarity dashboard metrics within ±2% of values shown in the live dashboard for the same date range.
5. `query-metrics` with `filters: { tagKey: "cro-cart-3way", tagValue: "0" }` returns ~4× the sessions of `tagValue: "1"` (matching our manual probe).
6. `list-session-recordings` with `filters: { tagKey: "cro-cart-3way", tagValue: "1" }` returns recording links and metadata for variant 1 only.
7. `list-session-recordings` with `filters: { url: [{ value: "/cart", operator: "contains" }], device: ["Mobile"] }` (no variant) returns the same recordings the live dashboard shows for that filter combo.
8. `compare-by-variant` with `tagKey: "cro-cart-3way"` returns a 3-row table with deltas vs. control pre-computed.
9. `query-documentation-resources` with a sample question returns documentation snippets, demonstrating bearer auth still works.
10. Cody, deployed with both `CLARITY_API_TOKEN` and `CLARITY_DASHBOARD_COOKIE` configured, can call all 5 tools end-to-end from a Slack mention.
11. Every Cody-Clarity workflow visible in the captured transcripts (cart 5-way, cart 3-way) can be reproduced via the new tools without needing the removed Microsoft tools.
12. The upstream issue is filed at `microsoft/clarity-mcp-server` referencing #24.
