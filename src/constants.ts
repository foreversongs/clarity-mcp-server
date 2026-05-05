import { getConfigValue } from "./utils.js";

export const CLARITY_API_TOKEN = getConfigValue('clarity_api_token');

// Endpoint URLs.
export const API_BASE_URL = `https://clarity.microsoft.com/mcp`;
export const SESSION_RECORDINGS_URL = `${API_BASE_URL}/recordings/sample`;
export const ANALYTICS_DASHBOARD_URL = `${API_BASE_URL}/dashboard/query`;
export const DOCUMENTATION_URL = `${API_BASE_URL}/documentation/query`;

// Tool names.
export const ANALYTICS_DASHBOARD_TOOL = "query-analytics-dashboard";
export const DOCUMENTATION_TOOL = "query-documentation-resources";
export const SESSION_RECORDINGS_TOOL = "list-session-recordings";

// Tool descriptions.
export const ANALYTICS_DASHBOARD_DESCRIPTION = "Fetch Microsoft Clarity analytics data using a simplified natural language search query. The query should be focused on one specific data retrieval or aggregation task. Avoid complex multi-purpose queries. Time ranges should be explicitly specified when possible. If no time range is provided, prompt the user to specify one.";
export const DOCUMENTATION_DESCRIPTION = "Retrieve Microsoft Clarity documentation snippets for finding answers to user questions including step-by-step screenshots for setup guides, features, usage, troubleshooting, and integration instructions. The query should be focused on one specific documentation topic or question. Avoid complex multi-purpose queries.";
export const SESSION_RECORDINGS_DESCRIPTION = "List Microsoft Clarity session recordings based on specified filters. The filters allow you to narrow down the recordings by various criteria such as URLs, device types, browser, OS, country, city, and more. The date filter is required and must be in UTC ISO 8601 format.";

// === New constants for /api/v2 dashboard tools ===

export const DASHBOARD_API_URL = "https://clarity.microsoft.com/api/v2";

export const CLARITY_DASHBOARD_COOKIE = getConfigValue("clarity_dashboard_cookie");
export const CLARITY_PROJECT_ID = getConfigValue("clarity_project_id");

// New tool names (note: SESSION_RECORDINGS_TOOL is reused; same name, broader schema).
export const TAG_DISCOVERY_TOOL = "list-custom-tags";
export const QUERY_METRICS_TOOL = "query-metrics";
export const COMPARE_BY_VARIANT_TOOL = "compare-by-variant";

// New tool descriptions.
export const TAG_DISCOVERY_DESCRIPTION = "List all custom-tag keys defined for the Clarity project (e.g. experiment names from clarity('set', ...) calls). Use this when you need to discover what tags are available before filtering by variant.";

export const QUERY_METRICS_DESCRIPTION = "Fetch typed Microsoft Clarity dashboard metrics for any combination of filters including custom-tag (variant) filters. Returns sessions, engagement, top pages, dead/rage clicks, scroll depth, and JS errors. Replaces query-analytics-dashboard with a typed parameter shape and variant-aware filtering. Use this for ANY metric question — variant or not.";

export const COMPARE_BY_VARIANT_DESCRIPTION = "Compare all variants of a custom-tag (experiment). Auto-discovers values for the given tagKey, fans out metric queries per variant, and returns a table with deltas vs. control pre-computed. Use this for variant comparison reports.";

// Reuse existing SESSION_RECORDINGS_TOOL constant; override its description.
export const NEW_SESSION_RECORDINGS_DESCRIPTION = "List Microsoft Clarity session recordings matching a typed filter set (URL, device, country, custom-tag, etc.). Returns up to 250 recordings with playerUrl + metadata. Variant filtering supported via tagKey/tagValue.";
