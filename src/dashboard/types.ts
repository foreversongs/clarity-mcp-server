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
// Note: an "engagement" metric (totalTime / activeTime) is exposed by the
// `getEngagementMetrics` operation but its /api/v2 numbers come back in an
// unknown unit that does not match the dashboard's "Active time spent" card.
// Excluded from this enum until the unit can be decoded reliably.

export type MetricKeyType = z.infer<typeof MetricKey>;

export const ALL_METRICS: MetricKeyType[] = MetricKey.options;
