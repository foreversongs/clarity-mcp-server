import { describe, it, expect } from "vitest";
import { buildFilterEnvelope, buildHeatmapFilter } from "../filters.js";

describe("buildFilterEnvelope", () => {
  const dateRange = { start: new Date("2026-04-29T04:00:00Z"), end: new Date("2026-05-02T03:59:59.999Z") };

  it("returns just date + pageDuration when no filters", () => {
    const env = buildFilterEnvelope({}, dateRange);
    const parsed = JSON.parse(env);
    expect(parsed.operator).toBe("And");
    expect(parsed.filters).toContainEqual(expect.objectContaining({ field: "minEnqueuedTimestamp" }));
    expect(parsed.filters).toContainEqual(expect.objectContaining({ field: "pageDuration" }));
    expect(parsed.filters).toHaveLength(2);
  });

  it("translates a tagKey+tagValue into a Variables Contains filter", () => {
    const env = buildFilterEnvelope({ tagKey: "test-experiment", tagValue: "1" }, dateRange);
    const parsed = JSON.parse(env);
    const orGroup = parsed.filters.find((f: any) => f.operator === "Or");
    expect(orGroup).toBeTruthy();
    expect(orGroup.filters).toContainEqual({
      operator: "Contains",
      field: "Variables",
      dataType: "Other",
      value: "test-experiment=1",
      invert: false,
    });
  });

  it("translates a device filter into an Equals Or-group", () => {
    const env = buildFilterEnvelope({ device: ["Mobile", "PC"] }, dateRange);
    const parsed = JSON.parse(env);
    const orGroup = parsed.filters.find((f: any) => f.operator === "Or" && f.filters[0].field === "Device");
    expect(orGroup.filters).toHaveLength(2);
    expect(orGroup.filters).toContainEqual(expect.objectContaining({ value: "Mobile" }));
  });

  it("translates a url filter with custom operator", () => {
    const env = buildFilterEnvelope({ url: [{ value: "/cart", operator: "contains" }] }, dateRange);
    const parsed = JSON.parse(env);
    // Dashboard captured shape: field "Url" + dataType "String" (not "URL"/"Other")
    const orGroup = parsed.filters.find((f: any) => f.operator === "Or" && f.filters[0].field === "Url");
    expect(orGroup.filters[0]).toEqual({
      operator: "Contains",
      field: "Url",
      dataType: "String",
      value: "/cart",
      invert: false,
    });
  });

  it("translates a scrollDepth Range filter", () => {
    const env = buildFilterEnvelope({ scrollDepth: { min: 50, max: 100 } }, dateRange);
    const parsed = JSON.parse(env);
    expect(parsed.filters).toContainEqual({
      field: "ScrollDepth",
      dataType: "Number",
      operator: "Range",
      value: { min: 50, max: 100 },
    });
  });

  it("throws if tagValue is set but tagKey is missing", () => {
    expect(() => buildFilterEnvelope({ tagValue: "1" }, dateRange)).toThrow(/tagKey/);
  });

  it("emits full UTC ISO timestamps for the date range", () => {
    const env = buildFilterEnvelope({}, dateRange);
    const parsed = JSON.parse(env);
    const ts = parsed.filters.find((f: any) => f.field === "minEnqueuedTimestamp");
    expect(ts.value.min).toBe("2026-04-29T04:00:00.000Z");
    expect(ts.value.max).toBe("2026-05-02T03:59:59.999Z");
  });
});

describe("buildHeatmapFilter", () => {
  const dateRange = { start: new Date("2026-04-29T15:30:00Z"), end: new Date("2026-05-06T15:30:00Z") };

  it("emits date + RegexMatch URL with no pageDuration clause and no variant", () => {
    const f = buildHeatmapFilter({ url: "https://example.com/landing", dateRange });
    const parsed = JSON.parse(f);
    expect(parsed.operator).toBe("And");
    // Only timestamp + URL — no pageDuration, no variant.
    expect(parsed.filters).toHaveLength(2);
    expect(parsed.filters[0]).toMatchObject({ field: "minEnqueuedTimestamp" });
    expect(parsed.filters[1]).toEqual({
      field: "Url",
      dataType: "String",
      operator: "RegexMatch",
      value: "^https://example\\.com/landing(\\?.*)?$",
      invert: false,
    });
  });

  it("strips query string and fragment from the URL before building the regex", () => {
    const f = buildHeatmapFilter({ url: "https://example.com/checkout?step=1+2#hash", dateRange });
    const parsed = JSON.parse(f);
    const urlFilter = parsed.filters.find((x: any) => x.field === "Url");
    // The query string and fragment are stripped; the trailing `(\?.*)?$`
    // pattern in the regex matches arbitrary query suffixes server-side.
    // `.` is regex-escaped in the path.
    expect(urlFilter.value).toBe("^https://example\\.com/checkout(\\?.*)?$");
  });

  it("throws if tagValue is set without tagKey (matches buildFilterEnvelope)", () => {
    expect(() =>
      buildHeatmapFilter({ url: "https://example.com/landing", dateRange, tagValue: "0" }),
    ).toThrow(/tagKey/);
  });

  it("wraps a variant filter in a single-child Or group", () => {
    const f = buildHeatmapFilter({
      url: "https://example.com/landing",
      dateRange,
      tagKey: "test-experiment",
      tagValue: "0",
    });
    const parsed = JSON.parse(f);
    const orGroup = parsed.filters.find((x: any) => x.operator === "Or");
    expect(orGroup).toBeTruthy();
    expect(orGroup.filters).toEqual([
      {
        operator: "Contains",
        field: "Variables",
        dataType: "Other",
        value: "test-experiment=0",
        invert: false,
      },
    ]);
    // Order: timestamp -> variant Or -> URL
    expect(parsed.filters).toHaveLength(3);
    expect(parsed.filters[0].field).toBe("minEnqueuedTimestamp");
    expect(parsed.filters[1].operator).toBe("Or");
    expect(parsed.filters[2].field).toBe("Url");
  });

  it("supports tagKey-only (no value) for any-variant queries", () => {
    const f = buildHeatmapFilter({
      url: "https://example.com/landing",
      dateRange,
      tagKey: "test-experiment",
    });
    const parsed = JSON.parse(f);
    const orGroup = parsed.filters.find((x: any) => x.operator === "Or");
    expect(orGroup.filters[0].value).toBe("test-experiment=");
  });

  it("emits UTC ISO timestamps", () => {
    const f = buildHeatmapFilter({ url: "https://example.com/landing", dateRange });
    const parsed = JSON.parse(f);
    expect(parsed.filters[0].value).toEqual({
      min: "2026-04-29T15:30:00.000Z",
      max: "2026-05-06T15:30:00.000Z",
    });
  });
});
