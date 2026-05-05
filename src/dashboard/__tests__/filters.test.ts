import { describe, it, expect } from "vitest";
import { buildFilterEnvelope } from "../filters.js";

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
    const env = buildFilterEnvelope({ tagKey: "cro-cart-3way", tagValue: "1" }, dateRange);
    const parsed = JSON.parse(env);
    const orGroup = parsed.filters.find((f: any) => f.operator === "Or");
    expect(orGroup).toBeTruthy();
    expect(orGroup.filters).toContainEqual({
      operator: "Contains",
      field: "Variables",
      dataType: "Other",
      value: "cro-cart-3way=1",
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
    const orGroup = parsed.filters.find((f: any) => f.operator === "Or" && f.filters[0].field === "URL");
    expect(orGroup.filters[0]).toEqual({
      operator: "Contains",
      field: "URL",
      dataType: "Other",
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
});
