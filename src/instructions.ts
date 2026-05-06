import {
  COMPARE_BY_VARIANT_TOOL,
  DOCUMENTATION_TOOL,
  GET_CLICK_ELEMENTS_TOOL,
  QUERY_METRICS_TOOL,
  SESSION_RECORDINGS_TOOL,
  TAG_DISCOVERY_TOOL,
} from "./constants.js";

export const SYSTEM_INSTRUCTIONS_PROMPT = `
This MCP server provides Microsoft Clarity dashboard data and documentation.

## Tool Surface

### Data tools (cookie auth via CLARITY_DASHBOARD_COOKIE)

#### \`${TAG_DISCOVERY_TOOL}\`
Returns the list of custom-tag *keys* defined for the project (e.g. ["my_experiment", "checkout_error_code", ...]).
Use this when you don't know which experiment tags exist for the project.

#### \`${QUERY_METRICS_TOOL}\`
Typed dashboard metrics for any combination of filters. Use this for ANY aggregate metric question — variant or not.

Filter dimensions include: \`url\`, \`device\`, \`browser\`, \`os\`, \`country\`, \`channel\`, \`source\`, \`medium\`, \`campaign\`, \`smartEvents\`, \`javascriptErrors\`, \`scrollDepth\` (range), \`sessionDuration\` (range), \`pagesCount\` (range), and the variant filters \`tagKey\`+\`tagValue\`.

Metrics: \`sessions\`, \`engagement\`, \`newVsReturning\`, \`topReferrers\`, \`topPages\`, \`scrollDepth\`, \`deadClicks\`, \`rageClicks\`, \`jsErrors\`, \`topDeadClickTargets\`, \`topClickedElements\`. Default: all.

Date range: accepts \`"last 7 days"\` (default), \`"yesterday"\`, \`"today"\`, \`"last N days"\` (1-90), \`"YYYY-MM-DD..YYYY-MM-DD"\`.

**Scroll-depth scope** matters: when \`filters.url\` is provided, the response includes \`pageViewScrollDepth\` (per-page-view from the heatmap endpoint — the right metric for single-page experiments) plus \`scrollReachThresholds\` (% of PVs reaching ≥25/50/75/100). Without \`filters.url\`, only \`sessionScrollDepth\` is returned (matches the dashboard's "Scroll depth" card; max scroll across all pages in the session). For variant analysis on a single landing page **always pass \`filters.url\`** — page-view-scoped scroll is typically much lower than session-scoped on mobile landings (where many sessions barely reach the fold) and is the metric experiment readouts actually want.

#### \`${SESSION_RECORDINGS_TOOL}\`
Typed session-recording list with the same filter union as \`${QUERY_METRICS_TOOL}\`. Returns up to 250 recordings with \`playerUrl\` + metadata. Sort options: \`newest\` (default), \`oldest\`, \`longest\`, \`shortest\`, \`most-clicks\`, \`most-pages\`.

#### \`${COMPARE_BY_VARIANT_TOOL}\`
Convenience: comparison table for one experiment. Auto-discovers values for the given \`tagKey\`, queries each, and computes deltas vs. control.

Use for variant comparison reports specifically. For single-variant questions or non-variant questions, use \`${QUERY_METRICS_TOOL}\` directly.

#### \`${GET_CLICK_ELEMENTS_TOOL}\`
Per-element click breakdown for a specific page. Answers "where on the page are dead clicks happening?" or "what's the most-clicked element on variant B vs A?" \`clickType\` selects the lens:

- \`all\` — every recorded click (most-clicked elements ranked)
- \`dead\` — clicks that triggered no JS / DOM action
- \`rage\` — repeated frustration clicks in same area
- \`error\` — click that preceded a JS error within ~1s
- \`first\` — first click per session (top-of-mind action)
- \`last\` — last click before bailout

Variant-filterable via \`filters.tagKey\`/\`tagValue\`. Returns ranked elements with click counts and a 3×3 region label (\`top-left\`, \`middle-center\`, etc.).

**Important caveats** (also in the response \`warnings\`):
- Clarity's API does **not** expose CSS selectors — only opaque element hashes. To identify a specific element visually, open the \`dashboardUrl\` returned in the response.
- \`avgX\`, \`avgY\`, \`region\`, and \`aboveFold\` are **experimental**: Clarity's coordinate scale isn't officially documented. Relative ordering across elements is reliable, absolute positions should not be relied on.
- \`heatmapTypeInfo\` may be null for sparse data (e.g., zero rage clicks for a small variant). The tool returns an empty \`elements\` array and a warning in that case.

When asked "where are the dead clicks coming from on this page?" → use this tool with \`clickType: "dead"\`. Do NOT infer from a DOM scan against \`cursor: pointer\` — that approach has false positives in React apps because \`onClick\` props don't appear as DOM attributes.

### Documentation tool (bearer auth via CLARITY_API_TOKEN)

#### \`${DOCUMENTATION_TOOL}\`
RAG over Microsoft Clarity documentation. Use for "how does X work" questions about Clarity itself.

## Routing rules

- For ANY aggregate metric question: use \`${QUERY_METRICS_TOOL}\` or \`${SESSION_RECORDINGS_TOOL}\`. Variant filters are just two optional fields (\`tagKey\`, \`tagValue\`) within the same filter union.
- For variant comparison reports: use \`${COMPARE_BY_VARIANT_TOOL}\`.
- For element-level questions ("where are the clicks/dead clicks/rage clicks happening on this page?"): use \`${GET_CLICK_ELEMENTS_TOOL}\`.
- For "what tags exist": use \`${TAG_DISCOVERY_TOOL}\`.
- For Clarity-doc questions: use \`${DOCUMENTATION_TOOL}\`.

## Error handling

If you see "Clarity dashboard session expired", relay the message to the user — the cookie needs to be rotated by an operator. The data tools will not work until a fresh cookie is provided via Pulumi config.

If you see "Clarity API token not set", the documentation tool can't run. The data tools may still work.
`;
