# Clarity Variant Tools — Design

**Status:** draft
**Author:** Angel Rojas
**Date:** 2026-05-01
**Repo:** `angelrojasm/clarity-mcp-server` (fork of `microsoft/clarity-mcp-server`)
**Drives:** Cody (ForeverSongs CRO agent) reporting per-variant Clarity behavior data

---

## Problem

Cody can already pull aggregate Clarity dashboards and unfiltered session recordings via the official `@microsoft/clarity-mcp-server`. He cannot filter any of that data by experiment-variant **custom tags** (`clarity('set', 'cro-cart-3way', '1')`). Variant-aware behavior analysis is the most common ask in `#songs-cro` (`C0AFK107HPZ`), and the boss has now flagged this gap directly.

The custom tag data exists in Clarity (the dashboard UI's *Custom tags* filter works correctly). It is not exposed by Microsoft's official MCP backend at `clarity.microsoft.com/mcp/*`, nor by the public Data Export API. We confirmed this empirically: every plausible field name and shape (`customTags`, `customTag`, `tags`, `customTagFilters`, `Variables`, `customDimensions`, root-level vs. nested, GraphQL-style envelope) is silently ignored by `/mcp/recordings/sample` — distributions across all variants and gibberish fields are statistically indistinguishable.

The dashboard at `clarity.microsoft.com` uses a different, undocumented GraphQL endpoint at `/api/v2` that **does** support custom-tag filtering. Direct calls confirm it: variant 0 returns 4,080 sessions, variant 1 returns 1,018 — a clean 4× delta the MCP backend cannot reproduce.

This spec proposes adding three new tools to the existing fork that hit `/api/v2` directly, alongside the unchanged official tools.

## Non-goals

- Modifying any of Microsoft's existing code (`src/tools.ts`, `src/types.ts`, public API of `index.ts`). New code lives in new files.
- Replacing the official MCP. The unfiltered NL-dashboard tool and unfiltered session-recordings tool stay; our new tools complement them.
- Building a heatmap viewer or recording playback. Recording **links** are enough — humans click them in Slack.
- Time-series breakdowns, smart-event-tagged tools, or per-element click drill-downs. Out of v1; revisit if asked.
- Publishing to the public npm registry under a Microsoft-adjacent name.
- Headless browser / Playwright auth flows. Cookie comes from a manual login on the operator's machine.

## Architecture

### Home

The new tools live in **`angelrojasm/clarity-mcp-server`** (the existing fork). The package is renamed:

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
│   ├── tools.ts              ← UNCHANGED (Microsoft's)
│   ├── types.ts              ← UNCHANGED (Microsoft's)
│   ├── instructions.ts       ← extend: add a "Variant Tools" section
│   ├── utils.ts              ← UNCHANGED
│   ├── dashboard-client.ts   ← NEW — POST to /api/v2 with cookie auth
│   ├── dashboard-types.ts    ← NEW — Zod schemas for new tools
│   ├── dashboard-tools.ts    ← NEW — the 3 tool implementations
│   └── index.ts              ← extend: register both old and new tools
├── docs/
│   └── superpowers/specs/
│       └── 2026-05-01-clarity-variant-tools-design.md   ← this file
└── package.json              ← rename
```

### Auth model

Two independent env-driven credentials:

| Tools | Env var | Format |
|---|---|---|
| Official tools (unchanged) | `CLARITY_API_TOKEN` (or `--clarity_api_token`) | Bearer JWT |
| New variant tools | `CLARITY_DASHBOARD_COOKIE` | Raw `Cookie:` header value, captured from a logged-in browser session |

The two never mix. If a tool's required credential is missing, the tool returns a clear text error — `"Clarity API token not set"` (existing behavior) or `"Clarity dashboard session expired or missing. Run 'pulumi config set --secret clarityDashboardCookie <cookie>' and redeploy."` (new). The MCP starts and serves regardless of which credential is present.

CSRF token is parsed at request time from the `_csrf=...` value within the cookie string and sent as a `csrf-token` header alongside `Cookie`.

### Wire-level call shape

Every variant tool POSTs to `https://clarity.microsoft.com/api/v2` with:

```http
POST /api/v2 HTTP/1.1
Host: clarity.microsoft.com
Content-Type: application/json
Cookie: <CLARITY_DASHBOARD_COOKIE verbatim>
csrf-token: <_csrf cookie value>

{ "operationName": "...", "variables": {...}, "query": "..." }
```

GraphQL `query` strings and the `filters` JSON envelope are lifted verbatim from captured dashboard requests. The custom-tag filter shape inside the envelope is:

```json
{
  "operator": "Contains",
  "field": "Variables",
  "dataType": "Other",
  "value": "<tagKey>=<tagValue>",
  "invert": false
}
```

We always wrap that in an outer `And` envelope with the date range and a `pageDuration > 0` clause, matching what the dashboard sends.

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

### `compare-by-variant`

**Purpose:** the primary tool. Auto-discovers all values for a tag key and returns one row per variant with the metrics Cody writes about in every CRO report.

**Input:**
```ts
{
  tagKey: string,                      // e.g. "cro-cart-3way"
  dateRange?: string                   // default: "last 7 days"
                                       // accepts: "yesterday", "last N days",
                                       //   "YYYY-MM-DD..YYYY-MM-DD"
}
```

**Output:**
```json
{
  "tagKey": "cro-cart-3way",
  "dateRange": { "start": "...", "end": "..." },
  "variants": [
    {
      "value": "0",
      "isControl": true,
      "sessions": 4080, "botSessions": 337,
      "engagement": { "totalTime": 412, "activeTime": 298 },
      "newVsReturning": { "new": 3801, "returning": 279 },
      "topReferrers": [{ "item": "facebook.com", "count": 612 }, ...],
      "topPages":     [{ "item": "/cart", "count": 871 }, ...],
      "scrollDepth": 95.2,
      "deadClickRate": 11.4,
      "rageClickRate": 0.13,
      "jsErrorRate": 0.7
    },
    {
      "value": "1",
      "isControl": false,
      "sessions": 1018, "botSessions": 93,
      ...
      "deltas": {
        "sessions": "-75.0%",
        "engagement.activeTime": "+3.2%",
        ...
      }
    },
    { "value": "2", ... }
  ]
}
```

**Behavior:**

1. Discover values: query for distinct values of `tagKey` (lift the same query the dashboard uses to populate the value combobox).
2. For each value, fan out 6–8 GraphQL queries in parallel:
   - `getSessionsInfo`
   - `getEngagementMetrics`
   - `getNewAndReturning`
   - `getTopMetrics` (referrers)
   - top pages query
   - dead/rage/scroll/js error queries (the dashboard exposes each as its own GraphQL op)
3. Merge results into one variant row.
4. Designate the lowest-numerically-sorted value (or `"control"` if present) as control. Compute `deltas` for non-control variants as `(metric - control) / control` formatted as percentage.
5. Return.

**Failure mode:** if any sub-query fails, the corresponding field in that variant's row is `null` and a `_warnings: string[]` array on the row lists which sub-queries failed. The whole tool call does not fail unless auth is broken (in which case all sub-queries fail and we surface the cookie-rotation error).

### `recordings-by-variant`

**Purpose:** pull session recording links for one specific variant — used after `compare-by-variant` reveals an outlier.

**Input:**
```ts
{
  tagKey: string,
  tagValue: string,
  dateRange?: string,                  // default: "last 7 days"
  count?: number,                      // default: 10, max: 100
  sortBy?: "newest" | "oldest" | "longest" | "shortest" | "most-clicks"  // default: "newest"
}
```

**Output:**
```json
{
  "filter": { "tagKey": "cro-cart-3way", "tagValue": "1", "dateRange": {...} },
  "recordings": [
    {
      "playerUrl": "https://clarity.microsoft.com/player/w3y4c1nfgk/.../...",
      "timestamp": "2026-04-30 18:22:14",
      "totalDuration": "00:04:12",
      "activeDuration": "00:02:48",
      "pages": 5,
      "clickCount": 22,
      "country": "United States",
      "device": "Mobile"
    },
    ...
  ]
}
```

**Implementation:** same `/api/v2` recordings query the dashboard's *Recordings* page uses, with the `Variables` filter set as in `compare-by-variant`. Sort options map to the dashboard's known `sortField` values.

## Defaults & ergonomics

- **Date range default:** `"last 7 days"`. Parsed by a small in-process parser, no NL pass through an LLM.
- **Date range formats accepted:** `"yesterday"`, `"today"`, `"last N days"` (1–90), `"YYYY-MM-DD..YYYY-MM-DD"` (any historical window the project retains).
- **Count default:** `10` recordings; max `100`.
- **Variant order in `compare-by-variant`:** ascending by value. If values are numeric, sort numerically; if string-like (`control`, `v1`, `v3`), sort with `control` first, then natural sort.
- **Pre-computed deltas:** `compare-by-variant` always computes `delta` columns vs. control to prevent Cody from doing the math wrong.
- **Self-documenting errors:** every error message includes the action to take. Cookie expired → "rotate via Pulumi". Unknown tag key → "valid keys: [...]" (using the cached `list-custom-tags` result).

## Instructions update

`src/instructions.ts` adds a new section telling Claude (Cody) when to reach for these tools:

> **Variant Tools** (`list-custom-tags`, `compare-by-variant`, `recordings-by-variant`)
>
> Use these when the user asks about an experiment, A/B test, or "variant" — anything where the question is "how does variant N differ from variant M on Clarity behavior data?"
>
> Workflow: discover → compare → drill in.
> 1. If you don't know the tag key, call `list-custom-tags` first.
> 2. Call `compare-by-variant` with the experiment's tag key. The output table is the answer to most variant comparison questions.
> 3. If a variant looks anomalous, call `recordings-by-variant` for that one variant to get session links to share.
>
> Do NOT use the old `query-analytics-dashboard` for variant questions — its NL parser does not understand custom tags and will confuse them with SmartEvent names. Do NOT use the old `list-session-recordings` for variant questions — its filter schema does not include custom tags.

## Integration with Cody

Cody's runtime: ECS Fargate task built from `Dockerfile.cody`, MCPs registered via mcporter at startup in `entrypoint-cody.sh:75-138`. New env var flows through `infra/src/secrets.ts` and `infra/src/agents.ts` exactly like `CLARITY_API_TOKEN` does today.

### Dockerfile change

Replace the global install line:

```diff
- RUN npm install -g @microsoft/clarity-mcp-server
+ RUN npm install -g git+ssh://git@github.com/angelrojasm/clarity-mcp-server.git
```

(For early iteration we can vendor the repo into the docker context and install from a local path; switch to git+ssh once the fork stabilizes.)

### Entrypoint change

The existing Clarity mcporter block in `entrypoint-cody.sh` stays, with one env var added:

```diff
  "clarity": {
    "command": "clarity-mcp-server",
-   "args": ["--clarity_api_token=${CLARITY_API_TOKEN}"]
+   "args": ["--clarity_api_token=${CLARITY_API_TOKEN}"],
+   "env": { "CLARITY_DASHBOARD_COOKIE": "${CLARITY_DASHBOARD_COOKIE}" }
  }
```

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
- **Mitigation:** keep `dashboard-client.ts` thin. GraphQL `query` strings live as named constants near the top of the file. Field-name extraction in the response uses small per-tool transform functions. Replacing a renamed operation = update one string + one transform; no architectural change.
- **Smoke test:** add a `npm run probe` script that hits `getSessionsInfo` with a no-op filter and asserts the response shape. Run before each deploy. If shape drifts, we know before Cody breaks.

### Auth via session cookies

Captured cookies are bearer credentials with the same effective scope as the operator's logged-in browser. Risks:

- **Leakage:** the cookie value in Pulumi config has the same trust level as the operator's Microsoft account on this project. Treat as a high-sensitivity secret. AWS Secrets Manager only.
- **Rotation:** Microsoft session cookies typically expire in 30–90 days. We expect ≥4 manual rotations per year. v2 helper script reduces friction.
- **Revocation:** Microsoft can invalidate the session at any time (suspicious traffic patterns, operator logout, etc.).

### Terms of Service

Reverse-engineering and programmatically calling an undocumented Microsoft endpoint to query *your own* project's data on *your own* account is generally permissible, but worth a 5-minute review of Clarity's Terms before shipping. The realistic risk profile is "Microsoft revokes the project's access," not legal action.

**Action:** before merging this spec into implementation, add a TODO in the impl plan to read clarity.microsoft.com/terms and note any clauses that bear on automated access. If anything looks restrictive, reconsider Option C (upstream feature request only) before shipping.

### Coexistence with the official MCP

If Microsoft ever exposes custom-tag filtering on the official `/mcp/*` backend (whether via the public MCP or the Data Export API), our 3 new tools deprecate cleanly:

1. Reroute the new tools to the official endpoint with the new filter shape.
2. Eventually delete `dashboard-client.ts` / `dashboard-types.ts` / `dashboard-tools.ts` if the official tools fully cover variant filtering.

The fork is structured so this swap is a localized change. We do not modify Microsoft's code in the meantime.

## Parallel track: upstream feature request

Open an issue at `microsoft/clarity-mcp-server` titled "Support filtering by custom tags (`clarity('set', ...)` data)". Body:

- Concrete use case (variant-level analysis of A/B experiments).
- Evidence from this work that the data exists (custom-tag filter works in the dashboard UI).
- Request: expose `customTags` filtering on `/mcp/recordings/sample` and on `/mcp/dashboard/query`'s NL parser.
- Link to this fork as a reference implementation.

Independent of this spec's implementation. Owner: Angel.

## Open questions / TODOs surfaced for the implementation plan

1. **Exact GraphQL strings.** The spec captured *categories* of operations. The implementation plan should record each canned `query` string verbatim from the dashboard, with the operation name, the parameters, and the response shape we extract. Do this by re-running the Playwright capture and recording every operation that fires when the dashboard renders a single `Variables=cro-cart-3way:1` filtered view.
2. **List-tags discovery query.** We saw the dropdown population happens via a GraphQL call we did not capture. First implementation step is to capture that call.
3. **Recording-list query.** Same — we lifted the *filter shape* from `getSessionsInfo` but not the actual recordings-list operation. Capture before implementing.
4. **Date range parser.** Single-purpose, no LLM. Confirm test cases: `"yesterday"`, `"today"`, `"last 7 days"`, `"last 30 days"`, `"2026-04-29..2026-05-01"`, malformed input. Decide on caller's timezone vs. UTC for parsing (Cody is US-only — default to America/New_York).
5. **Project ID.** The dashboard URL embeds it (`w3y4c1nfgk` for ForeverSongs). Pass via `CLARITY_PROJECT_ID` env var? Or extract from the cookie if it's there? Implementation plan to decide; env var is simpler.
6. **Caching scope.** `list-custom-tags` is cached for the MCP process lifetime. Is the process restarted at a frequency that makes this fine (yes — Cody redeploys monthly+) or should we use a TTL?

## Acceptance criteria

The implementation is done when:

1. The fork builds clean (`npm run build`) with the new files.
2. `npm run probe` (a new script) successfully calls `getSessionsInfo` with a `Variables` filter and returns the expected shape.
3. `list-custom-tags` returns the same 9 tag keys we observed on 2026-05-01 (subject to drift as new experiments are tagged).
4. `compare-by-variant` with `tagKey: "cro-cart-3way"` returns a 3-row table where variant `0` shows ~4× the sessions of variant `1` (matching our manual probe).
5. `recordings-by-variant` with `tagKey: "cro-cart-3way", tagValue: "1"` returns recording links and metadata for variant 1 only.
6. The official tools (`query-analytics-dashboard`, `list-session-recordings`, `query-documentation-resources`) still work unchanged — old auth path, old endpoint, old behavior.
7. Cody, deployed with both `CLARITY_API_TOKEN` and `CLARITY_DASHBOARD_COOKIE` configured, can call all 6 tools end-to-end from a Slack mention.
8. The upstream issue is filed at `microsoft/clarity-mcp-server`.
