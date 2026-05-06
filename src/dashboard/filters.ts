import type { FiltersType } from "./types.js";
import { formatTimestamp, type DateRange } from "./date-range.js";

/**
 * Escape a literal URL for use inside a regex pattern. Used to build the
 * heatmap's URL filter, which is `RegexMatch`-typed in the dashboard wire.
 */
function regexEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const URL_OP_MAP: Record<string, string> = {
  contains: "Contains",
  startsWith: "StartsWith",
  endsWith: "EndsWith",
  equals: "Equals",
  matchesRegex: "RegexMatch",
};

function orGroup(filters: unknown[]): unknown {
  return { operator: "Or", filters };
}

export function buildFilterEnvelope(filters: FiltersType, dateRange: DateRange): string {
  if (filters.tagValue && !filters.tagKey) {
    throw new Error("tagKey is required when tagValue is provided");
  }

  const out: unknown[] = [
    {
      field: "minEnqueuedTimestamp",
      dataType: "Number",
      operator: "Range",
      value: { min: formatTimestamp(dateRange.start), max: formatTimestamp(dateRange.end) },
    },
  ];

  if (filters.url?.length) {
    // Dashboard wire format: field "Url", dataType "String". The backend's
    // "Equals" operator matches a normalized path; "Contains" matches the
    // full URL string (more useful for path-prefix style filtering against
    // URLs with query parameters).
    out.push(orGroup(filters.url.map((u) => ({
      operator: URL_OP_MAP[u.operator ?? "contains"] ?? "Contains",
      field: "Url", dataType: "String", value: u.value, invert: false,
    }))));
  }
  if (filters.device?.length) {
    out.push(orGroup(filters.device.map((v) => ({ operator: "Equals", field: "Device", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.browser?.length) {
    out.push(orGroup(filters.browser.map((v) => ({ operator: "Equals", field: "Browser", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.os?.length) {
    out.push(orGroup(filters.os.map((v) => ({ operator: "Equals", field: "OS", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.country?.length) {
    out.push(orGroup(filters.country.map((v) => ({ operator: "Equals", field: "Country", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.state?.length) {
    out.push(orGroup(filters.state.map((v) => ({ operator: "Equals", field: "State", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.city?.length) {
    out.push(orGroup(filters.city.map((v) => ({ operator: "Equals", field: "City", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.channel?.length) {
    out.push(orGroup(filters.channel.map((v) => ({ operator: "Equals", field: "Channel", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.source?.length) {
    out.push(orGroup(filters.source.map((v) => ({ operator: "Equals", field: "Source", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.medium?.length) {
    out.push(orGroup(filters.medium.map((v) => ({ operator: "Equals", field: "Medium", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.campaign?.length) {
    out.push(orGroup(filters.campaign.map((v) => ({ operator: "Equals", field: "Campaign", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.smartEvents?.length) {
    out.push(orGroup(filters.smartEvents.map((v) => ({ operator: "Contains", field: "SmartEvents", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.javascriptErrors?.length) {
    out.push(orGroup(filters.javascriptErrors.map((v) => ({ operator: "Contains", field: "JavascriptErrors", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.scrollDepth) {
    out.push({ field: "ScrollDepth", dataType: "Number", operator: "Range", value: filters.scrollDepth });
  }
  if (filters.sessionDuration) {
    out.push({ field: "SessionDuration", dataType: "Number", operator: "Range", value: filters.sessionDuration });
  }
  if (filters.pagesCount) {
    out.push({ field: "PagesCount", dataType: "Number", operator: "Range", value: filters.pagesCount });
  }
  if (filters.tagKey && filters.tagValue) {
    out.push(orGroup([{
      operator: "Contains", field: "Variables", dataType: "Other",
      value: `${filters.tagKey}=${filters.tagValue}`, invert: false,
    }]));
  } else if (filters.tagKey && !filters.tagValue) {
    // Tag key only — match any value
    out.push(orGroup([{
      operator: "Contains", field: "Variables", dataType: "Other",
      value: `${filters.tagKey}=`, invert: false,
    }]));
  }

  out.push({ field: "pageDuration", dataType: "Number", operator: "Greater", value: 0 });

  return JSON.stringify({ operator: "And", filters: out });
}

/**
 * Build the filter envelope for /api/v2 heatmap operations
 * (`getHeatmapTypeData`, `getHeatmapPayload`). Differs from
 * `buildFilterEnvelope` in three ways:
 *
 *  - URL filter uses `RegexMatch` (the dashboard's wire format for heatmap
 *    URL filtering) and a regex of the form `^<escaped url>(\?.*)?$`, so
 *    the URL matches with or without query parameters.
 *  - No `pageDuration > 0` clause. Heatmap data is page-event-scoped,
 *    not session-scoped, so the session-level page-duration filter is
 *    both unnecessary and (in some cases) over-restrictive.
 *  - Variant filter is wrapped in a single-child `Or` group (same as the
 *    main filter envelope, just isolated here for clarity).
 */
export function buildHeatmapFilter(args: {
  url: string;
  dateRange: DateRange;
  tagKey?: string;
  tagValue?: string;
}): string {
  if (args.tagValue && !args.tagKey) {
    throw new Error("tagKey is required when tagValue is provided");
  }

  const out: unknown[] = [
    {
      field: "minEnqueuedTimestamp",
      dataType: "Number",
      operator: "Range",
      value: { min: formatTimestamp(args.dateRange.start), max: formatTimestamp(args.dateRange.end) },
    },
  ];

  if (args.tagKey && args.tagValue) {
    out.push(orGroup([{
      operator: "Contains", field: "Variables", dataType: "Other",
      value: `${args.tagKey}=${args.tagValue}`, invert: false,
    }]));
  } else if (args.tagKey && !args.tagValue) {
    out.push(orGroup([{
      operator: "Contains", field: "Variables", dataType: "Other",
      value: `${args.tagKey}=`, invert: false,
    }]));
  }

  // Strip any query string the caller passed — the trailing `(\?.*)?$` in
  // the regex is what matches an arbitrary query suffix; if `?` is escaped
  // into the URL portion, it stops being optional and the server-side match
  // fails.
  const baseUrl = args.url.split("?")[0]!.split("#")[0]!;
  out.push({
    field: "Url",
    dataType: "String",
    operator: "RegexMatch",
    value: `^${regexEscape(baseUrl)}(\\?.*)?$`,
    invert: false,
  });

  return JSON.stringify({ operator: "And", filters: out });
}
