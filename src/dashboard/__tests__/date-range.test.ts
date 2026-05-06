import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { parseDateRange } from "../date-range.js";

describe("parseDateRange", () => {
  beforeAll(() => {
    // Pin clock to 2026-05-04T15:30:00Z (Mon May 4, 11:30 AM ET)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T15:30:00.000Z"));
  });
  afterAll(() => vi.useRealTimers());

  it("defaults to last 7 days as a rolling window from now (no day-align)", () => {
    const r = parseDateRange();
    // 7×24h before 2026-05-04T15:30:00Z = 2026-04-27T15:30:00Z. Matches the
    // dashboard's "Last 7 days" filter, which is also rolling.
    expect(r.start.toISOString()).toBe("2026-04-27T15:30:00.000Z");
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

  it('parses "last 30 days" as rolling window', () => {
    const r = parseDateRange("last 30 days");
    // 30×24h before 2026-05-04T15:30:00Z = 2026-04-04T15:30:00Z
    expect(r.start.toISOString()).toBe("2026-04-04T15:30:00.000Z");
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

  it("rejects calendar-invalid explicit dates instead of silently rolling over", () => {
    expect(() => parseDateRange("2026-02-30..2026-02-31")).toThrow(/Invalid dateRange/);
    expect(() => parseDateRange("2026-13-01..2026-13-15")).toThrow(/Invalid dateRange/);
    expect(() => parseDateRange("2026-01-32..2026-01-31")).toThrow(/Invalid dateRange/);
  });
});
