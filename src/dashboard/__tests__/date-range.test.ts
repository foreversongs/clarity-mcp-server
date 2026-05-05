import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { parseDateRange } from "../date-range.js";

describe("parseDateRange", () => {
  beforeAll(() => {
    // Pin clock to 2026-05-04T15:30:00Z (Mon May 4, 11:30 AM ET)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T15:30:00.000Z"));
  });
  afterAll(() => vi.useRealTimers());

  it("defaults to last 7 days when input is undefined", () => {
    const r = parseDateRange();
    expect(r.start.toISOString()).toBe("2026-04-27T04:00:00.000Z"); // 2026-04-27 00:00 ET = 04:00 UTC (EDT)
    expect(r.end.toISOString()).toBe("2026-05-04T15:30:00.000Z");
  });

  it('parses "today"', () => {
    const r = parseDateRange("today");
    expect(r.start.toISOString()).toBe("2026-05-04T04:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-05-04T15:30:00.000Z");
  });

  it('parses "yesterday"', () => {
    const r = parseDateRange("yesterday");
    expect(r.start.toISOString()).toBe("2026-05-03T04:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-05-04T03:59:59.999Z");
  });

  it('parses "last 30 days"', () => {
    const r = parseDateRange("last 30 days");
    expect(r.start.toISOString()).toBe("2026-04-04T04:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-05-04T15:30:00.000Z");
  });

  it('parses "YYYY-MM-DD..YYYY-MM-DD"', () => {
    const r = parseDateRange("2026-04-29..2026-05-01");
    expect(r.start.toISOString()).toBe("2026-04-29T04:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-05-02T03:59:59.999Z");
  });

  it("throws on malformed input", () => {
    expect(() => parseDateRange("nope")).toThrow(/Invalid dateRange/);
    expect(() => parseDateRange("last 100 days")).toThrow(/Invalid dateRange/);
    expect(() => parseDateRange("2026-04-29..2026")).toThrow(/Invalid dateRange/);
  });
});
