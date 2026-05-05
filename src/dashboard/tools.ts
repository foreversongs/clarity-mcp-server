import { z } from "zod";
import { postGraphQL, logExtract } from "./client.js";
import {
  LIST_CUSTOM_TAG_KEYS,
  LIST_CUSTOM_TAG_VALUES,
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
