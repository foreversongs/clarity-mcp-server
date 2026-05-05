import {
  COMPARE_BY_VARIANT_TOOL,
  DOCUMENTATION_TOOL,
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
Typed dashboard metrics for any combination of filters. Use this for ANY metric question — variant or not.

Filter dimensions include: \`url\`, \`device\`, \`browser\`, \`os\`, \`country\`, \`channel\`, \`source\`, \`medium\`, \`campaign\`, \`smartEvents\`, \`javascriptErrors\`, \`scrollDepth\` (range), \`sessionDuration\` (range), \`pagesCount\` (range), and the variant filters \`tagKey\`+\`tagValue\`.

Metrics: \`sessions\`, \`engagement\`, \`newVsReturning\`, \`topReferrers\`, \`topPages\`, \`scrollDepth\`, \`deadClicks\`, \`rageClicks\`, \`jsErrors\`, \`topDeadClickTargets\`, \`topClickedElements\`. Default: all.

Date range: accepts \`"last 7 days"\` (default), \`"yesterday"\`, \`"today"\`, \`"last N days"\` (1-90), \`"YYYY-MM-DD..YYYY-MM-DD"\`.

#### \`${SESSION_RECORDINGS_TOOL}\`
Typed session-recording list with the same filter union as \`${QUERY_METRICS_TOOL}\`. Returns up to 250 recordings with \`playerUrl\` + metadata. Sort options: \`newest\` (default), \`oldest\`, \`longest\`, \`shortest\`, \`most-clicks\`, \`most-pages\`.

#### \`${COMPARE_BY_VARIANT_TOOL}\`
Convenience: comparison table for one experiment. Auto-discovers values for the given \`tagKey\`, queries each, and computes deltas vs. control.

Use for variant comparison reports specifically. For single-variant questions or non-variant questions, use \`${QUERY_METRICS_TOOL}\` directly.

### Documentation tool (bearer auth via CLARITY_API_TOKEN)

#### \`${DOCUMENTATION_TOOL}\`
RAG over Microsoft Clarity documentation. Use for "how does X work" questions about Clarity itself.

## Routing rules

- For ANY data question: use \`${QUERY_METRICS_TOOL}\` or \`${SESSION_RECORDINGS_TOOL}\`. Variant filters are just two optional fields (\`tagKey\`, \`tagValue\`) within the same filter union.
- For variant comparison reports: use \`${COMPARE_BY_VARIANT_TOOL}\`.
- For "what tags exist": use \`${TAG_DISCOVERY_TOOL}\`.
- For Clarity-doc questions: use \`${DOCUMENTATION_TOOL}\`.

## Error handling

If you see "Clarity dashboard session expired", relay the message to the user — the cookie needs to be rotated by an operator. The data tools will not work until a fresh cookie is provided via Pulumi config.

If you see "Clarity API token not set", the documentation tool can't run. The data tools may still work.
`;
