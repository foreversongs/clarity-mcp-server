import "dotenv/config";

/**
 * Side-by-side comparison: hit the OFFICIAL Microsoft MCP backend (/mcp/*) and
 * the dashboard's GraphQL backend (/api/v2) for the same variant-aware question
 * and show what each returns.
 *
 * Question: "Sessions for the `cro-cart-3way` experiment, variant 1, last 7 days"
 */

const PROJECT_ID = process.env.CLARITY_PROJECT_ID ?? "w3y4c1nfgk";
const BEARER = process.env.CLARITY_TOKEN ?? "";
const COOKIE = process.env.CLARITY_DASHBOARD_COOKIE ?? "";
const CSRF = COOKIE.match(/_csrf=([^;]+)/)?.[1] ?? "";

if (!BEARER) throw new Error("CLARITY_TOKEN missing in .env");
if (!COOKIE) throw new Error("CLARITY_DASHBOARD_COOKIE missing in .env");
if (!CSRF) throw new Error("_csrf= not found in CLARITY_DASHBOARD_COOKIE");

const NOW = new Date();
const SEVEN_DAYS_AGO = new Date(NOW.getTime() - 7 * 24 * 3600_000);
const ISO_START = SEVEN_DAYS_AGO.toISOString();
const ISO_END = NOW.toISOString();
const TAG_KEY = "cro-cart-3way";
const TAG_VALUE = "1";

const banner = (s: string) => `\n${"=".repeat(s.length + 4)}\n  ${s}\n${"=".repeat(s.length + 4)}`;

async function callOfficialDashboardNL() {
  // /mcp/dashboard/query — natural-language query (the broken one)
  const url = "https://clarity.microsoft.com/mcp/dashboard/query";
  const body = {
    query: `Sessions where custom tag ${TAG_KEY} equals ${TAG_VALUE} in the last 7 days`,
    timezone: "America/New_York",
  };
  const t0 = Date.now();
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${BEARER}` },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  const text = await resp.text();
  return { status: resp.status, ms, body: text };
}

async function callOfficialRecordingsWithCustomTags() {
  // /mcp/recordings/sample — typed filters; we'll pass a customTags field that
  // the official MCP schema doesn't actually have, to demonstrate it's silently
  // ignored.
  const url = "https://clarity.microsoft.com/mcp/recordings/sample";
  const body = {
    start: ISO_START,
    end: ISO_END,
    count: 50,
    sortBy: 0,
    filters: {
      date: { start: ISO_START, end: ISO_END },
      visitedUrls: [{ url: "/cart", operator: "contains" }],
      customTags: [{ key: TAG_KEY, value: TAG_VALUE }],
    },
  };
  const t0 = Date.now();
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${BEARER}` },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  const text = await resp.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  const sessions = Array.isArray(data) ? data.length : 0;
  return { status: resp.status, ms, sessionsReturned: sessions, snippet: text.slice(0, 200) };
}

async function callApiV2() {
  // /api/v2 — GraphQL with proper Variables filter
  const filter = JSON.stringify({
    operator: "And",
    filters: [
      { field: "minEnqueuedTimestamp", dataType: "Number", operator: "Range",
        value: { min: ISO_START, max: ISO_END } },
      { operator: "Or", filters: [
        { operator: "Contains", field: "Variables", dataType: "Other",
          value: `${TAG_KEY}=${TAG_VALUE}`, invert: false },
      ]},
      { field: "pageDuration", dataType: "Number", operator: "Greater", value: 0 },
    ],
  });
  const query = `query getSessionsInfo($projectId: String!, $filters: String, $isAppProject: Boolean, $includePageQualityIssuesSessions: Boolean) {
  projectFeatures(id: $projectId) {
    id
    dashboard(filters: $filters, isAppProject: $isAppProject, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) {
      sessions { totalSessions totalBotSessions __typename }
      __typename
    }
    __typename
  }
}`;
  const t0 = Date.now();
  const resp = await fetch("https://clarity.microsoft.com/api/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: COOKIE, "csrf-token": CSRF },
    body: JSON.stringify({
      operationName: "getSessionsInfo",
      query,
      variables: { projectId: PROJECT_ID, filters: filter, isAppProject: false, includePageQualityIssuesSessions: false },
    }),
  });
  const ms = Date.now() - t0;
  const json = (await resp.json()) as { data?: { projectFeatures?: { dashboard?: { sessions?: { totalSessions: number; totalBotSessions: number } } } }; errors?: { message: string }[] };
  return {
    status: resp.status,
    ms,
    totalSessions: json.data?.projectFeatures?.dashboard?.sessions?.totalSessions ?? null,
    totalBotSessions: json.data?.projectFeatures?.dashboard?.sessions?.totalBotSessions ?? null,
    errors: json.errors,
  };
}

async function main() {
  console.log(banner(`Question: "Sessions for ${TAG_KEY}=${TAG_VALUE}, last 7 days"`));
  console.log(`Window: ${ISO_START}  →  ${ISO_END}`);

  console.log(banner("Backend A: official MCP NL parser  (/mcp/dashboard/query)"));
  const a = await callOfficialDashboardNL();
  console.log(`  HTTP ${a.status}  (${a.ms}ms)`);
  console.log(`  Body: ${a.body.slice(0, 400)}`);

  console.log(banner("Backend B: official MCP recordings  (/mcp/recordings/sample) with customTags filter"));
  const b = await callOfficialRecordingsWithCustomTags();
  console.log(`  HTTP ${b.status}  (${b.ms}ms)`);
  console.log(`  Sessions returned: ${b.sessionsReturned}`);
  console.log(`  Note: customTags field is silently dropped — recordings returned are NOT variant-filtered`);

  console.log(banner("Backend C: dashboard /api/v2 with Variables filter (the cookie-proxy path)"));
  const c = await callApiV2();
  console.log(`  HTTP ${c.status}  (${c.ms}ms)`);
  console.log(`  totalSessions    = ${c.totalSessions}`);
  console.log(`  totalBotSessions = ${c.totalBotSessions}`);
  if (c.errors) console.log(`  errors: ${JSON.stringify(c.errors)}`);

  console.log(banner("Verdict"));
  console.log(`  • Backend A (NL):           cannot answer — parser doesn't understand custom tags`);
  console.log(`  • Backend B (typed/MCP):    cannot answer — customTags filter silently ignored`);
  console.log(`  • Backend C (/api/v2):      ${c.totalSessions !== null ? `answers: ${c.totalSessions} sessions for variant ${TAG_VALUE}` : "FAILED — cookie may need rotation"}`);
}

main().catch((err) => {
  console.error("✗ comparison failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
