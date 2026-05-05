import { z } from "zod";
import { postGraphQL, logExtract } from "./client.js";
import {
  LIST_CUSTOM_TAG_KEYS,
  GET_SESSIONS_INFO,
  GET_ENGAGEMENT_METRICS,
  GET_NEW_AND_RETURNING,
  GET_TOP_REFERRERS,
  GET_TOP_PAGES,
  GET_DEAD_CLICKS,
  GET_RAGE_CLICKS,
  GET_SCROLL_DEPTH,
  GET_JS_ERRORS,
  GET_TOP_DEAD_CLICK_TARGETS,
  GET_TOP_CLICKED_ELEMENTS,
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

interface QueryMetricsOutput {
  filters?: FiltersType;
  dateRange: { start: string; end: string };
  sessions?: { total: number; bot: number };
  engagement?: { totalTime: number; activeTime: number };
  newVsReturning?: { new: number; returning: number };
  topReferrers?: { item: string; count: number }[];
  topPages?: { item: string; count: number }[];
  scrollDepth?: number;
  deadClickRate?: number;
  rageClickRate?: number;
  jsErrorRate?: number;
  topDeadClickTargets?: { selector: string; count: number }[];
  topClickedElements?: { selector: string; count: number }[];
  _warnings?: string[];
}

const METRIC_TO_OP: Record<MetricKeyType, Operation> = {
  sessions: GET_SESSIONS_INFO,
  engagement: GET_ENGAGEMENT_METRICS,
  newVsReturning: GET_NEW_AND_RETURNING,
  topReferrers: GET_TOP_REFERRERS,
  topPages: GET_TOP_PAGES,
  scrollDepth: GET_SCROLL_DEPTH,
  deadClicks: GET_DEAD_CLICKS,
  rageClicks: GET_RAGE_CLICKS,
  jsErrors: GET_JS_ERRORS,
  topDeadClickTargets: GET_TOP_DEAD_CLICK_TARGETS,
  topClickedElements: GET_TOP_CLICKED_ELEMENTS,
};

function shapeMetric(key: MetricKeyType, raw: unknown): unknown {
  switch (key) {
    case "sessions": {
      const r = raw as { totalSessions?: number; totalBotSessions?: number };
      return { total: r.totalSessions ?? 0, bot: r.totalBotSessions ?? 0 };
    }
    case "engagement": {
      const r = raw as { totalTime?: number; activeTime?: number };
      return { totalTime: r.totalTime ?? 0, activeTime: r.activeTime ?? 0 };
    }
    case "newVsReturning": {
      const r = raw as { newUsers?: number; returningUsers?: number };
      return { new: r.newUsers ?? 0, returning: r.returningUsers ?? 0 };
    }
    case "topReferrers":
    case "topPages":
    case "topDeadClickTargets":
    case "topClickedElements":
      // These are arrays of `{item|selector, count}` — pass through but normalize key to `item`.
      if (!Array.isArray(raw)) return [];
      return (raw as { item?: string; selector?: string; count?: number }[]).map((r) => ({
        item: r.item ?? r.selector ?? "",
        selector: r.selector ?? r.item ?? "",
        count: r.count ?? 0,
      }));
    case "scrollDepth": {
      const r = raw as { value?: number };
      return r.value ?? 0;
    }
    case "deadClicks":
    case "rageClicks":
    case "jsErrors": {
      const r = raw as { rate?: number };
      return r.rate ?? 0;
    }
  }
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

  const results = await Promise.allSettled(
    metrics.map(async (m) => {
      const op = METRIC_TO_OP[m];
      const baseVars = { projectId, filters: filtersStr, isAppProject: false, includePageQualityIssuesSessions: false };
      const variables = PAGINATED_OPS.has(m)
        ? { ...baseVars, skip: 0, limit: 12, isAscending: false }
        : baseVars;
      const response = await postGraphQL(op.operationName, op.query, variables);
      const raw = extractWithLog(op.operationName, response, op.responseExtractPath);
      // Self-check: if the extract path missed (response shape drifted),
      // emit a structured warning the caller surfaces, instead of silently
      // returning a zero-defaulted metric.
      if (raw === undefined) {
        throw new Error(`response shape drift: operation ${op.operationName} did not return data at expected path '${op.responseExtractPath}'`);
      }
      return [m, shapeMetric(m, raw)] as const;
    }),
  );

  const out: QueryMetricsOutput = {
    filters,
    dateRange: { start: range.start.toISOString(), end: range.end.toISOString() },
  };

  // The MetricKey enum names mirror the dashboard cards ("deadClicks",
  // "rageClicks", "jsErrors"), but the natural output field for each is a
  // RATE (percentage), not a count. Rename on the way out so the response
  // is self-documenting.
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
      const metric = metrics[idx]!;
      warnings.push(`${metric}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
    }
  });

  if (warnings.length) out._warnings = warnings;
  return out;
}
