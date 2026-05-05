import { z } from "zod";

const UrlFilter = z.object({
  value: z.string(),
  operator: z.enum(["contains", "startsWith", "endsWith", "equals", "matchesRegex"]).default("contains"),
});

const NumericRange = z.object({
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
});

export const Filters = z.object({
  url: z.array(UrlFilter).optional(),
  device: z.array(z.enum(["Mobile", "PC", "Tablet", "Email", "Other"])).optional(),
  browser: z.array(z.string()).optional(),
  os: z.array(z.string()).optional(),
  country: z.array(z.string()).optional(),
  state: z.array(z.string()).optional(),
  city: z.array(z.string()).optional(),
  channel: z.array(z.string()).optional(),
  source: z.array(z.string()).optional(),
  medium: z.array(z.string()).optional(),
  campaign: z.array(z.string()).optional(),
  smartEvents: z.array(z.string()).optional(),
  javascriptErrors: z.array(z.string()).optional(),
  scrollDepth: NumericRange.optional(),
  sessionDuration: NumericRange.optional(),
  pagesCount: NumericRange.optional(),
  tagKey: z.string().optional(),
  tagValue: z.string().optional(),
}).strict();

export type FiltersType = z.infer<typeof Filters>;

export const MetricKey = z.enum([
  "sessions",
  "newVsReturning",
  "topReferrers",
  "topPages",
  "scrollDepth",
  "deadClicks",
  "rageClicks",
  "jsErrors",
  "topDeadClickTargets",
  "topClickedElements",
]);
// Note: "engagement" was previously here but its `/api/v2` numbers come back in
// an unknown unit (returns 683 vs the dashboard's ~155s for the same window).
// Dropped from v1 until the unit decoding is confirmed. Cody's reports never
// emphasized this metric; low value to ship a misleading number.

export type MetricKeyType = z.infer<typeof MetricKey>;

export const ALL_METRICS: MetricKeyType[] = MetricKey.options;
