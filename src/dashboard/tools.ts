import { z } from "zod";
import { postGraphQL, logExtract } from "./client.js";
import {
  EXTRA_FILTERS,
  GET_SESSIONS_INFO,
  GET_NEW_AND_RETURNING,
  GET_TOP_REFERRERS,
  GET_TOP_PAGES,
  GET_DEAD_CLICKS,
  GET_RAGE_CLICKS,
  GET_SCROLL_DEPTH,
  GET_JS_ERRORS,
  GET_TOP_DEAD_CLICK_TARGETS,
  GET_TOP_CLICKED_ELEMENTS,
  GET_RECORDINGS,
  GET_HEATMAP_TYPE_DATA,
  type Operation,
} from "./operations.js";
import {
  Filters,
  type FiltersType,
  MetricKey,
  type MetricKeyType,
  ALL_METRICS,
} from "./types.js";
import { parseDateRange, type DateRange } from "./date-range.js";
import { buildFilterEnvelope, buildHeatmapFilter } from "./filters.js";

function getProjectId(): string {
  const id = process.env.CLARITY_PROJECT_ID;
  if (!id || id.trim() === "") {
    throw new Error("CLARITY_PROJECT_ID env var is required. Set it to your Clarity project ID (e.g. 'w3y4c1nfgk').");
  }
  return id;
}

/**
 * Walk a dotted path through a parsed JSON response. Returns undefined if any
 * segment is missing.
 */
function extract(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * Extract + emit a CloudWatch-grep-able telemetry line. Tools call this so the
 * operator can see `extracted=false` even when the HTTP call succeeded — that's
 * the symptom of dashboard shape drift.
 */
function extractWithLog(op: string, obj: unknown, path: string): unknown {
  const result = extract(obj, path);
  logExtract(op, result !== undefined);
  return result;
}

/** A custom-tag key plus the values observed for it within the queried window. */
interface TagVariable {
  name: string;
  values: string[];
}

// Cache keyed by the dateRange input string ("__default__" for an unspecified
// range). The tag list is date-scoped — a tag only appears if a session in the
// window carried it — so caching by window (not globally) is required for
// correctness. Caching by the input string rather than the resolved envelope
// also keeps repeated same-window calls (e.g. listCustomTags + discoverValues)
// on a single network request, since the rolling "last N days" envelope's
// timestamps drift by milliseconds between calls.
//
// Entries never expire. The process is short-lived per MCP session, so the only
// staleness risk is a long-running process serving a stale "__default__"
// (rolling last-7-days) entry as the window advances or a new tag starts; a
// caller can force a fresh fetch by passing an explicit dateRange.
const tagVariablesCache = new Map<string, TagVariable[]>();

/**
 * Fetch the project's custom-tag keys and their observed values for a window,
 * via the dashboard's `extraFilters` operation. Both `listCustomTags` and
 * `compareByVariant`'s value discovery read from this so they share one call.
 */
async function fetchTagVariables(dateRange?: string): Promise<TagVariable[]> {
  const cacheKey = dateRange ?? "__default__";
  const cached = tagVariablesCache.get(cacheKey);
  if (cached) return cached;

  const serializedFilter = buildFilterEnvelope({}, parseDateRange(dateRange));
  const response = await postGraphQL(
    EXTRA_FILTERS.operationName,
    EXTRA_FILTERS.query,
    { projectId: getProjectId(), serializedFilter, tagsType: "UserCustomTags", includePageQualityIssuesSessions: false },
  );
  const raw = extractWithLog(EXTRA_FILTERS.operationName, response, EXTRA_FILTERS.responseExtractPath);
  if (!Array.isArray(raw)) {
    throw new Error(`Unexpected response shape from ${EXTRA_FILTERS.operationName} (expected array at path '${EXTRA_FILTERS.responseExtractPath}'). Response head: ${JSON.stringify(response).slice(0, 200)}`);
  }
  const vars: TagVariable[] = (raw as { name?: string; values?: unknown }[])
    .map((v) => ({
      name: String(v.name ?? ""),
      values: Array.isArray(v.values) ? v.values.map(String) : [],
    }))
    // Guard against a malformed/nameless entry yielding a meaningless "" tag key.
    .filter((v) => v.name !== "");
  tagVariablesCache.set(cacheKey, vars);
  return vars;
}

export async function listCustomTags(dateRange?: string): Promise<string[]> {
  return (await fetchTagVariables(dateRange)).map((v) => v.name);
}

export const ListCustomTagsInputShape = {
  dateRange: z.string().optional().describe(
    "Window to look for tags in (e.g. 'last 7 days', 'last 30 days', 'yesterday', '2026-05-01..2026-05-31'). " +
    "Defaults to last 7 days. The list is date-scoped — a tag only appears if a session in the window carried it, " +
    "so widen the range to surface tags from older/stopped experiments.",
  ),
};

// Test-only export so tests can reset the cache between cases.
export function __resetCacheForTests() {
  tagVariablesCache.clear();
}

export const QueryMetricsInputShape = {
  filters: Filters.optional(),
  metrics: z.array(MetricKey).optional(),
  dateRange: z.string().optional(),
};

export const QueryMetricsInput = z.object(QueryMetricsInputShape);

export type QueryMetricsInputType = z.infer<typeof QueryMetricsInput>;

export interface QueryMetricsOutput {
  filters?: FiltersType;
  dateRange: { start: string; end: string };
  /**
   * `total` is the count of real-user sessions matching the filter (bots are
   * already excluded by the backend by default). `bot` is informational —
   * how many additional bot sessions were filtered out, surfaced separately
   * so callers can mention it if asked.
   */
  sessions?: { total: number; bot: number };
  newVsReturning?: { new: number; returning: number };
  topReferrers?: { item: string; count: number }[];
  topPages?: { item: string; count: number }[];
  /**
   * Page-view-scoped scroll depth: average max scroll % per page view of the
   * URL in `filters.url`, computed from the heatmap endpoint's
   * `scrollMapInfo` survival distribution. This is the right metric for
   * single-page experiments — answers "how deep did people scroll on this page?"
   * Only set when `filters.url` is provided; otherwise the heatmap endpoint
   * cannot be called and only `sessionScrollDepth` is returned.
   */
  pageViewScrollDepth?: number;
  /**
   * Session-scoped scroll depth from `getInsightsMetrics` — max scroll across
   * all pages in the session, averaged across matching sessions. Always set
   * when scrollDepth is requested. Use this when comparing to the dashboard's
   * "Scroll depth" card.
   */
  sessionScrollDepth?: number;
  /**
   * Reach thresholds derived from `scrollMapInfo`: % of page views that
   * scrolled to at least 25 / 50 / 75 / 100 percent of the page. More
   * actionable than a single average for CRO conversations. Only set when
   * `filters.url` is provided.
   */
  scrollReachThresholds?: { reach25: number; reach50: number; reach75: number; reach100: number };
  /**
   * Friction rates are computed as `pages with at least one event / total
   * page views in matching sessions` — a per-page-view rate that aligns
   * with how the dashboard's NL parser computes the same metric. The
   * denominator (`totalSessions × pagesPerSession`) over-counts slightly
   * because matching sessions may have visited pages outside the URL
   * filter; the rate typically lands within ~10–20% of the dashboard's
   * displayed value.
   */
  deadClickRate?: number;
  rageClickRate?: number;
  jsErrorRate?: number;
  excessiveScrollRate?: number;
  quickbackRate?: number;
  topDeadClickTargets?: { selector: string; count: number }[];
  topClickedElements?: { selector: string; count: number }[];
  _warnings?: string[];
}

// Metrics whose response shape is `{ pages, sessionsWith, sessionsWithout, subTotal }`
// and which we approximate as a per-page-view rate.
const FRICTION_METRICS = new Set<MetricKeyType>([
  "deadClicks", "rageClicks", "jsErrors",
]);

const METRIC_TO_OP: Record<Exclude<MetricKeyType, "scrollDepth">, Operation> = {
  sessions: GET_SESSIONS_INFO,
  newVsReturning: GET_NEW_AND_RETURNING,
  topReferrers: GET_TOP_REFERRERS,
  topPages: GET_TOP_PAGES,
  deadClicks: GET_DEAD_CLICKS,
  rageClicks: GET_RAGE_CLICKS,
  jsErrors: GET_JS_ERRORS,
  topDeadClickTargets: GET_TOP_DEAD_CLICK_TARGETS,
  topClickedElements: GET_TOP_CLICKED_ELEMENTS,
};

/**
 * Shape a raw GraphQL response field into the public metric output.
 *
 * `ctx.totalPageViews` is required for friction-rate metrics — see the
 * formula note on `QueryMetricsOutput.deadClickRate`. Callers compute it
 * once per `queryMetrics` call as `totalSessions × pagesPerSession`.
 */
function shapeMetric(key: Exclude<MetricKeyType, "scrollDepth">, raw: unknown, ctx: { totalPageViews: number }): unknown {
  switch (key) {
    case "sessions": {
      const r = raw as { totalSessions?: number; totalBotSessions?: number };
      return { total: r.totalSessions ?? 0, bot: r.totalBotSessions ?? 0 };
    }
    case "newVsReturning": {
      const r = raw as { newUsers?: number; returningUsers?: number };
      return { new: r.newUsers ?? 0, returning: r.returningUsers ?? 0 };
    }
    case "topReferrers":
    case "topPages": {
      // Server returns `{ item, count }` shape for these.
      if (!Array.isArray(raw)) return [];
      return (raw as { item?: string; count?: number }[]).map((r) => ({
        item: r.item ?? "",
        count: r.count ?? 0,
      }));
    }
    case "topDeadClickTargets":
    case "topClickedElements": {
      // Server returns `{ selector, count }` shape for element-targeted metrics.
      if (!Array.isArray(raw)) return [];
      return (raw as { selector?: string; count?: number }[]).map((r) => ({
        selector: r.selector ?? "",
        count: r.count ?? 0,
      }));
    }
    case "deadClicks":
    case "rageClicks":
    case "jsErrors": {
      // Per-page-view approximation. `pages` from getInsightsMetrics is the
      // count of page renders with at least one event of this kind; we divide
      // by the estimated total page views in the matching sessions.
      const r = raw as { pages?: number };
      const numerator = r.pages ?? 0;
      return ctx.totalPageViews > 0 ? (numerator / ctx.totalPageViews) * 100 : 0;
    }
  }
}

/**
 * Fetch pagesPerSession for the given filter envelope. Used to compute the
 * total-page-views denominator that friction-rate approximations need.
 *
 * Uses an inline query (not from operations.ts) because GET_SCROLL_DEPTH
 * selects only `scrollDepth` to keep its response narrow. We piggy-back on
 * the same `getSessionMetrics` operation here with a different selection.
 */
async function fetchPagesPerSession(filtersStr: string, projectId: string): Promise<number> {
  const PAGES_PER_SESSION_QUERY = "query getSessionMetrics($projectId: String!, $filters: String, $isAppProject: Boolean, $includePageQualityIssuesSessions: Boolean) {\n  projectFeatures(id: $projectId) {\n    id\n    dashboard(filters: $filters, isAppProject: $isAppProject, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) {\n      pagesPerSession\n      __typename\n    }\n    __typename\n  }\n}\n";
  const response = await postGraphQL(
    "getSessionMetrics",
    PAGES_PER_SESSION_QUERY,
    { projectId, filters: filtersStr, isAppProject: false, includePageQualityIssuesSessions: false },
  );
  const dash = (response as { data?: { projectFeatures?: { dashboard?: { pagesPerSession?: number } } } })?.data?.projectFeatures?.dashboard;
  return dash?.pagesPerSession ?? 0;
}

/**
 * Fetch session-scoped scroll depth via `/api/v2 getInsightsMetrics`. This is
 * the same number the dashboard's "Scroll depth" card displays — max scroll
 * % across all pages in the session, averaged over matching sessions. Useful
 * for cross-reference with the dashboard UI; less useful for single-page
 * experiment analysis (where you want PV-scoped — see fetchScrollDepthFromHeatmap).
 */
async function fetchSessionScrollDepth(filtersStr: string, projectId: string): Promise<number> {
  const response = await postGraphQL(
    GET_SCROLL_DEPTH.operationName,
    GET_SCROLL_DEPTH.query,
    { projectId, filters: filtersStr, isAppProject: false, includePageQualityIssuesSessions: false },
  );
  const dash = (response as { data?: { projectFeatures?: { dashboard?: { scrollDepth?: number } } } })?.data?.projectFeatures?.dashboard;
  return dash?.scrollDepth ?? 0;
}

interface ScrollMapBand {
  scrollReachY: number;
  cumulativeSum: number;
  percUsers: number;
}

/**
 * Compute per-page-view scroll depth and reach thresholds from the heatmap
 * endpoint's `scrollMapInfo` distribution. Returns null when the URL filter
 * is missing (the heatmap endpoint requires a URL) or when there's no data.
 *
 * `scrollMapInfo` is a survival-function distribution: each band carries
 * `cumulativeSum` (count of PVs that reached at least `scrollReachY`).
 * Average max scroll = Σ Y_i × (cumSum_i − cumSum_{i+1}) / cumSum_0.
 *
 * For mobile landing pages this number is typically much lower than the
 * session-level value returned by the dashboard's "Scroll depth" card,
 * because session-level aggregates max scroll across all pages a session
 * touched while the page-view-scoped value only counts scroll on the page
 * matched by `filters.url`.
 *
 * Reach thresholds (`% of PVs who reached ≥ 25/50/75/100`) are more useful
 * than a single average for engagement comparisons (e.g. "did the new
 * placement get more eyes on a section below the fold?").
 */
async function fetchScrollDepthFromHeatmap(args: {
  filters: FiltersType;
  range: DateRange;
  projectId: string;
}): Promise<{
  pageViewScrollDepth: number;
  thresholds: { reach25: number; reach50: number; reach75: number; reach100: number };
} | null> {
  const url = args.filters.url?.[0]?.value;
  if (!url) return null;

  const heatmapFilter = buildHeatmapFilter({
    url,
    dateRange: args.range,
    tagKey: args.filters.tagKey,
    tagValue: args.filters.tagValue,
  });

  const response = await postGraphQL(
    GET_HEATMAP_TYPE_DATA.operationName,
    GET_HEATMAP_TYPE_DATA.query,
    {
      projectId: args.projectId,
      filter: heatmapFilter,
      version: "",
      deviceType: 0, // mobile by default — desktop scroll data is available via get-click-elements
      heatmapType: 1, // scroll
      useHashAlpha: false,
      includeIncompleteSessions: false,
      includePageQualityIssuesSessions: false,
    },
  );
  const info = (response as { data?: { projectFeatures?: { heatmapTypeInfo?: { scrollMapInfo?: ScrollMapBand[] | null } | null } } })?.data?.projectFeatures?.heatmapTypeInfo;
  if (!info || !Array.isArray(info.scrollMapInfo) || info.scrollMapInfo.length < 2) {
    return null;
  }

  const sortedByY = [...info.scrollMapInfo].sort((a, b) => a.scrollReachY - b.scrollReachY);
  const first = sortedByY[0]!;
  const total = first.cumulativeSum;
  if (total <= 0) return null;

  // Survival-function expected max scroll
  let weighted = 0;
  for (let i = 1; i < sortedByY.length; i++) {
    const drop = sortedByY[i - 1]!.cumulativeSum - sortedByY[i]!.cumulativeSum;
    weighted += sortedByY[i - 1]!.scrollReachY * drop;
  }
  const last = sortedByY[sortedByY.length - 1]!;
  weighted += last.scrollReachY * last.cumulativeSum;
  const pageViewScrollDepth = weighted / total;

  // Reach thresholds — find percUsers at first band where scrollReachY >= threshold
  const reachAt = (threshold: number): number => {
    const band = sortedByY.find((b) => b.scrollReachY >= threshold);
    return band ? band.percUsers : 0;
  };

  return {
    pageViewScrollDepth,
    thresholds: {
      reach25: reachAt(25),
      reach50: reachAt(50),
      reach75: reachAt(75),
      reach100: reachAt(100),
    },
  };
}

export async function queryMetrics(input: QueryMetricsInputType): Promise<QueryMetricsOutput> {
  const { filters = {}, metrics = ALL_METRICS, dateRange } = input;
  const range: DateRange = parseDateRange(dateRange);
  const filtersStr = buildFilterEnvelope(filters, range);
  const projectId = getProjectId();
  const warnings: string[] = [];

  // Pagination params (skip/limit/isAscending) only apply to the "top X"
  // operations. Other ops will reject or silently strip unknown variables, so
  // we send them only where the captured operation contract expects them.
  const PAGINATED_OPS = new Set<MetricKeyType>([
    "topReferrers", "topPages", "topDeadClickTargets", "topClickedElements",
  ]);

  // If any friction metric is requested, we need totalPageViews_est for the
  // denominator. Fetch pagesPerSession ONCE up front (cheap, one extra call).
  const needsTotalPV = metrics.some((m) => FRICTION_METRICS.has(m));
  let pagesPerSession = 0;
  let totalSessionsForPV = 0;
  if (needsTotalPV) {
    const sessOp = METRIC_TO_OP.sessions;
    const [pps, sessResponse] = await Promise.all([
      fetchPagesPerSession(filtersStr, projectId),
      postGraphQL(sessOp.operationName, sessOp.query, { projectId, filters: filtersStr, isAppProject: false, includePageQualityIssuesSessions: false }),
    ]);
    pagesPerSession = pps;
    const sessRaw = extract(sessResponse, sessOp.responseExtractPath) as { totalSessions?: number } | undefined;
    totalSessionsForPV = sessRaw?.totalSessions ?? 0;
  }
  const totalPageViews = totalSessionsForPV * pagesPerSession;

  // Scroll depth: fetch both PV-scoped (via heatmap, requires URL filter)
  // and session-scoped (via getInsightsMetrics, always available). Callers
  // pick based on the question — single-page experiment analysis wants
  // pageViewScrollDepth; "match the dashboard card" wants sessionScrollDepth.
  const scrollDepthRequested = metrics.includes("scrollDepth");
  const sessionScrollPromise: Promise<number> = scrollDepthRequested
    ? fetchSessionScrollDepth(filtersStr, projectId)
    : Promise.resolve(0);
  const pvScrollPromise: Promise<Awaited<ReturnType<typeof fetchScrollDepthFromHeatmap>> | null> = scrollDepthRequested
    ? fetchScrollDepthFromHeatmap({ filters, range, projectId })
    : Promise.resolve(null);

  // Everything else: standard /api/v2 fan-out.
  const apiV2Metrics = metrics.filter((m): m is Exclude<MetricKeyType, "scrollDepth"> => m !== "scrollDepth");
  const results = await Promise.allSettled(
    apiV2Metrics.map(async (m) => {
      const op = METRIC_TO_OP[m];
      const baseVars = { projectId, filters: filtersStr, isAppProject: false, includePageQualityIssuesSessions: false };
      const variables = PAGINATED_OPS.has(m)
        ? { ...baseVars, skip: 0, limit: 12, isAscending: false }
        : baseVars;
      const response = await postGraphQL(op.operationName, op.query, variables);
      const raw = extractWithLog(op.operationName, response, op.responseExtractPath);
      if (raw === undefined) {
        throw new Error(`response shape drift: operation ${op.operationName} did not return data at expected path '${op.responseExtractPath}'`);
      }
      return [m, shapeMetric(m, raw, { totalPageViews })] as const;
    }),
  );

  const [sessionScroll, pvScroll] = await Promise.all([sessionScrollPromise, pvScrollPromise]);

  const out: QueryMetricsOutput = {
    filters,
    dateRange: { start: range.start.toISOString(), end: range.end.toISOString() },
  };

  if (scrollDepthRequested) {
    out.sessionScrollDepth = sessionScroll;
    if (pvScroll) {
      out.pageViewScrollDepth = pvScroll.pageViewScrollDepth;
      out.scrollReachThresholds = pvScroll.thresholds;
    } else if (!filters.url?.length) {
      warnings.push("pageViewScrollDepth: omitted — pass `filters.url` to get page-view-scoped scroll depth from the heatmap endpoint. sessionScrollDepth (returned) is the dashboard's session-level number.");
    }
  }

  // Rename the friction metric keys on the way out so the response is
  // self-documenting (the API enum is the dashboard card name, but the field
  // is a RATE).
  results.forEach((r, idx) => {
    if (r.status === "fulfilled") {
      const [key, value] = r.value;
      const targetKey: keyof QueryMetricsOutput =
        key === "deadClicks" ? "deadClickRate" :
        key === "rageClicks" ? "rageClickRate" :
        key === "jsErrors"   ? "jsErrorRate"   :
        (key as keyof QueryMetricsOutput);
      (out as unknown as Record<string, unknown>)[targetKey] = value;
    } else {
      const metric = apiV2Metrics[idx]!;
      warnings.push(`${metric}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
    }
  });

  if (warnings.length) out._warnings = warnings;
  return out;
}

export const ListRecordingsInputShape = {
  filters: Filters.optional(),
  count: z.number().int().min(1).max(250).default(10),
  sortBy: z.enum(["newest", "oldest", "longest", "shortest", "most-clicks", "most-pages"]).default("newest"),
  dateRange: z.string().optional(),
};

export const ListRecordingsInput = z.object(ListRecordingsInputShape);

// Use `z.input` here (not `z.infer`/`z.output`) so callers may omit fields
// that have schema-level defaults — defaults are applied by `parse()` inside
// the function, not enforced on the call signature.
export type ListRecordingsInputType = z.input<typeof ListRecordingsInput>;
type ListRecordingsParsed = z.output<typeof ListRecordingsInput>;

const SORT_MAP: Record<ListRecordingsParsed["sortBy"], string> = {
  newest: "SessionStart_DESC",
  oldest: "SessionStart_ASC",
  longest: "SessionDuration_DESC",
  shortest: "SessionDuration_ASC",
  "most-clicks": "SessionClickCount_DESC",
  "most-pages": "PageCount_DESC",
};

interface RecordingRow {
  playerUrl: string;
  timestamp: string;
  totalDuration: string;
  activeDuration: string;
  pages: number;
  clickCount: number;
  country?: string;
  device?: string;
  url?: string;
}

interface ListRecordingsOutput {
  filters: FiltersType;
  dateRange: { start: string; end: string };
  count: number;
  recordings: RecordingRow[];
}

export async function listSessionRecordings(input: ListRecordingsInputType): Promise<ListRecordingsOutput> {
  const parsed = ListRecordingsInput.parse(input);
  const range = parseDateRange(parsed.dateRange);
  const filtersStr = buildFilterEnvelope(parsed.filters ?? {}, range);

  const response = await postGraphQL(
    GET_RECORDINGS.operationName,
    GET_RECORDINGS.query,
    {
      projectId: getProjectId(),
      filters: filtersStr,
      sortField: SORT_MAP[parsed.sortBy],
      limit: parsed.count,
      isAppProject: false,
      includePageQualityIssuesSessions: false,
    },
  );

  const items = extractWithLog(GET_RECORDINGS.operationName, response, GET_RECORDINGS.responseExtractPath);
  if (items !== undefined && !Array.isArray(items)) {
    throw new Error(`response shape drift: operation ${GET_RECORDINGS.operationName} returned non-array at expected path '${GET_RECORDINGS.responseExtractPath}'`);
  }
  const list: RecordingRow[] = Array.isArray(items)
    ? (items as Record<string, unknown>[]).map((r) => ({
        playerUrl: String(r.link ?? r.playerUrl ?? ""),
        timestamp: String(r.timestamp ?? ""),
        totalDuration: String(r.totalDuration ?? ""),
        activeDuration: String(r.activeDuration ?? ""),
        pages: Number(r.pagesCount ?? r.pages ?? 0),
        clickCount: Number(r.sessionClickCount ?? r.clickCount ?? 0),
        country: r.country as string | undefined,
        device: r.device as string | undefined,
        url: r.url as string | undefined,
      }))
    : [];

  return {
    filters: parsed.filters ?? {},
    dateRange: { start: range.start.toISOString(), end: range.end.toISOString() },
    count: list.length,
    recordings: list,
  };
}

export const CompareByVariantInputShape = {
  tagKey: z.string(),
  additionalFilters: Filters.omit({ tagKey: true, tagValue: true }).optional(),
  metrics: z.array(MetricKey).optional(),
  dateRange: z.string().optional(),
};

export const CompareByVariantInput = z.object(CompareByVariantInputShape);

export type CompareByVariantInputType = z.infer<typeof CompareByVariantInput>;

interface VariantRow extends QueryMetricsOutput {
  value: string;
  isControl: boolean;
  deltas?: Record<string, string>;
}

interface CompareByVariantOutput {
  tagKey: string;
  additionalFilters: FiltersType;
  dateRange: { start: string; end: string };
  variants: VariantRow[];
}

async function discoverValues(tagKey: string, dateRange?: string): Promise<string[]> {
  const match = (await fetchTagVariables(dateRange)).find((v) => v.name === tagKey);
  if (!match) {
    throw new Error(`No custom tag '${tagKey}' found with data in the window '${dateRange ?? "last 7 days"}'. Run list-custom-tags (optionally with a wider dateRange) to see available tags — a stopped experiment may have aged out of the default 7-day window.`);
  }
  // Sort: literal "control" sentinel first; then numerics ascending; then
  // lexicographic. Index 0 becomes the implicit control variant for delta
  // computation downstream.
  return match.values.slice().sort((a, b) => {
    if (a === "control") return -1;
    if (b === "control") return 1;
    const an = Number(a), bn = Number(b);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
    return a.localeCompare(b);
  });
}

/**
 * Recursively flatten a metrics object into dotted keys -> numbers. Used to
 * align matching metric paths between control and variant rows for delta
 * computation. Non-numeric leaves (arrays, strings) are dropped — deltas only
 * make sense for scalars.
 */
function flatten(obj: unknown, prefix = ""): Record<string, number> {
  if (obj === null || obj === undefined) return {};
  if (typeof obj === "number") return { [prefix.replace(/\.$/, "")]: obj };
  if (typeof obj !== "object" || Array.isArray(obj)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    Object.assign(out, flatten(v, prefix + k + "."));
  }
  return out;
}

function computeDeltas(variant: QueryMetricsOutput, control: QueryMetricsOutput): Record<string, string> {
  // Strip envelope fields (warnings/filters/dateRange) before flattening so
  // they don't pollute the delta key set.
  const flatV = flatten({ ...variant, _warnings: undefined, filters: undefined, dateRange: undefined });
  const flatC = flatten({ ...control,  _warnings: undefined, filters: undefined, dateRange: undefined });
  const out: Record<string, string> = {};
  for (const key of Object.keys(flatV)) {
    const c = flatC[key];
    const v = flatV[key];
    if (typeof c !== "number" || c === 0) continue;
    if (typeof v !== "number") continue;
    const delta = ((v - c) / c) * 100;
    out[key] = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
  }
  return out;
}

export async function compareByVariant(input: CompareByVariantInputType): Promise<CompareByVariantOutput> {
  const parsed = CompareByVariantInput.parse(input);
  const values = await discoverValues(parsed.tagKey, parsed.dateRange);
  const range = parseDateRange(parsed.dateRange);

  const variantResults: VariantRow[] = await Promise.all(
    values.map(async (value, idx): Promise<VariantRow> => {
      const merged: FiltersType = { ...(parsed.additionalFilters ?? {}), tagKey: parsed.tagKey, tagValue: value };
      const metrics = await queryMetrics({ filters: merged, metrics: parsed.metrics, dateRange: parsed.dateRange });
      return { value, isControl: idx === 0, ...metrics };
    }),
  );

  const control = variantResults[0];
  if (control) {
    for (let i = 1; i < variantResults.length; i++) {
      variantResults[i]!.deltas = computeDeltas(variantResults[i]!, control);
    }
  }

  return {
    tagKey: parsed.tagKey,
    additionalFilters: parsed.additionalFilters ?? {},
    dateRange: { start: range.start.toISOString(), end: range.end.toISOString() },
    variants: variantResults,
  };
}

// ---------------------------------------------------------------------------
// get-click-elements: per-element click breakdown from the heatmap endpoint
// ---------------------------------------------------------------------------

const ClickType = z.enum(["all", "dead", "rage", "error", "first", "last"]);
type ClickTypeT = z.infer<typeof ClickType>;

const Device = z.enum(["mobile", "desktop"]);
type DeviceT = z.infer<typeof Device>;

const CLICK_TYPE_TO_HEATMAP: Record<ClickTypeT, number> = {
  all: 0,
  dead: 3,
  rage: 4,
  error: 9,
  first: 5,
  last: 6,
};

const DEVICE_TO_INT: Record<DeviceT, number> = {
  mobile: 0,
  desktop: 1,
};

export const GetClickElementsInputShape = {
  url: z.string().url().describe("The page URL to analyze, e.g., https://example.com/landing"),
  clickType: ClickType.describe(
    "all = every click; dead = clicks that did nothing; rage = repeated frustrated clicks; " +
    "error = clicks that preceded a JS error; first = first click per session; last = last click before bailout",
  ),
  device: Device.optional().default("mobile"),
  filters: z.object({
    tagKey: z.string().optional(),
    tagValue: z.string().optional(),
  }).optional(),
  dateRange: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
};

export const GetClickElementsInput = z.object(GetClickElementsInputShape);
export type GetClickElementsInputType = z.input<typeof GetClickElementsInput>;

interface ClickElementRow {
  rank: number;
  hash: string;
  clicks: number;
  percentOfTotal: number;
  /**
   * Approximate position on the page, normalized to 0..1 against the max
   * observed coordinate across all elements in this response. Marked
   * `experimental` in the warnings — Clarity's coord scale appears to be
   * ~30000 = 100% of dimension but is not officially documented; relative
   * normalization gives stable region labels but absolute coords should
   * not be relied on.
   */
  avgX: number;
  avgY: number;
  /** Coarse 3×3 region label derived from avgX/avgY thirds. */
  region: string;
  aboveFold: boolean;
}

interface GetClickElementsOutput {
  url: string;
  clickType: ClickTypeT;
  device: DeviceT;
  dateRange: { start: string; end: string };
  filters: { tagKey?: string; tagValue?: string };
  pageViews: number;
  totalClicks: number;
  pageWidthPx: number | null;
  pageHeightPx: number | null;
  elements: ClickElementRow[];
  /** Deep link to the live Clarity heatmap with the same filters applied. */
  dashboardUrl: string;
  /** Deep link to recordings filtered to the same variant + date range. */
  recordingsUrl: string;
  warnings: string[];
}

interface RawElement {
  hash?: string;
  totalclicks?: number;
  x?: number[];
  y?: number[];
  selector?: string | null;
}

function regionLabel(avgX: number, avgY: number): string {
  const xb = avgX < 1 / 3 ? "left" : avgX < 2 / 3 ? "center" : "right";
  const yb = avgY < 1 / 3 ? "top" : avgY < 2 / 3 ? "middle" : "bottom";
  return `${yb}-${xb}`;
}

function buildDashboardUrl(args: {
  url: string;
  filters: { tagKey?: string; tagValue?: string };
  device: DeviceT;
  heatmapType: number;
  dateRange: string | undefined;
}): string {
  const projectId = getProjectId();
  const params = new URLSearchParams();
  // The dashboard's URL filter format is "2;6;<regex>" — captured live.
  params.set("URL", `2;6;^${args.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\?.*)?$`);
  if (args.filters.tagKey && args.filters.tagValue) {
    params.set("Variables", `${args.filters.tagKey}:${args.filters.tagValue}`);
  }
  params.set("date", args.dateRange ?? "Last 7 days");
  params.set("heatmapDeviceType", String(DEVICE_TO_INT[args.device]));
  params.set("heatmapType", String(args.heatmapType));
  return `https://clarity.microsoft.com/projects/view/${projectId}/heatmaps?${params.toString()}`;
}

function buildRecordingsUrl(args: {
  filters: { tagKey?: string; tagValue?: string };
  dateRange: string | undefined;
}): string {
  const projectId = getProjectId();
  const params = new URLSearchParams();
  if (args.filters.tagKey && args.filters.tagValue) {
    params.set("Variables", `${args.filters.tagKey}:${args.filters.tagValue}`);
  }
  params.set("date", args.dateRange ?? "Last 7 days");
  return `https://clarity.microsoft.com/projects/view/${projectId}/recordings?${params.toString()}`;
}

export async function getClickElements(input: GetClickElementsInputType): Promise<GetClickElementsOutput> {
  const parsed = GetClickElementsInput.parse(input);
  const range = parseDateRange(parsed.dateRange);
  const projectId = getProjectId();
  const heatmapType = CLICK_TYPE_TO_HEATMAP[parsed.clickType];
  const deviceInt = DEVICE_TO_INT[parsed.device];

  const filter = buildHeatmapFilter({
    url: parsed.url,
    dateRange: range,
    tagKey: parsed.filters?.tagKey,
    tagValue: parsed.filters?.tagValue,
  });

  const warnings: string[] = [];

  const response = await postGraphQL(
    GET_HEATMAP_TYPE_DATA.operationName,
    GET_HEATMAP_TYPE_DATA.query,
    {
      projectId,
      filter,
      version: "",
      deviceType: deviceInt,
      heatmapType,
      useHashAlpha: false,
      includeIncompleteSessions: false,
      includePageQualityIssuesSessions: false,
    },
  );
  const info = (response as { data?: { projectFeatures?: { heatmapTypeInfo?: {
    elementMapInfo?: string | Record<string, RawElement> | null;
    totalClicks?: number | null;
    pageViews?: number;
    avgFold?: number | null;
  } | null } } })?.data?.projectFeatures?.heatmapTypeInfo;

  const baseOutput = {
    url: parsed.url,
    clickType: parsed.clickType,
    device: parsed.device,
    dateRange: { start: range.start.toISOString(), end: range.end.toISOString() },
    filters: { tagKey: parsed.filters?.tagKey, tagValue: parsed.filters?.tagValue },
    dashboardUrl: buildDashboardUrl({ url: parsed.url, filters: parsed.filters ?? {}, device: parsed.device, heatmapType, dateRange: parsed.dateRange }),
    recordingsUrl: buildRecordingsUrl({ filters: parsed.filters ?? {}, dateRange: parsed.dateRange }),
  };

  if (!info) {
    // Empty data — Clarity returns null heatmapTypeInfo when there's no data
    // for the filter (e.g., zero rage clicks in window for this variant).
    warnings.push(`No ${parsed.clickType} click data found for the given filter. Open dashboardUrl to verify directly.`);
    return {
      ...baseOutput,
      pageViews: 0,
      totalClicks: 0,
      pageWidthPx: null,
      pageHeightPx: null,
      elements: [],
      warnings,
    };
  }

  // Fetch page dims in parallel with element parsing
  const payloadPromise = postGraphQL(
    "getHeatmapPayload",
    "query getHeatmapPayload($projectId: String!, $filter: String, $deviceType: Int, $useHashAlpha: Boolean, $includePageQualityIssuesSessions: Boolean, $includeIncompleteSessions: Boolean) {\n  projectFeatures(id: $projectId) {\n    id\n    heatmapPayload(serializedFilter: $filter, deviceType: $deviceType, useHashAlpha: $useHashAlpha, includePageQualityIssuesSessions: $includePageQualityIssuesSessions, includeIncompleteSessions: $includeIncompleteSessions) {\n      width\n      height\n      __typename\n    }\n    __typename\n  }\n}\n",
    { projectId, filter, deviceType: deviceInt, useHashAlpha: false, includeIncompleteSessions: false, includePageQualityIssuesSessions: false },
  ).catch(() => null);

  const elementsRaw: Record<string, RawElement> =
    typeof info.elementMapInfo === "string"
      ? (info.elementMapInfo.trim().length > 0 ? JSON.parse(info.elementMapInfo) : {})
      : (info.elementMapInfo ?? {});

  const totalClicks = info.totalClicks ?? 0;
  const pageViews = info.pageViews ?? 0;

  // Compute avg coords + global max for normalization
  const elementSummaries = Object.entries(elementsRaw)
    .map(([hash, el]) => {
      const xs = el.x ?? [];
      const ys = el.y ?? [];
      const clicks = el.totalclicks ?? xs.length;
      if (clicks === 0 || xs.length === 0 || ys.length === 0) return null;
      const xMean = xs.reduce((a, b) => a + b, 0) / xs.length;
      const yMean = ys.reduce((a, b) => a + b, 0) / ys.length;
      return { hash, clicks, xMean, yMean };
    })
    .filter((e): e is { hash: string; clicks: number; xMean: number; yMean: number } => e !== null);

  const maxX = Math.max(0, ...elementSummaries.map((e) => e.xMean));
  const maxY = Math.max(0, ...elementSummaries.map((e) => e.yMean));

  const payload = await payloadPromise;
  const dims = (payload as { data?: { projectFeatures?: { heatmapPayload?: { width?: number; height?: number } } } })?.data?.projectFeatures?.heatmapPayload;
  const pageWidthPx = dims?.width ?? null;
  const pageHeightPx = dims?.height ?? null;
  const avgFold = info.avgFold ?? null;

  const sorted = [...elementSummaries].sort((a, b) => b.clicks - a.clicks).slice(0, parsed.limit);
  const elements: ClickElementRow[] = sorted.map((e, idx) => {
    const avgX = maxX > 0 ? e.xMean / maxX : 0;
    const avgY = maxY > 0 ? e.yMean / maxY : 0;
    return {
      rank: idx + 1,
      hash: e.hash,
      clicks: e.clicks,
      percentOfTotal: totalClicks > 0 ? Number(((e.clicks / totalClicks) * 100).toFixed(1)) : 0,
      avgX: Number(avgX.toFixed(3)),
      avgY: Number(avgY.toFixed(3)),
      region: regionLabel(avgX, avgY),
      // aboveFold: avgFold and yMean appear to use compatible-but-not-identical
      // scales. Treat as best-effort. If avgFold or maxY is missing, default false.
      aboveFold: avgFold != null && maxY > 0 ? e.yMean < avgFold * (maxY / (pageHeightPx ?? maxY)) : false,
    };
  });

  warnings.push(
    "Element selectors are not exposed by Clarity's /api/v2 — only opaque hashes. Open dashboardUrl to see selectors / hover for element details.",
    "avgX, avgY, region, and aboveFold are experimental: Clarity's coordinate scale is not officially documented. Relative ordering is stable; absolute positions should not be relied on.",
  );

  return {
    ...baseOutput,
    pageViews,
    totalClicks,
    pageWidthPx,
    pageHeightPx,
    elements,
    warnings,
  };
}
