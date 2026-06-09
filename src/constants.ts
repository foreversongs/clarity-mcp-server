import { getConfigValue } from "./utils.js";

export const CLARITY_API_TOKEN = getConfigValue('clarity_api_token');

// Endpoint URLs.
export const API_BASE_URL = `https://clarity.microsoft.com/mcp`;
export const DOCUMENTATION_URL = `${API_BASE_URL}/documentation/query`;
export const DASHBOARD_API_URL = "https://clarity.microsoft.com/api/v2";

// Tool names.
export const DOCUMENTATION_TOOL = "query-documentation-resources";
export const SESSION_RECORDINGS_TOOL = "list-session-recordings";

// Tool descriptions.
export const DOCUMENTATION_DESCRIPTION = "Retrieve Microsoft Clarity documentation snippets for finding answers to user questions including step-by-step screenshots for setup guides, features, usage, troubleshooting, and integration instructions. The query should be focused on one specific documentation topic or question. Avoid complex multi-purpose queries.";

export const CLARITY_DASHBOARD_COOKIE = getConfigValue("clarity_dashboard_cookie");
export const CLARITY_PROJECT_ID = getConfigValue("clarity_project_id");

// Dashboard tool names. SESSION_RECORDINGS_TOOL (declared above) is shared
// with the documentation tool surface — same name, dashboard-backed schema.
export const TAG_DISCOVERY_TOOL = "list-custom-tags";
export const QUERY_METRICS_TOOL = "query-metrics";
export const COMPARE_BY_VARIANT_TOOL = "compare-by-variant";
export const GET_CLICK_ELEMENTS_TOOL = "get-click-elements";

// Dashboard tool descriptions.
export const TAG_DISCOVERY_DESCRIPTION = "List the custom-tag keys that have data for the Clarity project in a given window (e.g. experiment slugs from clarity('set', ...) calls). Use this to discover what tags are available before filtering by variant. NOTE: the list is date-scoped — a tag only appears if a session in the window carried it. Defaults to the last 7 days; pass dateRange (e.g. 'last 30 days') to surface tags from older or recently-stopped experiments.";

export const QUERY_METRICS_DESCRIPTION = "Fetch typed Microsoft Clarity dashboard metrics for any combination of filters including custom-tag (variant) filters. Returns sessions, engagement, top pages, dead/rage clicks, scroll depth, and JS errors. Use this for ANY aggregate metric question — variant or not. NOTE on scroll depth: pass `filters.url` to get page-view-scoped scroll depth (right metric for single-page experiments). Without `filters.url`, only sessionScrollDepth (session-level, matches the dashboard's Scroll-depth card) is returned.";

export const COMPARE_BY_VARIANT_DESCRIPTION = "Compare all variants of a custom-tag (experiment). Auto-discovers values for the given tagKey, fans out metric queries per variant, and returns a table with deltas vs. control pre-computed. Use this for variant comparison reports.";

export const GET_CLICK_ELEMENTS_DESCRIPTION = "Per-element click breakdown for a specific page from Clarity's heatmap data. Use for 'where on this page are dead clicks happening?' style questions. clickType controls the lens: all = every click; dead = clicks that did nothing; rage = repeated frustrated clicks; error = preceded a JS error; first = first click per session; last = last click before bailout. Variant-filterable. Returns ranked elements with click counts, normalized avgX/avgY, and a 3x3 region label (e.g. 'top-center'). NOTE: Clarity does NOT expose CSS selectors — only opaque element hashes. Open dashboardUrl (returned in response) to see selectors visually. avgX/avgY/region/aboveFold are experimental — coordinate scale is not officially documented; relative ordering is reliable, absolute positions are not.";

export const SESSION_RECORDINGS_DESCRIPTION = "List Microsoft Clarity session recordings matching a typed filter set (URL, device, country, custom-tag, etc.). Returns up to 250 recordings with playerUrl + metadata. Variant filtering supported via tagKey/tagValue.";
