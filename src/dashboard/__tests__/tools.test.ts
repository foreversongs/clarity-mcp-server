import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../client.js", () => ({
  postGraphQL: vi.fn(),
  logExtract: vi.fn(),
  DashboardAuthError: class DashboardAuthError extends Error {},
  DashboardHttpError: class DashboardHttpError extends Error {},
}));

const { postGraphQL } = await import("../client.js");

const originalProjectId = process.env.CLARITY_PROJECT_ID;
function restoreProjectId() {
  if (originalProjectId === undefined) {
    delete process.env.CLARITY_PROJECT_ID;
  } else {
    process.env.CLARITY_PROJECT_ID = originalProjectId;
  }
}

describe("listCustomTags", () => {
  beforeEach(async () => {
    process.env.CLARITY_PROJECT_ID = "test-project";
    vi.resetAllMocks();
    const tools = await import("../tools.js");
    tools.__resetCacheForTests();
  });
  afterEach(restoreProjectId);

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
  afterEach(restoreProjectId);

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
  afterEach(restoreProjectId);

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
  afterEach(restoreProjectId);

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

describe("getClickElements", () => {
  beforeEach(() => {
    process.env.CLARITY_PROJECT_ID = "test-project";
    vi.resetAllMocks();
  });
  afterEach(restoreProjectId);

  it("maps clickType -> heatmapType correctly and parses the element map", async () => {
    // Mock both calls fired by getClickElements: heatmap data + payload (for dims)
    (postGraphQL as any).mockResolvedValueOnce({
      data: {
        projectFeatures: {
          heatmapTypeInfo: {
            elementMapInfo: JSON.stringify({
              "abc123": { hash: "abc123", totalclicks: 50, x: [10000, 12000, 14000], y: [5000, 6000, 7000] },
              "def456": { hash: "def456", totalclicks: 10, x: [3000, 4000], y: [25000, 26000] },
            }),
            scrollMapInfo: [],
            attentionMapInfo: [],
            totalClicks: 60,
            pageViews: 1000,
            avgFold: 6500,
          },
        },
      },
    });
    (postGraphQL as any).mockResolvedValueOnce({
      data: { projectFeatures: { heatmapPayload: { width: 440, height: 12000 } } },
    });

    const { getClickElements } = await import("../tools.js");
    const result = await getClickElements({
      url: "https://example.com/landing",
      clickType: "dead",
      filters: { tagKey: "test-experiment", tagValue: "0" },
    });

    // Verify the heatmap call sent heatmapType=3 (dead)
    const heatmapCall = (postGraphQL as any).mock.calls[0];
    expect(heatmapCall[2].heatmapType).toBe(3);
    expect(heatmapCall[2].deviceType).toBe(0); // mobile default

    expect(result.totalClicks).toBe(60);
    expect(result.pageViews).toBe(1000);
    expect(result.pageWidthPx).toBe(440);
    expect(result.pageHeightPx).toBe(12000);
    expect(result.elements).toHaveLength(2);
    expect(result.elements[0]).toMatchObject({ rank: 1, hash: "abc123", clicks: 50, percentOfTotal: 83.3 });
    expect(result.elements[1]).toMatchObject({ rank: 2, hash: "def456", clicks: 10, percentOfTotal: 16.7 });
    // Region label sanity: def456 has higher avgY than abc123, so it should be in a deeper region
    expect(result.elements[0]?.region).not.toBe(result.elements[1]?.region);
  });

  it.each([
    ["all" as const, 0],
    ["dead" as const, 3],
    ["rage" as const, 4],
    ["error" as const, 9],
    ["first" as const, 5],
    ["last" as const, 6],
  ])("clickType=%s maps to heatmapType=%i", async (clickType, expected) => {
    (postGraphQL as any).mockResolvedValueOnce({
      data: { projectFeatures: { heatmapTypeInfo: { elementMapInfo: "{}", totalClicks: 0, pageViews: 0, avgFold: null } } },
    });
    (postGraphQL as any).mockResolvedValueOnce({ data: { projectFeatures: { heatmapPayload: { width: 0, height: 0 } } } });

    const { getClickElements } = await import("../tools.js");
    await getClickElements({ url: "https://x.com/y", clickType });
    expect((postGraphQL as any).mock.calls[0][2].heatmapType).toBe(expected);
  });

  it("device='desktop' translates to deviceType=1", async () => {
    (postGraphQL as any).mockResolvedValueOnce({
      data: { projectFeatures: { heatmapTypeInfo: { elementMapInfo: "{}", totalClicks: 0, pageViews: 0 } } },
    });
    (postGraphQL as any).mockResolvedValueOnce({ data: { projectFeatures: { heatmapPayload: { width: 1440, height: 3000 } } } });

    const { getClickElements } = await import("../tools.js");
    const result = await getClickElements({ url: "https://x.com/y", clickType: "all", device: "desktop" });
    expect((postGraphQL as any).mock.calls[0][2].deviceType).toBe(1);
    expect(result.device).toBe("desktop");
  });

  it("returns empty result + warning when heatmapTypeInfo is null (sparse data)", async () => {
    (postGraphQL as any).mockResolvedValueOnce({
      data: { projectFeatures: { heatmapTypeInfo: null } },
    });
    // No payload call expected since we short-circuit, but the mock will reject on a second call.

    const { getClickElements } = await import("../tools.js");
    const result = await getClickElements({ url: "https://x.com/y", clickType: "rage" });
    expect(result.elements).toEqual([]);
    expect(result.totalClicks).toBe(0);
    expect(result.pageViews).toBe(0);
    expect(result.warnings.some((w) => w.includes("No rage click data"))).toBe(true);
  });

  it("constructs a dashboardUrl with the correct heatmapType and Variables param", async () => {
    (postGraphQL as any).mockResolvedValueOnce({
      data: { projectFeatures: { heatmapTypeInfo: { elementMapInfo: "{}", totalClicks: 0, pageViews: 0 } } },
    });
    (postGraphQL as any).mockResolvedValueOnce({ data: { projectFeatures: { heatmapPayload: { width: 440, height: 12000 } } } });

    const { getClickElements } = await import("../tools.js");
    const result = await getClickElements({
      url: "https://example.com/landing",
      clickType: "dead",
      filters: { tagKey: "test-experiment", tagValue: "0" },
    });
    expect(result.dashboardUrl).toContain("heatmapType=3");
    expect(result.dashboardUrl).toContain("Variables=test-experiment%3A0");
    expect(result.dashboardUrl).toContain("heatmaps");
    expect(result.recordingsUrl).toContain("recordings");
  });
});

describe("queryMetrics scrollDepth", () => {
  beforeEach(() => {
    process.env.CLARITY_PROJECT_ID = "test-project";
    vi.resetAllMocks();
  });
  afterEach(restoreProjectId);

  it("returns sessionScrollDepth + pageViewScrollDepth + thresholds when filters.url is provided", async () => {
    // queryMetrics fires: GET_SCROLL_DEPTH (session) + GET_HEATMAP_TYPE_DATA (PV) in parallel.
    // Order isn't guaranteed but mock ordering by call shape.
    (postGraphQL as any).mockImplementation(async (op: string, _q: string, _vars: any) => {
      if (op === "getSessionMetrics") {
        return { data: { projectFeatures: { dashboard: { scrollDepth: 28.7 } } } };
      }
      if (op === "getHeatmapTypeData") {
        return {
          data: {
            projectFeatures: {
              heatmapTypeInfo: {
                scrollMapInfo: [
                  { scrollReachY: 1, cumulativeSum: 1000, percUsers: 100 },
                  { scrollReachY: 25, cumulativeSum: 700, percUsers: 70 },
                  { scrollReachY: 50, cumulativeSum: 400, percUsers: 40 },
                  { scrollReachY: 75, cumulativeSum: 100, percUsers: 10 },
                  { scrollReachY: 100, cumulativeSum: 50, percUsers: 5 },
                ],
              },
            },
          },
        };
      }
      return { data: {} };
    });

    const { queryMetrics } = await import("../tools.js");
    const result = await queryMetrics({
      filters: { url: [{ value: "https://example.com/landing", operator: "contains" }] },
      metrics: ["scrollDepth"],
    });

    expect(result.sessionScrollDepth).toBe(28.7);
    expect(result.pageViewScrollDepth).toBeGreaterThan(0);
    expect(result.scrollReachThresholds).toEqual({
      reach25: 70,
      reach50: 40,
      reach75: 10,
      reach100: 5,
    });
  });

  it("returns only sessionScrollDepth (with warning) when no filters.url", async () => {
    (postGraphQL as any).mockResolvedValueOnce({
      data: { projectFeatures: { dashboard: { scrollDepth: 41.3 } } },
    });

    const { queryMetrics } = await import("../tools.js");
    const result = await queryMetrics({ metrics: ["scrollDepth"] });

    expect(result.sessionScrollDepth).toBe(41.3);
    expect(result.pageViewScrollDepth).toBeUndefined();
    expect(result.scrollReachThresholds).toBeUndefined();
    expect(result._warnings?.some((w) => w.includes("filters.url"))).toBe(true);
  });
});
