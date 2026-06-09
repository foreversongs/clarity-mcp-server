# Changelog

All notable divergences from upstream `microsoft/clarity-mcp-server` and changes between fork releases.

## v3.2.0

### Fixed
- **`list-custom-tags` and `compare-by-variant` HTTP 400** — both tools called GraphQL operations that don't exist on Clarity's `/api/v2` (`listCustomTagKeys` / `listCustomTagValues` were guessed field names). Clarity's endpoint is safelisted and rejected them with HTTP 400. Replaced with the real `extraFilters` operation (captured from the dashboard's Filters panel), which returns `projectFeatures.variables[] { name, values }` — every custom-tag key and its values in one call, scoped to the requested window.

### Added
- **`EXTRA_FILTERS` operation** in `operations.ts`.
- **`dateRange` parameter on `list-custom-tags`** — the tag list is date-scoped (a tag only appears if a session in the window carried it), so the tool accepts an optional window (default last 7 days) to surface tags from older or recently-stopped experiments.

### Changed
- **`compare-by-variant` value discovery** now reads variant values from the same `extraFilters` response instead of the separate (also-400ing) `listCustomTagValues` op, and throws an actionable error when the requested tag has no data in the window.
- **`listCustomTags` caching** is now per-window (keyed by the `dateRange` input) rather than a single global cache.

### Removed
- **`LIST_CUSTOM_TAG_KEYS` / `LIST_CUSTOM_TAG_VALUES`** operations — guessed queries that always returned HTTP 400.

## v3.1.0

### Added
- **`get-click-elements` tool** — per-element click breakdown for a specific page from Clarity's heatmap endpoint. `clickType` selects the lens: `all`, `dead`, `rage`, `error`, `first`, `last`. Returns ranked elements with click counts, normalized average position, a 3×3 region label, an above-the-fold flag, and deep links to the dashboard heatmap and recordings views.
- **`pageViewScrollDepth` + `scrollReachThresholds`** in `query-metrics` output — page-view-scoped scroll depth (computed from heatmap `scrollMapInfo` survival distribution) plus reach thresholds (`% of PVs reaching ≥25/50/75/100`). Returned when `filters.url` is provided.
- **`GET_HEATMAP_TYPE_DATA` and `GET_HEATMAP_PAYLOAD`** GraphQL operations.
- **`buildHeatmapFilter`** envelope builder — `Or`-wrapped variant clause, `RegexMatch` URL filter, no `pageDuration` clause (heatmap data is page-event-scoped, not session-scoped).

### Changed
- **Timestamp format** — `formatNaiveET` replaced by `formatTimestamp` (full UTC ISO with `Z`). The server interprets naive timestamps as UTC, not ET; ET-formatted strings shifted "last 7 days" 4 hours behind reality and undercounted ramping experiments by ~26%. Verified empirically against the dashboard's own request shape.
- **`parseDateRange("last N days")`** — now uses a rolling instant-arithmetic window from `now`, with no day-alignment. Matches the Clarity dashboard's "Last 7 days" filter exactly. `today` / `yesterday` / explicit ISO ranges remain ET-day-aligned (semantically correct for those phrasings); only the wire format becomes UTC.
- **`query-metrics` `scrollDepth` field renamed**: dropped, replaced by `pageViewScrollDepth` + `sessionScrollDepth`. The previous single field overloaded two different metrics depending on whether a variant filter was present.

### Removed
- **`fetchScrollDepthViaNL`** path that called `/mcp/dashboard/query` for scroll depth. Replaced by `getHeatmapTypeData` for PV-scoped scroll and `getInsightsMetrics` for session-scoped — both `/api/v2`.
- **`ANALYTICS_DASHBOARD_URL` and `SESSION_RECORDINGS_URL`** constants — only `DOCUMENTATION_URL` (used by `query-documentation-resources`) still references the legacy `/mcp` endpoint.
- **`src/tools.ts`** vestigial upstream wrappers (`queryAnalyticsDashboardAsync`, `queryDocumentationAsync`, `listSessionRecordingsAsync`) — superseded by the typed dashboard tools and not registered in `index.ts`.

## v3.0.0

### Added
- **`/api/v2` GraphQL backend** — typed dashboard tool surface backed by `clarity.microsoft.com/api/v2`, the same endpoint the dashboard UI uses. Bearer-auth (`CLARITY_API_TOKEN`) only covers the documentation tool from upstream; data tools require `CLARITY_DASHBOARD_COOKIE` (a full session cookie including `_csrf`) and `CLARITY_PROJECT_ID`.
- **Custom-tag (variant) filtering** — `tagKey` / `tagValue` filters translate to `Variables Contains "<key>=<value>"` in the dashboard's filter envelope. Required for analyzing experiments where variants are emitted via `clarity('set', '<exp>', '<variant>')`.
- **`list-custom-tags`** — discover available tag keys.
- **`query-metrics`** — typed metrics with the variant-aware filter union (replaces the upstream natural-language `query-analytics-dashboard`).
- **`compare-by-variant`** — auto-discovers variant values for a given `tagKey`, fans out per-variant queries, computes deltas vs control.
- **`list-session-recordings`** — typed schema with the same filter union as `query-metrics`. Same name as the upstream tool but extended for variant filtering.
- **`scripts/probe.ts`** — connectivity smoke test for the dashboard endpoint.

### Changed
- **Tool registration** — only the new typed tools and the upstream documentation tool are registered. The upstream `query-analytics-dashboard` (NL parser) is not registered.

### Removed
- **`query-analytics-dashboard`** tool registration — replaced by the typed `query-metrics`. The NL parser endpoint is deprecated upstream and produced inconsistent results vs the dashboard UI for variant queries.

### Known limitations
- A handful of GraphQL operations are **provisional**, flagged in their docstrings: `LIST_CUSTOM_TAG_KEYS`, `LIST_CUSTOM_TAG_VALUES`, `GET_TOP_PAGES`, `GET_RECORDINGS`. Their field names were inferred from schema introspection, not captured live. Mismatch with the live schema will surface as a loud `DashboardHttpError` (e.g. `Unknown field "customTagKeys" on type "ProjectFeatures"`); failures are not silent, but `list-custom-tags`, `compare-by-variant`, and `list-session-recordings` should be verified against your live project before being depended on for downstream automation.
