import { z } from "zod";
import { postGraphQL, logExtract } from "./client.js";
import { ANALYTICS_DASHBOARD_URL, CLARITY_API_TOKEN } from "../constants.js";
import {
  LIST_CUSTOM_TAG_KEYS,
  LIST_CUSTOM_TAG_VALUES,
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
import { buildFilterEnvelope } from "./filters.js";

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

let cachedTags: string[] | null = null;

export async function listCustomTags(): Promise<string[]> {
  if (cachedTags) return cachedTags;
  const response = await postGraphQL(
    LIST_CUSTOM_TAG_KEYS.operationName,
    LIST_CUSTOM_TAG_KEYS.query,
    { projectId: getProjectId() },
  );
  const tags = extractWithLog(LIST_CUSTOM_TAG_KEYS.operationName, response, LIST_CUSTOM_TAG_KEYS.responseExtractPath);
  if (!Array.isArray(tags)) {
    throw new Error(`Unexpected response shape from listCustomTagKeys (operation: ${LIST_CUSTOM_TAG_KEYS.operationName}, expected path: ${LIST_CUSTOM_TAG_KEYS.responseExtractPath}). Response head: ${JSON.stringify(response).slice(0, 200)}`);
  }
  cachedTags = tags as string[];
  return cachedTags;
}

// Test-only export so tests can reset the cache between cases.
export function __resetCacheForTests() {
  cachedTags = null;
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
  scrollDepth?: number;
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
    case "topPages":
    case "topDeadClickTargets":
    case "topClickedElements":
      // Arrays of `{item|selector, count}` — pass through but normalize key to `item`.
      if (!Array.isArray(raw)) return [];
      return (raw as { item?: string; selector?: string; count?: number }[]).map((r) => ({
        item: r.item ?? r.selector ?? "",
        selector: r.selector ?? r.item ?? "",
        count: r.count ?? 0,
      }));
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
 * Fetch scroll depth via the official MCP backend's NL parser
 * (`/mcp/dashboard/query`). This is the only path that produces the
 * per-page-view-excluding-zero formula the dashboard's Insights card uses
 * (~96% on a typical engaged page); `/api/v2`'s `scrollDepth` field is a
 * session-level number that includes zero-scroll bounces (~79%) and
 * doesn't expose enough raw data to reproduce the per-scroller average.
 *
 * Limitations:
 * - The NL parser does not accept custom-tag (variant) filters. When
 *   `filters.tagKey` is set, the caller should fall back to /api/v2 and
 *   surface a warning that the formula differs.
 * - Only URL filter values are translated. Other filter dimensions
 *   (device, country, etc.) are not passed through here; if you need
 *   them, fall back to /api/v2 instead.
 */
async function fetchScrollDepthViaNL(filters: FiltersType, range: DateRange): Promise<{ value: number; warning?: string }> {
  if (!CLARITY_API_TOKEN) {
    return { value: 0, warning: "scrollDepth: CLARITY_API_TOKEN not set; cannot route to NL parser. Configure the token to receive scroll depth." };
  }
  const dateStr = `between '${range.start.toISOString().slice(0, 10)}' and '${range.end.toISOString().slice(0, 10)}'`;
  const urlPart = filters.url?.length
    ? ` on pages where the URL contains '${filters.url[0]!.value}'`
    : "";
  const query = `Average scroll depth percentage per page view, excluding non-scrollers,${urlPart} ${dateStr}`;

  try {
    const resp = await fetch(ANALYTICS_DASHBOARD_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CLARITY_API_TOKEN}`,
      },
      body: JSON.stringify({ query, timezone: "America/New_York" }),
    });
    if (!resp.ok) {
      return { value: 0, warning: `scrollDepth: NL parser HTTP ${resp.status}` };
    }
    const json = (await resp.json()) as { data?: { AvgScrollDepthPercent?: number }[]; dataErrorType?: number };
    if (json.dataErrorType && json.dataErrorType !== 0) {
      return { value: 0, warning: `scrollDepth: NL parser dataErrorType=${json.dataErrorType}` };
    }
    const datum = json.data?.[0];
    const v = datum?.AvgScrollDepthPercent;
    if (typeof v !== "number") {
      return { value: 0, warning: "scrollDepth: NL parser returned no AvgScrollDepthPercent field" };
    }
    return { value: v };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { value: 0, warning: `scrollDepth: NL parser fetch failed (${msg})` };
  }
}

/**
 * Fetch scroll depth via /api/v2 — returns the session-level number
 * (includes 0-scroll page views). Used as fallback when NL parser can't
 * answer (variant filters present, or env without bearer token).
 */
async function fetchScrollDepthViaApiV2(filtersStr: string, projectId: string): Promise<number> {
  const response = await postGraphQL(
    GET_SCROLL_DEPTH.operationName,
    GET_SCROLL_DEPTH.query,
    { projectId, filters: filtersStr, isAppProject: false, includePageQualityIssuesSessions: false },
  );
  const dash = (response as { data?: { projectFeatures?: { dashboard?: { scrollDepth?: number } } } })?.data?.projectFeatures?.dashboard;
  return dash?.scrollDepth ?? 0;
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

  // Scroll depth has its own routing: NL parser when no variant filter, /api/v2
  // fallback when variant filter present (with a warning explaining the formula
  // differs from non-variant queries).
  const scrollDepthRequested = metrics.includes("scrollDepth");
  const scrollPromise: Promise<number> = scrollDepthRequested
    ? (filters.tagKey || filters.tagValue)
      ? fetchScrollDepthViaApiV2(filtersStr, projectId).then((v) => {
          warnings.push("scrollDepth: variant-filtered queries return a per-session number including 0-scroll page views; this differs from non-variant queries which use the dashboard's per-scroller calculation.");
          return v;
        })
      : fetchScrollDepthViaNL(filters, range).then((res) => {
          if (res.warning) warnings.push(res.warning);
          return res.value;
        })
    : Promise.resolve(0);

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

  const scrollDepthValue = await scrollPromise;

  const out: QueryMetricsOutput = {
    filters,
    dateRange: { start: range.start.toISOString(), end: range.end.toISOString() },
  };

  if (scrollDepthRequested) {
    out.scrollDepth = scrollDepthValue;
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

async function discoverValues(tagKey: string): Promise<string[]> {
  const response = await postGraphQL(
    LIST_CUSTOM_TAG_VALUES.operationName,
    LIST_CUSTOM_TAG_VALUES.query,
    { projectId: getProjectId(), tagKey },
  );
  const raw = extractWithLog(LIST_CUSTOM_TAG_VALUES.operationName, response, LIST_CUSTOM_TAG_VALUES.responseExtractPath);
  if (!Array.isArray(raw)) {
    throw new Error(`response shape drift: operation ${LIST_CUSTOM_TAG_VALUES.operationName} did not return array at expected path '${LIST_CUSTOM_TAG_VALUES.responseExtractPath}' for tagKey=${tagKey}`);
  }
  // Sort: literal "control" sentinel first; then numerics ascending; then
  // lexicographic. Index 0 becomes the implicit control variant for delta
  // computation downstream.
  return (raw as string[]).slice().sort((a, b) => {
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
  const values = await discoverValues(parsed.tagKey);
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
