import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../client.js", () => ({
  postGraphQL: vi.fn(),
  logExtract: vi.fn(),
  DashboardAuthError: class DashboardAuthError extends Error {},
  DashboardHttpError: class DashboardHttpError extends Error {},
}));

const { postGraphQL } = await import("../client.js");

describe("listCustomTags", () => {
  beforeEach(async () => {
    process.env.CLARITY_PROJECT_ID = "test-project";
    vi.resetAllMocks();
    const tools = await import("../tools.js");
    tools.__resetCacheForTests();
  });

  it("returns the array of tag keys", async () => {
    (postGraphQL as any).mockResolvedValueOnce({
      data: { projectFeatures: { customTagKeys: ["test-experiment", "checkout_error_code"] } },
    });
    const { listCustomTags } = await import("../tools.js");
    const result = await listCustomTags();
    expect(result).toEqual(["test-experiment", "checkout_error_code"]);
  });

  it("caches results across calls", async () => {
    (postGraphQL as any).mockResolvedValueOnce({
      data: { projectFeatures: { customTagKeys: ["a", "b"] } },
    });
    const { listCustomTags } = await import("../tools.js");
    const a = await listCustomTags();
    const b = await listCustomTags();
    expect(a).toEqual(b);
    expect(postGraphQL).toHaveBeenCalledTimes(1);
  });
});

describe("queryMetrics", () => {
  beforeEach(async () => {
    process.env.CLARITY_PROJECT_ID = "test-project";
    vi.resetAllMocks();
    const tools = await import("../tools.js");
    tools.__resetCacheForTests();
  });

  it("calls only the operations needed for the requested metrics", async () => {
    (postGraphQL as any).mockImplementation(async (op: string) => {
      if (op === "getSessionsInfo") return { data: { projectFeatures: { dashboard: { sessions: { totalSessions: 100, totalBotSessions: 5 } } } } };
      throw new Error(`Unexpected op: ${op}`);
    });
    const { queryMetrics } = await import("../tools.js");
    const result = await queryMetrics({ metrics: ["sessions"] });
    expect(result.sessions).toEqual({ total: 100, bot: 5 });
    expect(result.newVsReturning).toBeUndefined();
    expect(postGraphQL).toHaveBeenCalledTimes(1);
  });

  it("forwards typed filters into the GraphQL filter envelope", async () => {
    (postGraphQL as any).mockResolvedValueOnce({
      data: { projectFeatures: { dashboard: { sessions: { totalSessions: 1, totalBotSessions: 0 } } } },
    });
    const { queryMetrics } = await import("../tools.js");
    await queryMetrics({
      filters: { tagKey: "test-experiment", tagValue: "1", device: ["Mobile"] },
      metrics: ["sessions"],
    });
    const passedVariables = (postGraphQL as any).mock.calls[0][2];
    const filterStr = passedVariables.filters as string;
    expect(filterStr).toContain("test-experiment=1");
    expect(filterStr).toContain('"field":"Device"');
    expect(filterStr).toContain('"value":"Mobile"');
  });

  it("collects partial results when one sub-query fails", async () => {
    (postGraphQL as any).mockImplementation(async (op: string) => {
      if (op === "getSessionsInfo") return { data: { projectFeatures: { dashboard: { sessions: { totalSessions: 1, totalBotSessions: 0 } } } } };
      if (op === "getNewAndReturning") throw new Error("kaboom");
      throw new Error(`Unexpected op: ${op}`);
    });
    const { queryMetrics } = await import("../tools.js");
    const result = await queryMetrics({ metrics: ["sessions", "newVsReturning"] });
    expect(result.sessions).toEqual({ total: 1, bot: 0 });
    expect(result.newVsReturning).toBeUndefined();
    expect(result._warnings).toContain("newVsReturning: kaboom");
  });

  it("emits a shape-drift warning when extract path misses on a 200 response", async () => {
    (postGraphQL as any).mockImplementation(async (op: string) => {
      if (op === "getSessionsInfo") {
        // Hypothetical drift: server returned 200 but renamed `sessions` to `Sessions`
        return { data: { projectFeatures: { dashboard: { Sessions: { totalSessions: 1, totalBotSessions: 0 } } } } };
      }
      throw new Error(`Unexpected op: ${op}`);
    });
    const { queryMetrics } = await import("../tools.js");
    const result = await queryMetrics({ metrics: ["sessions"] });
    expect(result.sessions).toBeUndefined();
    expect(result._warnings?.[0]).toMatch(/response shape drift.*getSessionsInfo/);
  });
});

describe("listSessionRecordings", () => {
  beforeEach(async () => {
    process.env.CLARITY_PROJECT_ID = "test-project";
    vi.resetAllMocks();
    const tools = await import("../tools.js");
    tools.__resetCacheForTests();
  });

  it("returns the recordings array with normalized fields", async () => {
    (postGraphQL as any).mockResolvedValueOnce({
      data: {
        projectFeatures: {
          recordings: {
            items: [{
              link: "https://clarity.microsoft.com/player/p1/u1/s1",
              timestamp: "2026-04-30 18:22:14",
              totalDuration: "00:04:12",
              activeDuration: "00:02:48",
              pagesCount: 5,
              sessionClickCount: 22,
              country: "United States",
              device: "Mobile",
            }],
          },
        },
      },
    });
    const { listSessionRecordings } = await import("../tools.js");
    const result = await listSessionRecordings({});
    expect(result.recordings).toHaveLength(1);
    expect(result.recordings[0]?.playerUrl).toBe("https://clarity.microsoft.com/player/p1/u1/s1");
    expect(result.recordings[0]?.pages).toBe(5);
    expect(result.recordings[0]?.clickCount).toBe(22);
  });

  it("passes count and sortBy through to the GraphQL variables", async () => {
    (postGraphQL as any).mockResolvedValueOnce({
      data: { projectFeatures: { recordings: { items: [] } } },
    });
    const { listSessionRecordings } = await import("../tools.js");
    await listSessionRecordings({ count: 50, sortBy: "longest" });
    const passedVars = (postGraphQL as any).mock.calls[0][2];
    expect(passedVars.limit).toBe(50);
    expect(passedVars.sortField).toBe("SessionDuration_DESC");
  });
});

describe("compareByVariant", () => {
  beforeEach(async () => {
    process.env.CLARITY_PROJECT_ID = "test-project";
    vi.resetAllMocks();
    const tools = await import("../tools.js");
    tools.__resetCacheForTests();
  });

  it("auto-discovers values, fans out, and computes deltas vs control", async () => {
    (postGraphQL as any).mockImplementation(async (op: string, _q: string, vars: any) => {
      if (op === "listCustomTagValues") {
        return { data: { projectFeatures: { customTagValues: ["0", "1"] } } };
      }
      // Pull tag value out of the filter envelope so we can return distinct numbers per variant.
      const v = String(vars.filters).match(/test-experiment=(\d+)/)?.[1];
      const total = v === "0" ? 4080 : 1018;
      return { data: { projectFeatures: { dashboard: { sessions: { totalSessions: total, totalBotSessions: 0 } } } } };
    });
    const { compareByVariant } = await import("../tools.js");
    const result = await compareByVariant({ tagKey: "test-experiment", metrics: ["sessions"] });

    expect(result.variants).toHaveLength(2);
    expect(result.variants[0]).toMatchObject({ value: "0", isControl: true });
    expect(result.variants[0]?.sessions).toEqual({ total: 4080, bot: 0 });
    expect(result.variants[1]).toMatchObject({ value: "1", isControl: false });
    expect(result.variants[1]?.sessions).toEqual({ total: 1018, bot: 0 });
    expect(result.variants[1]?.deltas?.["sessions.total"]).toBe("-75.0%");
  });
});
