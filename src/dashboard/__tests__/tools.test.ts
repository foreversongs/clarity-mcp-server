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
