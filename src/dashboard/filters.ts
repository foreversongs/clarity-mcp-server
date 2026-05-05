import type { FiltersType } from "./types.js";
import type { DateRange } from "./date-range.js";

const URL_OP_MAP: Record<string, string> = {
  contains: "Contains",
  startsWith: "StartsWith",
  endsWith: "EndsWith",
  equals: "Equals",
  matchesRegex: "MatchesRegex",
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
      value: { min: dateRange.start.toISOString(), max: dateRange.end.toISOString() },
    },
  ];

  if (filters.url?.length) {
    out.push(orGroup(filters.url.map((u) => ({
      operator: URL_OP_MAP[u.operator ?? "contains"] ?? "Contains",
      field: "URL", dataType: "Other", value: u.value, invert: false,
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
