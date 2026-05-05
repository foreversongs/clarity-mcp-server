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
      data: { projectFeatures: { customTagKeys: ["cro-cart-3way", "checkout_error_code"] } },
    });
    const { listCustomTags } = await import("../tools.js");
    const result = await listCustomTags();
    expect(result).toEqual(["cro-cart-3way", "checkout_error_code"]);
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
    expect(result.engagement).toBeUndefined();
    expect(postGraphQL).toHaveBeenCalledTimes(1);
  });

  it("forwards typed filters into the GraphQL filter envelope", async () => {
    (postGraphQL as any).mockResolvedValueOnce({
      data: { projectFeatures: { dashboard: { sessions: { totalSessions: 1, totalBotSessions: 0 } } } },
    });
    const { queryMetrics } = await import("../tools.js");
    await queryMetrics({
      filters: { tagKey: "cro-cart-3way", tagValue: "1", device: ["Mobile"] },
      metrics: ["sessions"],
    });
    const passedVariables = (postGraphQL as any).mock.calls[0][2];
    const filterStr = passedVariables.filters as string;
    expect(filterStr).toContain("cro-cart-3way=1");
    expect(filterStr).toContain('"field":"Device"');
    expect(filterStr).toContain('"value":"Mobile"');
  });

  it("collects partial results when one sub-query fails", async () => {
    (postGraphQL as any).mockImplementation(async (op: string) => {
      if (op === "getSessionsInfo") return { data: { projectFeatures: { dashboard: { sessions: { totalSessions: 1, totalBotSessions: 0 } } } } };
      if (op === "getEngagementMetrics") throw new Error("kaboom");
      throw new Error(`Unexpected op: ${op}`);
    });
    const { queryMetrics } = await import("../tools.js");
    const result = await queryMetrics({ metrics: ["sessions", "engagement"] });
    expect(result.sessions).toEqual({ total: 1, bot: 0 });
    expect(result.engagement).toBeUndefined();
    expect(result._warnings).toContain("engagement: kaboom");
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
