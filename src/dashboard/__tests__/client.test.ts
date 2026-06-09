import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { postGraphQL, DashboardAuthError, DashboardHttpError } from "../client.js";

describe("postGraphQL", () => {
  const originalEnv = process.env.CLARITY_DASHBOARD_COOKIE;

  beforeEach(() => {
    vi.spyOn(global, "fetch");
  });
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CLARITY_DASHBOARD_COOKIE;
    } else {
      process.env.CLARITY_DASHBOARD_COOKIE = originalEnv;
    }
    vi.restoreAllMocks();
  });

  it("throws DashboardAuthError when cookie is missing", async () => {
    delete process.env.CLARITY_DASHBOARD_COOKIE;
    await expect(postGraphQL("op", "query", {})).rejects.toThrow(DashboardAuthError);
  });

  it("posts to the dashboard URL with cookie and csrf headers and logs telemetry", async () => {
    process.env.CLARITY_DASHBOARD_COOKIE = "foo=bar; _csrf=ABC123; baz=qux";
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    (global.fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })
    );
    await postGraphQL("getSessions", "query getSessions { x }", { projectId: "p1" });
    // Telemetry line includes op, status, bytes, gql_errors
    expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/^\[clarity-mcp\] op=getSessions status=200 ms=\d+ bytes=\d+ gql_errors=0$/));
    stderr.mockRestore();

    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toBe("https://clarity.microsoft.com/api/v2");
    const init = call[1];
    expect(init.method).toBe("POST");
    expect(init.headers["Cookie"]).toBe("foo=bar; _csrf=ABC123; baz=qux");
    expect(init.headers["csrf-token"]).toBe("ABC123");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      operationName: "getSessions",
      query: "query getSessions { x }",
      variables: { projectId: "p1" },
    });
  });

  it("returns parsed body on 200 with no GraphQL errors", async () => {
    process.env.CLARITY_DASHBOARD_COOKIE = "_csrf=X";
    (global.fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })
    );
    const result = await postGraphQL("op", "q", {});
    expect(result).toEqual({ data: { ok: true } });
  });

  it("throws DashboardHttpError on non-2xx", async () => {
    process.env.CLARITY_DASHBOARD_COOKIE = "_csrf=X";
    (global.fetch as any).mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    await expect(postGraphQL("op", "q", {})).rejects.toThrow(DashboardHttpError);
  });

  it("treats 401 as auth error (cookie expired)", async () => {
    process.env.CLARITY_DASHBOARD_COOKIE = "_csrf=X";
    (global.fetch as any).mockResolvedValueOnce(new Response("", { status: 401 }));
    await expect(postGraphQL("op", "q", {})).rejects.toThrow(DashboardAuthError);
  });

  it("throws DashboardHttpError when response has GraphQL errors", async () => {
    process.env.CLARITY_DASHBOARD_COOKIE = "_csrf=X";
    (global.fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: [{ message: "Invalid filter" }] }), { status: 200 })
    );
    await expect(postGraphQL("op", "q", {})).rejects.toThrow(/Invalid filter/);
  });
});
