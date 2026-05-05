# Clarity Variant Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 4 cookie-authenticated `/api/v2`-backed Clarity tools (`list-custom-tags`, `query-metrics`, `list-session-recordings`, `compare-by-variant`) and retain the bearer-authenticated `query-documentation-resources` tool, replacing Microsoft's two data tools while keeping their docs tool. Wire the result into Cody's runtime.

**Architecture:** TypeScript MCP server using `@modelcontextprotocol/sdk` over stdio. Four new dashboard tools POST GraphQL operations to `https://clarity.microsoft.com/api/v2` with session-cookie + CSRF auth. One tool (docs) continues to POST to `https://clarity.microsoft.com/mcp/documentation/query` with bearer JWT auth. Filter envelopes are uniform across all dashboard tools — `tagKey/tagValue` are just two more optional fields.

**Tech Stack:** TypeScript 5.9, Node 18+ (built-in `fetch`), `@modelcontextprotocol/sdk@^1.20.2`, `zod@^3.25.76`, `vitest` (new dev dep) for tests. Package renamed from `@microsoft/clarity-mcp-server` to `clarity-mcp-server-fs`.

**Spec:** `docs/superpowers/specs/2026-05-01-clarity-variant-tools-design.md`

---

## File Structure

Files we will create:

| Path | Responsibility |
|---|---|
| `src/dashboard/client.ts` | Single HTTP function: POST a GraphQL op to `/api/v2` with cookie+csrf headers, return parsed JSON or typed error |
| `src/dashboard/operations.ts` | Static map of GraphQL operation strings (operationName, query, response-extract path), captured from dashboard |
| `src/dashboard/filters.ts` | Builds the GraphQL filter envelope from a typed `Filters` object; one table-driven function |
| `src/dashboard/date-range.ts` | Parses `"last 7 days"` / `"yesterday"` / `"YYYY-MM-DD..YYYY-MM-DD"` strings to UTC ISO start/end |
| `src/dashboard/types.ts` | Shared Zod schemas: `Filters`, `DateRange`, `Metrics` enum, request/response shapes for the 4 dashboard tools |
| `src/dashboard/tools.ts` | Implementations of `list-custom-tags`, `query-metrics`, `list-session-recordings`, `compare-by-variant`. Uses `client`, `operations`, `filters`, `date-range`, `types` |
| `src/docs-tool.ts` | The retained `query-documentation-resources` — extracted from upstream `tools.ts` so we register it directly |
| `src/dashboard/__tests__/filters.test.ts` | Filter-envelope unit tests |
| `src/dashboard/__tests__/date-range.test.ts` | Date parser unit tests |
| `src/dashboard/__tests__/tools.test.ts` | Tool integration tests with `fetch` mocked |
| `scripts/probe.ts` | Smoke test: hit `getSessionsInfo` with no-op filter, assert response shape. Run via `npm run probe` |
| `scripts/capture-operations.md` | Operator-facing doc: how to re-run the Playwright capture if Microsoft changes operation names |
| `vitest.config.ts` | Vitest config (ESM-aware, points at `src/**/__tests__/*.test.ts`) |

Files we will modify:

| Path | Why |
|---|---|
| `package.json` | Rename, add `vitest`, add `probe` and `test` scripts |
| `src/constants.ts` | Add `DASHBOARD_API_URL`, `CLARITY_DASHBOARD_COOKIE`, `CLARITY_PROJECT_ID`; keep existing constants (referenced by reference-only `tools.ts`) |
| `src/instructions.ts` | Replace whole prompt to describe new 5-tool surface |
| `src/index.ts` | Replace tool registrations: register only the 4 dashboard tools + docs tool |
| `src/utils.ts` | Add `tryAsyncBearer` (renamed from `tryAsync`) for the docs tool. Keep `getConfigValue` |

Files unchanged but kept as reference (not registered):

| Path | Reason |
|---|---|
| `src/tools.ts` | Microsoft's three implementations stay as code-level reference |
| `src/types.ts` | Microsoft's Zod schemas stay as code-level reference |

---

## Reading Order for the Engineer

The engineer should read these spec sections before starting:

1. The existing fork's `src/index.ts` (top to bottom) — understand how the SDK is wired today.
2. `docs/superpowers/specs/2026-05-01-clarity-variant-tools-design.md` sections "Architecture", "Tools", "Wire-level call shape".
3. This plan in order.

---

## Task 0: Terms of Service review (blocking gate before any code)

**Files:**
- Create: `docs/superpowers/notes/2026-05-04-clarity-tos-review.md`

The spec's "Terms of Service" section calls for a 5-minute pass over Clarity's terms before reverse-engineering an undocumented endpoint. If anything looks restrictive, we revisit (file the upstream issue and live with the gap until Microsoft responds).

- [ ] **Step 1: Read the relevant terms**

Open in a browser:
- `https://clarity.microsoft.com/terms`
- Microsoft Services Agreement linked from above
- Any ToS specifically for the Data Export API at `learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api`

Spend ~5 minutes scanning for clauses about: automation, scraping, reverse engineering, undocumented APIs, rate limits, account suspension grounds.

- [ ] **Step 2: Write a short note**

Write `docs/superpowers/notes/2026-05-04-clarity-tos-review.md`:

```markdown
# Clarity ToS Review for /api/v2 cookie-proxy approach

**Date:** 2026-05-04
**Reviewer:** <your name>

## Sources reviewed
- https://clarity.microsoft.com/terms
- <other URLs you scanned>

## Findings

<one paragraph: did you find any clauses that bear on automated calls
to the dashboard with the operator's own session cookie, scraping, or
reverse engineering?>

## Decision

- [ ] PROCEED — no restrictive clauses found
- [ ] PROCEED WITH CAUTION — <list specific concerns and how we address them>
- [ ] HALT — <list blocking clauses; pivot to upstream issue only>
```

- [ ] **Step 3: Commit (or halt)**

If decision is PROCEED or PROCEED WITH CAUTION:

```bash
git add docs/superpowers/notes/2026-05-04-clarity-tos-review.md
git commit -m "docs: clarity ToS review — proceed with /api/v2 implementation"
```

If HALT, file the upstream issue (Task 17 step 7) immediately and stop. Document why in the note.

---

## Task 1: Capture GraphQL operations and filter-field map (no code yet)

This is a manual step using Playwright + the live Clarity dashboard. Output is a JSON file the next tasks consume.

**Files:**
- Create: `scripts/captures/operations.json`
- Create: `scripts/captures/filter-fields.json`
- Create: `scripts/captures/README.md`

**Prerequisites:**
- A logged-in session at `https://clarity.microsoft.com/projects/view/w3y4c1nfgk/dashboard` in Playwright-controlled Chrome.
- Cookie value from that session saved to `.env` as `CLARITY_TOKEN` (already present from earlier work).

- [ ] **Step 1: Set up captures directory**

```bash
mkdir -p scripts/captures
```

- [ ] **Step 2: Write README explaining the capture process**

Write `scripts/captures/README.md`:

```markdown
# Clarity Dashboard API Captures

Operation strings and filter-field mappings for the undocumented `clarity.microsoft.com/api/v2` GraphQL endpoint, captured by exercising the dashboard UI under Playwright observation.

## When to re-capture

Re-run the capture if:
- Tools start returning empty data or unexpected shapes
- The smoke test (`npm run probe`) fails with response-shape errors
- Microsoft visibly changes the dashboard UI

## How to capture

1. Open the dashboard in Playwright-controlled Chrome:
   `https://clarity.microsoft.com/projects/view/w3y4c1nfgk/dashboard`
2. Apply ALL filters one at a time, recording each resulting POST to `/api/v2`.
3. Apply a custom-tag filter (`cro-cart-3way` = `1`) and record the resulting fan-out.
4. Open the Recordings page with the same filter, record those operations.
5. Copy each unique operation's request body into `operations.json`.
6. Copy each unique filter envelope into `filter-fields.json`.

## Files

- `operations.json` — `{ operationName: { query, variableShape, responseExtractPath } }`
- `filter-fields.json` — `{ dimensionName: { field, dataType, operatorOptions } }`
```

- [ ] **Step 3: Capture operations from a filtered dashboard render**

Using Playwright (already installed/working from earlier in the conversation), apply `cro-cart-3way = 1` and record every `POST /api/v2` request body.

For each unique `operationName`, write an entry to `scripts/captures/operations.json`:

```json
{
  "getSessionsInfo": {
    "query": "query getSessionsInfo($projectId: String!, $filters: String, ...) { ... }",
    "variableShape": { "projectId": "string", "filters": "string", "isAppProject": "boolean", "includePageQualityIssuesSessions": "boolean" },
    "responseExtractPath": "data.projectFeatures.dashboard.sessions"
  },
  "getEngagementMetrics": {
    "query": "query getEngagementMetrics(...) { ... }",
    "variableShape": { ... },
    "responseExtractPath": "data.projectFeatures.dashboard.engagement"
  },
  "getNewAndReturning": { ... },
  "getTopMetrics": { ... },
  "getTopPages": { ... },
  "getDeadClicks": { ... },
  "getRageClicks": { ... },
  "getScrollDepth": { ... },
  "getJsErrors": { ... },
  "getTopDeadClickTargets": { ... },
  "getTopClickedElements": { ... },
  "listCustomTagKeys": { ... },
  "listCustomTagValues": { ... },
  "getRecordings": { ... }
}
```

Required ops we know we need (each MUST be present):

- `listCustomTagKeys` — populates the tag-key dropdown. Capture by clicking the empty Custom Tags dropdown.
- `listCustomTagValues` — populates the value combobox after a key is selected. Capture by selecting a key.
- `getSessionsInfo`, `getEngagementMetrics`, `getNewAndReturning` — already captured in transcripts above; re-confirm.
- `getTopMetrics` (referrers), `getTopPages`, `getDeadClicks`, `getRageClicks`, `getScrollDepth`, `getJsErrors`, `getTopDeadClickTargets`, `getTopClickedElements` — capture from the dashboard cards.
- `getRecordings` — capture from the Recordings page list query.

- [ ] **Step 4: Capture filter-field map**

For each filter the dashboard offers, apply just that filter (with all others empty), record the resulting `filters` JSON in the GraphQL request, extract the `field`/`dataType`/`operator` triple, write to `scripts/captures/filter-fields.json`:

```json
{
  "url":            { "field": "URL",                   "dataType": "Other",  "operatorOptions": ["contains","startsWith","endsWith","equals","matchesRegex"] },
  "device":         { "field": "Device",                "dataType": "Other",  "operatorOptions": ["Equals"] },
  "browser":        { "field": "Browser",               "dataType": "Other",  "operatorOptions": ["Equals"] },
  "os":             { "field": "OS",                    "dataType": "Other",  "operatorOptions": ["Equals"] },
  "country":        { "field": "Country",               "dataType": "Other",  "operatorOptions": ["Equals"] },
  "state":          { "field": "State",                 "dataType": "Other",  "operatorOptions": ["Equals"] },
  "city":           { "field": "City",                  "dataType": "Other",  "operatorOptions": ["Equals"] },
  "channel":        { "field": "Channel",               "dataType": "Other",  "operatorOptions": ["Equals"] },
  "source":         { "field": "Source",                "dataType": "Other",  "operatorOptions": ["Equals"] },
  "medium":         { "field": "Medium",                "dataType": "Other",  "operatorOptions": ["Equals"] },
  "campaign":       { "field": "Campaign",              "dataType": "Other",  "operatorOptions": ["Equals"] },
  "smartEvents":    { "field": "SmartEvents",           "dataType": "Other",  "operatorOptions": ["Contains"] },
  "javascriptErrors": { "field": "JavascriptErrors",    "dataType": "Other",  "operatorOptions": ["Contains"] },
  "scrollDepth":    { "field": "ScrollDepth",           "dataType": "Number", "operatorOptions": ["Range"] },
  "sessionDuration":{ "field": "SessionDuration",       "dataType": "Number", "operatorOptions": ["Range"] },
  "pagesCount":     { "field": "PagesCount",            "dataType": "Number", "operatorOptions": ["Range"] },
  "tag":            { "field": "Variables",             "dataType": "Other",  "operatorOptions": ["Contains"] }
}
```

The exact `field` / `dataType` strings come from the captures, not from this plan. The list above is a working hypothesis based on the dashboard naming we've seen; FIX UP entries that don't match what the captures show. The `tag` row is special — its `value` is `"<tagKey>=<tagValue>"`, not a plain string.

- [ ] **Step 5: Commit captures**

```bash
git add scripts/captures/
git commit -m "feat(captures): add GraphQL operation and filter-field captures from dashboard"
```

---

## Task 2: Set up build, test, and probe scaffolding

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/dashboard/.gitkeep`

- [ ] **Step 1: Update package.json**

Edit `package.json` to:

```json
{
  "name": "clarity-mcp-server-fs",
  "version": "3.0.0",
  "description": "ForeverSongs fork of Microsoft Clarity MCP Server with /api/v2 dashboard access and custom-tag filtering",
  "author": "Angel Rojas",
  "license": "MIT",
  "type": "module",
  "main": "dist/index.js",
  "homepage": "https://github.com/angelrojasm/clarity-mcp-server",
  "repository": {
    "type": "git",
    "url": "https://github.com/angelrojasm/clarity-mcp-server"
  },
  "keywords": [
    "clarity", "behavior-analytics-tools", "session-recordings",
    "analytics", "mcp", "model-context-protocol", "ai", "agents"
  ],
  "bin": {
    "clarity-mcp-server": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc && node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "probe": "tsc && node dist/scripts/probe.js",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.20.2",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/node": "^20.19.23",
    "typescript": "^5.9.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
```

- [ ] **Step 3: Update tsconfig.json**

Open `tsconfig.json`, find the `outDir` and `rootDir` and `include` settings, ensure they are:

```json
"outDir": "./dist",
"rootDir": "./",
"include": ["src/**/*", "scripts/**/*"]
```

Find the existing `include` if present (the upstream config doesn't include scripts) and replace it. If `rootDir` is set to `./src`, change to `./` so the compiled `scripts/probe.js` lands at `dist/scripts/probe.js`.

- [ ] **Step 4: Install deps**

Run:
```bash
npm install
```

Expected: `vitest` is added to `devDependencies` and `node_modules` updates without errors.

- [ ] **Step 5: Create dashboard directory**

```bash
touch src/dashboard/.gitkeep
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tsconfig.json src/dashboard/.gitkeep
git commit -m "build: rename package, add vitest, add scripts dir to tsconfig"
```

---

## Task 3: Add new constants and config

**Files:**
- Modify: `src/constants.ts`

- [ ] **Step 1: Read current constants.ts**

```bash
cat src/constants.ts
```

Existing content (verbatim):

```ts
import { getConfigValue } from "./utils.js";

export const CLARITY_API_TOKEN = getConfigValue('clarity_api_token');

// Endpoint URLs.
export const API_BASE_URL = `https://clarity.microsoft.com/mcp`;
export const SESSION_RECORDINGS_URL = `${API_BASE_URL}/recordings/sample`;
export const ANALYTICS_DASHBOARD_URL = `${API_BASE_URL}/dashboard/query`;
export const DOCUMENTATION_URL = `${API_BASE_URL}/documentation/query`;

// Tool names.
export const ANALYTICS_DASHBOARD_TOOL = "query-analytics-dashboard";
export const DOCUMENTATION_TOOL = "query-documentation-resources";
export const SESSION_RECORDINGS_TOOL = "list-session-recordings";

// Tool descriptions.
export const ANALYTICS_DASHBOARD_DESCRIPTION = "Fetch Microsoft Clarity analytics data...";
export const DOCUMENTATION_DESCRIPTION = "...";
export const SESSION_RECORDINGS_DESCRIPTION = "...";
```

- [ ] **Step 2: Append new constants at the bottom of constants.ts**

Append (do not delete existing content; the existing constants are still referenced by `src/tools.ts` which stays as reference code):

```ts

// === New constants for /api/v2 dashboard tools ===

export const DASHBOARD_API_URL = "https://clarity.microsoft.com/api/v2";

export const CLARITY_DASHBOARD_COOKIE = getConfigValue("clarity_dashboard_cookie");
export const CLARITY_PROJECT_ID = getConfigValue("clarity_project_id");

// New tool names (note: SESSION_RECORDINGS_TOOL is reused; same name, broader schema).
export const TAG_DISCOVERY_TOOL = "list-custom-tags";
export const QUERY_METRICS_TOOL = "query-metrics";
export const COMPARE_BY_VARIANT_TOOL = "compare-by-variant";

// New tool descriptions.
export const TAG_DISCOVERY_DESCRIPTION = "List all custom-tag keys defined for the Clarity project (e.g. experiment names from clarity('set', ...) calls). Use this when you need to discover what tags are available before filtering by variant.";

export const QUERY_METRICS_DESCRIPTION = "Fetch typed Microsoft Clarity dashboard metrics for any combination of filters including custom-tag (variant) filters. Returns sessions, engagement, top pages, dead/rage clicks, scroll depth, and JS errors. Replaces query-analytics-dashboard with a typed parameter shape and variant-aware filtering. Use this for ANY metric question — variant or not.";

export const COMPARE_BY_VARIANT_DESCRIPTION = "Compare all variants of a custom-tag (experiment). Auto-discovers values for the given tagKey, fans out metric queries per variant, and returns a table with deltas vs. control pre-computed. Use this for variant comparison reports.";

// Reuse existing SESSION_RECORDINGS_TOOL constant; override its description.
export const NEW_SESSION_RECORDINGS_DESCRIPTION = "List Microsoft Clarity session recordings matching a typed filter set (URL, device, country, custom-tag, etc.). Returns up to 250 recordings with playerUrl + metadata. Variant filtering supported via tagKey/tagValue.";
```

- [ ] **Step 3: Verify build still passes**

```bash
npm run build
```

Expected: clean build, no errors. (We haven't broken any existing imports — we only appended.)

- [ ] **Step 4: Commit**

```bash
git add src/constants.ts
git commit -m "feat(constants): add DASHBOARD_API_URL, cookie/project env, new tool names + descriptions"
```

---

## Task 4: Implement and test the date-range parser

**Files:**
- Create: `src/dashboard/date-range.ts`
- Create: `src/dashboard/__tests__/date-range.test.ts`

The parser handles these inputs and returns a `{ start: Date, end: Date }` in UTC. Default timezone for parsing is America/New_York (Cody is US-only).

| Input | Behavior |
|---|---|
| `undefined` / `""` / not provided | `last 7 days` |
| `"today"` | start = today 00:00:00 ET, end = now |
| `"yesterday"` | start = yesterday 00:00:00 ET, end = yesterday 23:59:59.999 ET |
| `"last N days"` (1 ≤ N ≤ 90) | start = N days before today 00:00:00 ET, end = now |
| `"YYYY-MM-DD..YYYY-MM-DD"` | start = first date 00:00:00 ET, end = second date 23:59:59.999 ET |
| Anything else | throw `Error("Invalid dateRange: <input>. Examples: 'last 7 days', 'yesterday', '2026-04-29..2026-05-01'")` |

- [ ] **Step 1: Write the failing tests**

Create `src/dashboard/__tests__/date-range.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- --run date-range
```

Expected: FAIL — `Cannot find module '../date-range.js'`.

- [ ] **Step 3: Implement the parser**

Create `src/dashboard/date-range.ts`:

```ts
const TZ = "America/New_York";

export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Convert "YYYY-MM-DD" + "00:00" or "23:59:59.999" in TZ to a UTC Date.
 * Uses Intl.DateTimeFormat to discover the offset for the given date in TZ.
 */
function tzWallClockToUtc(yyyy: number, mm: number, dd: number, endOfDay: boolean): Date {
  const utcGuess = Date.UTC(yyyy, mm - 1, dd, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  // Find what wall-clock time `utcGuess` represents in TZ, compute the diff, and adjust.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    fractionalSecondDigits: 3, hour12: false,
  });
  const parts = fmt.formatToParts(new Date(utcGuess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const wallUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"), get("fractionalSecond") ?? 0);
  const offsetMs = wallUtc - utcGuess;
  return new Date(utcGuess - offsetMs);
}

function startOfDayET(d: Date): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(d);
  const yyyy = Number(parts.find((p) => p.type === "year")!.value);
  const mm = Number(parts.find((p) => p.type === "month")!.value);
  const dd = Number(parts.find((p) => p.type === "day")!.value);
  return tzWallClockToUtc(yyyy, mm, dd, false);
}

function endOfDayET(d: Date): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(d);
  const yyyy = Number(parts.find((p) => p.type === "year")!.value);
  const mm = Number(parts.find((p) => p.type === "month")!.value);
  const dd = Number(parts.find((p) => p.type === "day")!.value);
  return tzWallClockToUtc(yyyy, mm, dd, true);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateRange(input?: string): DateRange {
  const now = new Date();
  if (!input || input.trim() === "" || input === "last 7 days") {
    return { start: startOfDayET(new Date(now.getTime() - 7 * 24 * 3600_000)), end: now };
  }
  if (input === "today") return { start: startOfDayET(now), end: now };
  if (input === "yesterday") {
    const y = new Date(now.getTime() - 24 * 3600_000);
    return { start: startOfDayET(y), end: endOfDayET(y) };
  }
  const lastN = input.match(/^last (\d+) days$/);
  if (lastN) {
    const n = Number(lastN[1]);
    if (n < 1 || n > 90) throw new Error(`Invalid dateRange: ${input}. Examples: 'last 7 days', 'yesterday', '2026-04-29..2026-05-01'`);
    return { start: startOfDayET(new Date(now.getTime() - n * 24 * 3600_000)), end: now };
  }
  const range = input.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (range) {
    const [, a, b] = range;
    if (!ISO_DATE.test(a) || !ISO_DATE.test(b)) {
      throw new Error(`Invalid dateRange: ${input}. Examples: 'last 7 days', 'yesterday', '2026-04-29..2026-05-01'`);
    }
    const start = tzWallClockToUtc(...a.split("-").map(Number) as [number, number, number], false);
    const end = tzWallClockToUtc(...b.split("-").map(Number) as [number, number, number], true);
    return { start, end };
  }
  throw new Error(`Invalid dateRange: ${input}. Examples: 'last 7 days', 'yesterday', '2026-04-29..2026-05-01'`);
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- --run date-range
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/date-range.ts src/dashboard/__tests__/date-range.test.ts
git commit -m "feat(date-range): parse 'last N days', 'yesterday', 'YYYY-MM-DD..YYYY-MM-DD' in ET"
```

---

## Task 5: Implement the dashboard HTTP client

**Files:**
- Create: `src/dashboard/client.ts`
- Create: `src/dashboard/__tests__/client.test.ts`

Single function: `postGraphQL(operationName, query, variables) → Promise<unknown>`. Reads `CLARITY_DASHBOARD_COOKIE`, parses CSRF from it, posts to `DASHBOARD_API_URL`. Throws typed errors for missing cookie / non-200 / GraphQL error.

- [ ] **Step 1: Write the failing tests**

Create `src/dashboard/__tests__/client.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { postGraphQL, DashboardAuthError, DashboardHttpError } from "../client.js";

describe("postGraphQL", () => {
  const originalEnv = process.env.CLARITY_DASHBOARD_COOKIE;

  beforeEach(() => {
    vi.spyOn(global, "fetch");
  });
  afterEach(() => {
    process.env.CLARITY_DASHBOARD_COOKIE = originalEnv;
    vi.restoreAllMocks();
  });

  it("throws DashboardAuthError when cookie is missing", async () => {
    delete process.env.CLARITY_DASHBOARD_COOKIE;
    await expect(postGraphQL("op", "query", {})).rejects.toThrow(DashboardAuthError);
  });

  it("posts to the dashboard URL with cookie and csrf headers", async () => {
    process.env.CLARITY_DASHBOARD_COOKIE = "foo=bar; _csrf=ABC123; baz=qux";
    (global.fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })
    );
    await postGraphQL("getSessions", "query getSessions { x }", { projectId: "p1" });

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
```

- [ ] **Step 2: Run, verify it fails**

```bash
npm test -- --run client
```

Expected: FAIL — `Cannot find module '../client.js'`.

- [ ] **Step 3: Implement the client**

Create `src/dashboard/client.ts`:

```ts
import { DASHBOARD_API_URL } from "../constants.js";

export class DashboardAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashboardAuthError";
  }
}

export class DashboardHttpError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "DashboardHttpError";
  }
}

const COOKIE_ROTATION_HINT =
  "Clarity dashboard session expired or missing. Capture a fresh cookie from a logged-in clarity.microsoft.com browser session and run 'pulumi config set --secret clarityDashboardCookie <cookie>' then 'pulumi up'.";

function readCookieFromEnv(): string {
  // Read at call time, not at import time, so tests can mutate process.env.
  const cookie = process.env.CLARITY_DASHBOARD_COOKIE;
  if (!cookie || cookie.trim() === "") {
    throw new DashboardAuthError(COOKIE_ROTATION_HINT);
  }
  return cookie;
}

function extractCsrf(cookie: string): string {
  const match = cookie.match(/(?:^|;\s*)_csrf=([^;]+)/);
  if (!match) {
    throw new DashboardAuthError("CSRF token not found in cookie. Cookie must include the '_csrf' value. " + COOKIE_ROTATION_HINT);
  }
  return match[1];
}

export async function postGraphQL(operationName: string, query: string, variables: Record<string, unknown>): Promise<unknown> {
  const cookie = readCookieFromEnv();
  const csrf = extractCsrf(cookie);

  const response = await fetch(DASHBOARD_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": cookie,
      "csrf-token": csrf,
    },
    body: JSON.stringify({ operationName, query, variables }),
  });

  if (response.status === 401 || response.status === 403) {
    throw new DashboardAuthError(`HTTP ${response.status} from dashboard API. ${COOKIE_ROTATION_HINT}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new DashboardHttpError(`Dashboard API HTTP ${response.status}: ${body.slice(0, 200)}`, response.status);
  }

  const json = (await response.json()) as { data?: unknown; errors?: { message: string }[] };
  if (json.errors && json.errors.length > 0) {
    throw new DashboardHttpError(`Dashboard GraphQL errors: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  return json;
}
```

- [ ] **Step 4: Run, verify all pass**

```bash
npm test -- --run client
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/client.ts src/dashboard/__tests__/client.test.ts
git commit -m "feat(dashboard): cookie/csrf-authenticated GraphQL client for /api/v2"
```

---

## Task 6: Implement the typed Filters schema and envelope builder

**Files:**
- Create: `src/dashboard/types.ts`
- Create: `src/dashboard/filters.ts`
- Create: `src/dashboard/__tests__/filters.test.ts`

The schema MUST match what the dashboard sends. The exact `field`/`dataType` names come from the captures in Task 1. The plan below uses placeholder values consistent with our hypothesis; replace with capture values if they differ.

- [ ] **Step 1: Write Zod schemas**

Create `src/dashboard/types.ts`:

```ts
import { z } from "zod";

const UrlFilter = z.object({
  value: z.string(),
  operator: z.enum(["contains", "startsWith", "endsWith", "equals", "matchesRegex"]).default("contains"),
});

const NumericRange = z.object({
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
});

export const Filters = z.object({
  url: z.array(UrlFilter).optional(),
  device: z.array(z.enum(["Mobile", "PC", "Tablet", "Email", "Other"])).optional(),
  browser: z.array(z.string()).optional(),
  os: z.array(z.string()).optional(),
  country: z.array(z.string()).optional(),
  state: z.array(z.string()).optional(),
  city: z.array(z.string()).optional(),
  channel: z.array(z.string()).optional(),
  source: z.array(z.string()).optional(),
  medium: z.array(z.string()).optional(),
  campaign: z.array(z.string()).optional(),
  smartEvents: z.array(z.string()).optional(),
  javascriptErrors: z.array(z.string()).optional(),
  scrollDepth: NumericRange.optional(),
  sessionDuration: NumericRange.optional(),
  pagesCount: NumericRange.optional(),
  tagKey: z.string().optional(),
  tagValue: z.string().optional(),
}).strict();

export type FiltersType = z.infer<typeof Filters>;

export const MetricKey = z.enum([
  "sessions",
  "engagement",
  "newVsReturning",
  "topReferrers",
  "topPages",
  "scrollDepth",
  "deadClicks",
  "rageClicks",
  "jsErrors",
  "topDeadClickTargets",
  "topClickedElements",
]);

export type MetricKeyType = z.infer<typeof MetricKey>;

export const ALL_METRICS: MetricKeyType[] = MetricKey.options;
```

- [ ] **Step 2: Write the failing filter-envelope tests**

Create `src/dashboard/__tests__/filters.test.ts`:

```ts
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
```

- [ ] **Step 3: Run, verify it fails**

```bash
npm test -- --run filters
```

Expected: FAIL.

- [ ] **Step 4: Implement filters.ts**

Create `src/dashboard/filters.ts`:

```ts
import type { FiltersType } from "./types.js";
import type { DateRange } from "./date-range.js";

const URL_OP_MAP: Record<string, string> = {
  contains: "Contains",
  startsWith: "StartsWith",
  endsWith: "EndsWith",
  equals: "Equals",
  matchesRegex: "MatchesRegex",
};

function orGroup(filters: unknown[]): unknown {
  return { operator: "Or", filters };
}

export function buildFilterEnvelope(filters: FiltersType, dateRange: DateRange): string {
  if (filters.tagValue && !filters.tagKey) {
    throw new Error("tagKey is required when tagValue is provided");
  }

  const out: unknown[] = [
    {
      field: "minEnqueuedTimestamp",
      dataType: "Number",
      operator: "Range",
      value: { min: dateRange.start.toISOString(), max: dateRange.end.toISOString() },
    },
  ];

  if (filters.url?.length) {
    out.push(orGroup(filters.url.map((u) => ({
      operator: URL_OP_MAP[u.operator ?? "contains"],
      field: "URL", dataType: "Other", value: u.value, invert: false,
    }))));
  }
  if (filters.device?.length) {
    out.push(orGroup(filters.device.map((v) => ({ operator: "Equals", field: "Device", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.browser?.length) {
    out.push(orGroup(filters.browser.map((v) => ({ operator: "Equals", field: "Browser", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.os?.length) {
    out.push(orGroup(filters.os.map((v) => ({ operator: "Equals", field: "OS", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.country?.length) {
    out.push(orGroup(filters.country.map((v) => ({ operator: "Equals", field: "Country", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.state?.length) {
    out.push(orGroup(filters.state.map((v) => ({ operator: "Equals", field: "State", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.city?.length) {
    out.push(orGroup(filters.city.map((v) => ({ operator: "Equals", field: "City", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.channel?.length) {
    out.push(orGroup(filters.channel.map((v) => ({ operator: "Equals", field: "Channel", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.source?.length) {
    out.push(orGroup(filters.source.map((v) => ({ operator: "Equals", field: "Source", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.medium?.length) {
    out.push(orGroup(filters.medium.map((v) => ({ operator: "Equals", field: "Medium", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.campaign?.length) {
    out.push(orGroup(filters.campaign.map((v) => ({ operator: "Equals", field: "Campaign", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.smartEvents?.length) {
    out.push(orGroup(filters.smartEvents.map((v) => ({ operator: "Contains", field: "SmartEvents", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.javascriptErrors?.length) {
    out.push(orGroup(filters.javascriptErrors.map((v) => ({ operator: "Contains", field: "JavascriptErrors", dataType: "Other", value: v, invert: false }))));
  }
  if (filters.scrollDepth) {
    out.push({ field: "ScrollDepth", dataType: "Number", operator: "Range", value: filters.scrollDepth });
  }
  if (filters.sessionDuration) {
    out.push({ field: "SessionDuration", dataType: "Number", operator: "Range", value: filters.sessionDuration });
  }
  if (filters.pagesCount) {
    out.push({ field: "PagesCount", dataType: "Number", operator: "Range", value: filters.pagesCount });
  }
  if (filters.tagKey && filters.tagValue) {
    out.push(orGroup([{
      operator: "Contains", field: "Variables", dataType: "Other",
      value: `${filters.tagKey}=${filters.tagValue}`, invert: false,
    }]));
  } else if (filters.tagKey && !filters.tagValue) {
    // Tag key only — match any value
    out.push(orGroup([{
      operator: "Contains", field: "Variables", dataType: "Other",
      value: `${filters.tagKey}=`, invert: false,
    }]));
  }

  out.push({ field: "pageDuration", dataType: "Number", operator: "Greater", value: 0 });

  return JSON.stringify({ operator: "And", filters: out });
}
```

**IMPORTANT:** if `scripts/captures/filter-fields.json` (Task 1) shows a different `field`/`dataType` for any dimension above, update this file to match the captures. The captures are the source of truth.

- [ ] **Step 5: Run, verify pass**

```bash
npm test -- --run filters
```

Expected: 6 passing.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/types.ts src/dashboard/filters.ts src/dashboard/__tests__/filters.test.ts
git commit -m "feat(dashboard): typed Filters schema + GraphQL filter envelope builder"
```

---

## Task 7: Wire up the operations registry

**Files:**
- Create: `src/dashboard/operations.ts`

This file embeds the static GraphQL strings + extract paths from `scripts/captures/operations.json` (Task 1). Loading is done as a literal const so the build doesn't need to read the JSON at runtime.

- [ ] **Step 1: Create operations.ts**

Replace the placeholder query strings below with the real ones from `scripts/captures/operations.json`. Each entry has a query, the variable shape it accepts, and a dotted path for extracting the response payload.

```ts
/**
 * Static map of GraphQL operations used against clarity.microsoft.com/api/v2.
 *
 * STRING SOURCES: All `query` values are lifted verbatim from the dashboard's
 * own network requests (captured under Playwright) and stored in
 * `scripts/captures/operations.json`. If the dashboard changes, re-capture
 * and update this file.
 */

export interface Operation<V extends Record<string, unknown> = Record<string, unknown>> {
  operationName: string;
  query: string;
  /** Dotted path into the response body for the meaningful payload. */
  responseExtractPath: string;
}

// PASTE FROM scripts/captures/operations.json AS LITERAL CONSTS:

export const GET_SESSIONS_INFO: Operation = {
  operationName: "getSessionsInfo",
  query: `query getSessionsInfo($projectId: String!, $filters: String, $isAppProject: Boolean, $includePageQualityIssuesSessions: Boolean) {
  projectFeatures(id: $projectId) {
    id
    dashboard(filters: $filters, isAppProject: $isAppProject, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) {
      sessions { totalSessions totalBotSessions __typename }
      __typename
    }
    __typename
  }
}
`,
  responseExtractPath: "data.projectFeatures.dashboard.sessions",
};

export const GET_ENGAGEMENT_METRICS: Operation = {
  operationName: "getEngagementMetrics",
  query: `query getEngagementMetrics($projectId: String!, $filters: String, $isAppProject: Boolean, $includePageQualityIssuesSessions: Boolean) {
  projectFeatures(id: $projectId) {
    id
    dashboard(filters: $filters, isAppProject: $isAppProject, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) {
      engagement { totalTime activeTime __typename }
      __typename
    }
    __typename
  }
}
`,
  responseExtractPath: "data.projectFeatures.dashboard.engagement",
};

export const GET_NEW_AND_RETURNING: Operation = {
  operationName: "getNewAndReturning",
  query: `query getNewAndReturning($projectId: String!, $filters: String, $includePageQualityIssuesSessions: Boolean) {
  projectFeatures(id: $projectId) {
    id
    dashboard(filters: $filters, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) {
      newAndReturning { returningUsers newUsers __typename }
      __typename
    }
    __typename
  }
}
`,
  responseExtractPath: "data.projectFeatures.dashboard.newAndReturning",
};

export const GET_TOP_REFERRERS: Operation = {
  operationName: "getTopMetrics",
  query: `query getTopMetrics($projectId: String!, $filters: String, $skip: Int, $isAppProject: Boolean, $limit: Int, $includePageQualityIssuesSessions: Boolean) {
  projectFeatures(id: $projectId) {
    id
    dashboard(filters: $filters, isAppProject: $isAppProject, includePageQualityIssuesSessions: $includePageQualityIssuesSessions) {
      referrers(skip: $skip, limit: $limit) { item count __typename }
      __typename
    }
    __typename
  }
}
`,
  responseExtractPath: "data.projectFeatures.dashboard.referrers",
};

// === REPLACE THE BELOW STUBS WITH REAL CAPTURES ===

export const GET_TOP_PAGES: Operation = {
  operationName: "getTopPages",
  query: `<replace with capture from scripts/captures/operations.json>`,
  responseExtractPath: "data.projectFeatures.dashboard.topPages",
};

export const GET_DEAD_CLICKS: Operation = {
  operationName: "getDeadClicks",
  query: `<replace with capture>`,
  responseExtractPath: "data.projectFeatures.dashboard.deadClicks",
};

export const GET_RAGE_CLICKS: Operation = {
  operationName: "getRageClicks",
  query: `<replace with capture>`,
  responseExtractPath: "data.projectFeatures.dashboard.rageClicks",
};

export const GET_SCROLL_DEPTH: Operation = {
  operationName: "getScrollDepth",
  query: `<replace with capture>`,
  responseExtractPath: "data.projectFeatures.dashboard.scrollDepth",
};

export const GET_JS_ERRORS: Operation = {
  operationName: "getJsErrors",
  query: `<replace with capture>`,
  responseExtractPath: "data.projectFeatures.dashboard.jsErrors",
};

export const GET_TOP_DEAD_CLICK_TARGETS: Operation = {
  operationName: "getTopDeadClickTargets",
  query: `<replace with capture>`,
  responseExtractPath: "data.projectFeatures.dashboard.topDeadClickTargets",
};

export const GET_TOP_CLICKED_ELEMENTS: Operation = {
  operationName: "getTopClickedElements",
  query: `<replace with capture>`,
  responseExtractPath: "data.projectFeatures.dashboard.topClickedElements",
};

export const LIST_CUSTOM_TAG_KEYS: Operation = {
  operationName: "listCustomTagKeys",
  query: `<replace with capture>`,
  responseExtractPath: "data.projectFeatures.customTagKeys",
};

export const LIST_CUSTOM_TAG_VALUES: Operation = {
  operationName: "listCustomTagValues",
  query: `<replace with capture>`,
  responseExtractPath: "data.projectFeatures.customTagValues",
};

export const GET_RECORDINGS: Operation = {
  operationName: "getRecordings",
  query: `<replace with capture>`,
  responseExtractPath: "data.projectFeatures.recordings.items",
};
```

**Action required:** open `scripts/captures/operations.json` from Task 1. For each `<replace with capture>` placeholder, paste the real `query` string. If the captured `responseExtractPath` differs from the placeholder, update it too.

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: clean build (no broken type imports).

- [ ] **Step 3: Commit**

```bash
git add src/dashboard/operations.ts
git commit -m "feat(dashboard): add GraphQL operations registry from dashboard captures"
```

---

## Task 8: Implement `list-custom-tags` tool

**Files:**
- Create: `src/dashboard/tools.ts` (start of this file)
- Create: `src/dashboard/__tests__/tools.test.ts` (start of this file)

This is the simplest tool — call one operation, return the array.

- [ ] **Step 1: Write the failing test**

Create `src/dashboard/__tests__/tools.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../client.js", () => ({
  postGraphQL: vi.fn(),
  DashboardAuthError: class DashboardAuthError extends Error {},
  DashboardHttpError: class DashboardHttpError extends Error {},
}));

const { postGraphQL } = await import("../client.js");

describe("listCustomTags", () => {
  beforeEach(() => {
    process.env.CLARITY_PROJECT_ID = "test-project";
    vi.resetAllMocks();
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
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- --run tools
```

Expected: FAIL — `Cannot find module '../tools.js'`.

- [ ] **Step 3: Implement listCustomTags + supporting helpers**

> Note: this task introduces shared helpers (`getProjectId`, `extract`) that Tasks 9, 10, 11 reuse. Don't refactor them away into a separate module.

Create `src/dashboard/tools.ts`:

```ts
import { CLARITY_PROJECT_ID } from "../constants.js";
import { postGraphQL } from "./client.js";
import { LIST_CUSTOM_TAG_KEYS } from "./operations.js";

function getProjectId(): string {
  const id = process.env.CLARITY_PROJECT_ID;
  if (!id || id.trim() === "") {
    throw new Error("CLARITY_PROJECT_ID env var is required. Set it to your Clarity project ID (e.g. 'w3y4c1nfgk').");
  }
  return id;
}

function extract(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

let cachedTags: string[] | null = null;

export async function listCustomTags(): Promise<string[]> {
  if (cachedTags) return cachedTags;
  const response = await postGraphQL(
    LIST_CUSTOM_TAG_KEYS.operationName,
    LIST_CUSTOM_TAG_KEYS.query,
    { projectId: getProjectId() },
  );
  const tags = extract(response, LIST_CUSTOM_TAG_KEYS.responseExtractPath);
  if (!Array.isArray(tags)) {
    throw new Error(`Unexpected response shape from listCustomTagKeys: ${JSON.stringify(response).slice(0, 200)}`);
  }
  cachedTags = tags as string[];
  return cachedTags;
}

// Test-only export so tests can reset the cache between cases.
export function __resetCacheForTests() {
  cachedTags = null;
}
```

Add `__resetCacheForTests()` calls in `beforeEach` of the test file:

Edit `src/dashboard/__tests__/tools.test.ts` and replace `beforeEach(...)` with:

```ts
  beforeEach(async () => {
    process.env.CLARITY_PROJECT_ID = "test-project";
    vi.resetAllMocks();
    const tools = await import("../tools.js");
    tools.__resetCacheForTests();
  });
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- --run tools
```

Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/tools.ts src/dashboard/__tests__/tools.test.ts
git commit -m "feat(dashboard): list-custom-tags tool with in-process caching"
```

---

## Task 9: Implement `query-metrics` tool

Builds on Task 8. Adds a `queryMetrics()` function that fans out to multiple operations in parallel using the typed `Filters` and `MetricKey[]` inputs.

**Files:**
- Modify: `src/dashboard/tools.ts`
- Modify: `src/dashboard/__tests__/tools.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/dashboard/__tests__/tools.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- --run tools
```

Expected: 3 new tests fail.

- [ ] **Step 3: Implement queryMetrics**

Append to `src/dashboard/tools.ts`:

```ts
import { z } from "zod";
import {
  Filters,
  type FiltersType,
  MetricKey,
  type MetricKeyType,
  ALL_METRICS,
} from "./types.js";
import { parseDateRange, type DateRange } from "./date-range.js";
import { buildFilterEnvelope } from "./filters.js";
import {
  GET_SESSIONS_INFO,
  GET_ENGAGEMENT_METRICS,
  GET_NEW_AND_RETURNING,
  GET_TOP_REFERRERS,
  GET_TOP_PAGES,
  GET_DEAD_CLICKS,
  GET_RAGE_CLICKS,
  GET_SCROLL_DEPTH,
  GET_JS_ERRORS,
  GET_TOP_DEAD_CLICK_TARGETS,
  GET_TOP_CLICKED_ELEMENTS,
  type Operation,
} from "./operations.js";

// Plain-object shape used by McpServer.tool() for parameter validation.
// The MCP SDK expects a record of Zod schemas, not a ZodObject. This matches
// upstream's `ListRequest`/`SearchRequest` pattern in src/types.ts.
export const QueryMetricsInputShape = {
  filters: Filters.optional(),
  metrics: z.array(MetricKey).optional(),
  dateRange: z.string().optional(),
};

// Object form used internally for `parse()` and TypeScript inference.
export const QueryMetricsInput = z.object(QueryMetricsInputShape);

export type QueryMetricsInputType = z.infer<typeof QueryMetricsInput>;

interface QueryMetricsOutput {
  filters?: FiltersType;
  dateRange: { start: string; end: string };
  sessions?: { total: number; bot: number };
  engagement?: { totalTime: number; activeTime: number };
  newVsReturning?: { new: number; returning: number };
  topReferrers?: { item: string; count: number }[];
  topPages?: { item: string; count: number }[];
  scrollDepth?: number;
  deadClickRate?: number;
  rageClickRate?: number;
  jsErrorRate?: number;
  topDeadClickTargets?: { selector: string; count: number }[];
  topClickedElements?: { selector: string; count: number }[];
  _warnings?: string[];
}

const METRIC_TO_OP: Record<MetricKeyType, Operation> = {
  sessions: GET_SESSIONS_INFO,
  engagement: GET_ENGAGEMENT_METRICS,
  newVsReturning: GET_NEW_AND_RETURNING,
  topReferrers: GET_TOP_REFERRERS,
  topPages: GET_TOP_PAGES,
  scrollDepth: GET_SCROLL_DEPTH,
  deadClicks: GET_DEAD_CLICKS,
  rageClicks: GET_RAGE_CLICKS,
  jsErrors: GET_JS_ERRORS,
  topDeadClickTargets: GET_TOP_DEAD_CLICK_TARGETS,
  topClickedElements: GET_TOP_CLICKED_ELEMENTS,
};

function shapeMetric(key: MetricKeyType, raw: unknown): unknown {
  switch (key) {
    case "sessions": {
      const r = raw as { totalSessions?: number; totalBotSessions?: number };
      return { total: r.totalSessions ?? 0, bot: r.totalBotSessions ?? 0 };
    }
    case "engagement": {
      const r = raw as { totalTime?: number; activeTime?: number };
      return { totalTime: r.totalTime ?? 0, activeTime: r.activeTime ?? 0 };
    }
    case "newVsReturning": {
      const r = raw as { newUsers?: number; returningUsers?: number };
      return { new: r.newUsers ?? 0, returning: r.returningUsers ?? 0 };
    }
    case "topReferrers":
    case "topPages":
    case "topDeadClickTargets":
    case "topClickedElements":
      // These are arrays of `{item|selector, count}` — pass through but normalize key to `item`.
      if (!Array.isArray(raw)) return [];
      return (raw as { item?: string; selector?: string; count?: number }[]).map((r) => ({
        item: r.item ?? r.selector ?? "",
        selector: r.selector ?? r.item ?? "",
        count: r.count ?? 0,
      }));
    case "scrollDepth": {
      const r = raw as { value?: number };
      return r.value ?? 0;
    }
    case "deadClicks":
    case "rageClicks":
    case "jsErrors": {
      const r = raw as { rate?: number };
      return r.rate ?? 0;
    }
  }
}

export async function queryMetrics(input: QueryMetricsInputType): Promise<QueryMetricsOutput> {
  const { filters = {}, metrics = ALL_METRICS, dateRange } = input;
  const range: DateRange = parseDateRange(dateRange);
  const filtersStr = buildFilterEnvelope(filters, range);
  const projectId = getProjectId();
  const warnings: string[] = [];

  // Pagination params (skip/limit/isAscending) only apply to the "top X"
  // operations. Other ops will reject or silently strip unknown variables, so
  // we send them only where the captured operation contract expects them.
  const PAGINATED_OPS = new Set([
    "topReferrers", "topPages", "topDeadClickTargets", "topClickedElements",
  ]);

  const results = await Promise.allSettled(
    metrics.map(async (m) => {
      const op = METRIC_TO_OP[m];
      const baseVars = { projectId, filters: filtersStr, isAppProject: false, includePageQualityIssuesSessions: false };
      const variables = PAGINATED_OPS.has(m)
        ? { ...baseVars, skip: 0, limit: 12, isAscending: false }
        : baseVars;
      const response = await postGraphQL(op.operationName, op.query, variables);
      const raw = extract(response, op.responseExtractPath);
      return [m, shapeMetric(m, raw)] as const;
    }),
  );

  const out: QueryMetricsOutput = {
    filters,
    dateRange: { start: range.start.toISOString(), end: range.end.toISOString() },
  };

  // The MetricKey enum names mirror the dashboard cards ("deadClicks",
  // "rageClicks", "jsErrors"), but the natural output field for each is a
  // RATE (percentage), not a count. Rename on the way out so the response
  // is self-documenting.
  results.forEach((r, idx) => {
    if (r.status === "fulfilled") {
      const [key, value] = r.value;
      const targetKey: keyof QueryMetricsOutput =
        key === "deadClicks" ? "deadClickRate" :
        key === "rageClicks" ? "rageClickRate" :
        key === "jsErrors"   ? "jsErrorRate"   :
        (key as keyof QueryMetricsOutput);
      (out as Record<string, unknown>)[targetKey] = value;
    } else {
      warnings.push(`${metrics[idx]}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
    }
  });

  if (warnings.length) out._warnings = warnings;
  return out;
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- --run tools
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/tools.ts src/dashboard/__tests__/tools.test.ts
git commit -m "feat(dashboard): query-metrics tool with parallel fan-out + partial-failure handling"
```

---

## Task 10: Implement `list-session-recordings` tool

Same pattern, single operation (`GET_RECORDINGS`).

**Files:**
- Modify: `src/dashboard/tools.ts`
- Modify: `src/dashboard/__tests__/tools.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/dashboard/__tests__/tools.test.ts`:

```ts
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
    expect(result.recordings[0].playerUrl).toBe("https://clarity.microsoft.com/player/p1/u1/s1");
    expect(result.recordings[0].pages).toBe(5);
    expect(result.recordings[0].clickCount).toBe(22);
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
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- --run tools
```

Expected: 2 new tests fail.

- [ ] **Step 3: Implement listSessionRecordings**

Append to `src/dashboard/tools.ts`:

```ts
import { GET_RECORDINGS } from "./operations.js";

export const ListRecordingsInputShape = {
  filters: Filters.optional(),
  count: z.number().int().min(1).max(250).default(10),
  sortBy: z.enum(["newest", "oldest", "longest", "shortest", "most-clicks", "most-pages"]).default("newest"),
  dateRange: z.string().optional(),
};

export const ListRecordingsInput = z.object(ListRecordingsInputShape);

export type ListRecordingsInputType = z.infer<typeof ListRecordingsInput>;

const SORT_MAP: Record<ListRecordingsInputType["sortBy"], string> = {
  newest: "SessionStart_DESC",
  oldest: "SessionStart_ASC",
  longest: "SessionDuration_DESC",
  shortest: "SessionDuration_ASC",
  "most-clicks": "SessionClickCount_DESC",
  "most-pages": "PageCount_DESC",
};

interface RecordingRow {
  playerUrl: string;
  timestamp: string;
  totalDuration: string;
  activeDuration: string;
  pages: number;
  clickCount: number;
  country?: string;
  device?: string;
  url?: string;
}

interface ListRecordingsOutput {
  filters: FiltersType;
  dateRange: { start: string; end: string };
  count: number;
  recordings: RecordingRow[];
}

export async function listSessionRecordings(input: ListRecordingsInputType): Promise<ListRecordingsOutput> {
  const parsed = ListRecordingsInput.parse(input);
  const range = parseDateRange(parsed.dateRange);
  const filtersStr = buildFilterEnvelope(parsed.filters ?? {}, range);

  const response = await postGraphQL(
    GET_RECORDINGS.operationName,
    GET_RECORDINGS.query,
    {
      projectId: getProjectId(),
      filters: filtersStr,
      sortField: SORT_MAP[parsed.sortBy],
      limit: parsed.count,
      isAppProject: false,
      includePageQualityIssuesSessions: false,
    },
  );

  const items = extract(response, GET_RECORDINGS.responseExtractPath);
  const list: RecordingRow[] = Array.isArray(items)
    ? (items as Record<string, unknown>[]).map((r) => ({
        playerUrl: String(r.link ?? r.playerUrl ?? ""),
        timestamp: String(r.timestamp ?? ""),
        totalDuration: String(r.totalDuration ?? ""),
        activeDuration: String(r.activeDuration ?? ""),
        pages: Number(r.pagesCount ?? r.pages ?? 0),
        clickCount: Number(r.sessionClickCount ?? r.clickCount ?? 0),
        country: r.country as string | undefined,
        device: r.device as string | undefined,
        url: r.url as string | undefined,
      }))
    : [];

  return {
    filters: parsed.filters ?? {},
    dateRange: { start: range.start.toISOString(), end: range.end.toISOString() },
    count: list.length,
    recordings: list,
  };
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- --run tools
```

Expected: 7 passing total.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/tools.ts src/dashboard/__tests__/tools.test.ts
git commit -m "feat(dashboard): list-session-recordings tool with typed filters + sortBy mapping"
```

---

## Task 11: Implement `compare-by-variant` tool

Builds on `queryMetrics`. Discovers values via `LIST_CUSTOM_TAG_VALUES`, fans out per variant, computes deltas vs control.

**Files:**
- Modify: `src/dashboard/tools.ts`
- Modify: `src/dashboard/__tests__/tools.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/dashboard/__tests__/tools.test.ts`:

```ts
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
      const v = String(vars.filters).match(/cro-cart-3way=(\d+)/)?.[1];
      const total = v === "0" ? 4080 : 1018;
      return { data: { projectFeatures: { dashboard: { sessions: { totalSessions: total, totalBotSessions: 0 } } } } };
    });
    const { compareByVariant } = await import("../tools.js");
    const result = await compareByVariant({ tagKey: "cro-cart-3way", metrics: ["sessions"] });

    expect(result.variants).toHaveLength(2);
    expect(result.variants[0]).toMatchObject({ value: "0", isControl: true });
    expect(result.variants[0].sessions).toEqual({ total: 4080, bot: 0 });
    expect(result.variants[1]).toMatchObject({ value: "1", isControl: false });
    expect(result.variants[1].sessions).toEqual({ total: 1018, bot: 0 });
    expect(result.variants[1].deltas?.["sessions.total"]).toBe("-75.0%");
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- --run tools
```

Expected: 1 new test fails.

- [ ] **Step 3: Implement compareByVariant**

Append to `src/dashboard/tools.ts`:

```ts
import { LIST_CUSTOM_TAG_VALUES } from "./operations.js";

export const CompareByVariantInputShape = {
  tagKey: z.string(),
  additionalFilters: Filters.omit({ tagKey: true, tagValue: true }).optional(),
  metrics: z.array(MetricKey).optional(),
  dateRange: z.string().optional(),
};

export const CompareByVariantInput = z.object(CompareByVariantInputShape);

export type CompareByVariantInputType = z.infer<typeof CompareByVariantInput>;

interface VariantRow extends QueryMetricsOutput {
  value: string;
  isControl: boolean;
  deltas?: Record<string, string>;
}

interface CompareByVariantOutput {
  tagKey: string;
  additionalFilters: FiltersType;
  dateRange: { start: string; end: string };
  variants: VariantRow[];
}

async function discoverValues(tagKey: string): Promise<string[]> {
  const response = await postGraphQL(
    LIST_CUSTOM_TAG_VALUES.operationName,
    LIST_CUSTOM_TAG_VALUES.query,
    { projectId: getProjectId(), tagKey },
  );
  const raw = extract(response, LIST_CUSTOM_TAG_VALUES.responseExtractPath);
  if (!Array.isArray(raw)) {
    throw new Error(`Unexpected response shape from listCustomTagValues for tagKey=${tagKey}`);
  }
  return (raw as string[]).slice().sort((a, b) => {
    if (a === "control") return -1;
    if (b === "control") return 1;
    const an = Number(a), bn = Number(b);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
    return a.localeCompare(b);
  });
}

function flatten(obj: unknown, prefix = ""): Record<string, number> {
  if (obj === null || obj === undefined) return {};
  if (typeof obj === "number") return { [prefix.replace(/\.$/, "")]: obj };
  if (typeof obj !== "object" || Array.isArray(obj)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    Object.assign(out, flatten(v, prefix + k + "."));
  }
  return out;
}

function computeDeltas(variant: QueryMetricsOutput, control: QueryMetricsOutput): Record<string, string> {
  const flatV = flatten({ ...variant, _warnings: undefined, filters: undefined, dateRange: undefined });
  const flatC = flatten({ ...control,  _warnings: undefined, filters: undefined, dateRange: undefined });
  const out: Record<string, string> = {};
  for (const key of Object.keys(flatV)) {
    const c = flatC[key];
    const v = flatV[key];
    if (typeof c !== "number" || c === 0) continue;
    const delta = ((v - c) / c) * 100;
    out[key] = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
  }
  return out;
}

export async function compareByVariant(input: CompareByVariantInputType): Promise<CompareByVariantOutput> {
  const parsed = CompareByVariantInput.parse(input);
  const values = await discoverValues(parsed.tagKey);
  const range = parseDateRange(parsed.dateRange);

  const variantResults = await Promise.all(
    values.map(async (value, idx) => {
      const merged: FiltersType = { ...(parsed.additionalFilters ?? {}), tagKey: parsed.tagKey, tagValue: value };
      const metrics = await queryMetrics({ filters: merged, metrics: parsed.metrics, dateRange: parsed.dateRange });
      return { value, isControl: idx === 0, ...metrics };
    }),
  );

  const control = variantResults[0];
  for (let i = 1; i < variantResults.length; i++) {
    variantResults[i].deltas = computeDeltas(variantResults[i], control);
  }

  return {
    tagKey: parsed.tagKey,
    additionalFilters: parsed.additionalFilters ?? {},
    dateRange: { start: range.start.toISOString(), end: range.end.toISOString() },
    variants: variantResults,
  };
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- --run tools
```

Expected: 8 passing total.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/tools.ts src/dashboard/__tests__/tools.test.ts
git commit -m "feat(dashboard): compare-by-variant tool with auto-discovery + control deltas"
```

---

## Task 12: Extract the documentation tool to `docs-tool.ts`

Microsoft's three tools live in `tools.ts`. We're keeping only `queryDocumentationAsync`. Create a separate file so we can register exactly that one without dragging in the other two.

**Files:**
- Create: `src/docs-tool.ts`

- [ ] **Step 1: Read `src/tools.ts`**

```bash
cat src/tools.ts
```

Note `queryDocumentationAsync` is the function we want.

- [ ] **Step 2: Create docs-tool.ts**

Create `src/docs-tool.ts` (copy the implementation, do not import from `tools.ts` — that file is reference-only and we want this file self-contained):

```ts
import { CLARITY_API_TOKEN, DOCUMENTATION_URL } from "./constants.js";

const NO_TOKEN_HINT = "Clarity API token not set. Provide via CLARITY_API_TOKEN env or --clarity_api_token CLI flag.";

export async function queryDocumentationAsync(query: string): Promise<unknown> {
  if (!CLARITY_API_TOKEN) {
    return { content: [{ type: "text", text: NO_TOKEN_HINT }] };
  }
  try {
    const response = await fetch(DOCUMENTATION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CLARITY_API_TOKEN}`,
      },
      body: JSON.stringify({ query }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { content: [{ type: "text", text: `Docs API HTTP ${response.status}: ${body.slice(0, 200)}` }] };
    }
    const data = await response.json();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `Docs API error: ${msg}` }] };
  }
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/docs-tool.ts
git commit -m "feat(docs-tool): extract documentation tool to a self-contained module"
```

---

## Task 13: Rewrite `src/instructions.ts`

**Files:**
- Modify: `src/instructions.ts`

- [ ] **Step 1: Replace the file**

Overwrite `src/instructions.ts` entirely:

```ts
import {
  TAG_DISCOVERY_TOOL,
  QUERY_METRICS_TOOL,
  SESSION_RECORDINGS_TOOL,
  COMPARE_BY_VARIANT_TOOL,
  DOCUMENTATION_TOOL,
} from "./constants.js";

export const SYSTEM_INSTRUCTIONS_PROMPT = `
This MCP server provides Microsoft Clarity dashboard data and documentation.

## Tool Surface

### Data tools (cookie auth via CLARITY_DASHBOARD_COOKIE)

#### \`${TAG_DISCOVERY_TOOL}\`
Returns the list of custom-tag *keys* defined for the project (e.g. ["cro-cart-3way", "checkout_error_code", ...]).
Use this when you don't know which experiment tags exist for the project.

#### \`${QUERY_METRICS_TOOL}\`
Typed dashboard metrics for any combination of filters. Use this for ANY metric question — variant or not.

Filter dimensions include: \`url\`, \`device\`, \`browser\`, \`os\`, \`country\`, \`channel\`, \`source\`, \`medium\`, \`campaign\`, \`smartEvents\`, \`javascriptErrors\`, \`scrollDepth\` (range), \`sessionDuration\` (range), \`pagesCount\` (range), and the variant filters \`tagKey\`+\`tagValue\`.

Metrics: \`sessions\`, \`engagement\`, \`newVsReturning\`, \`topReferrers\`, \`topPages\`, \`scrollDepth\`, \`deadClicks\`, \`rageClicks\`, \`jsErrors\`, \`topDeadClickTargets\`, \`topClickedElements\`. Default: all.

Date range: accepts \`"last 7 days"\` (default), \`"yesterday"\`, \`"today"\`, \`"last N days"\` (1-90), \`"YYYY-MM-DD..YYYY-MM-DD"\`.

#### \`${SESSION_RECORDINGS_TOOL}\`
Typed session-recording list with the same filter union as \`${QUERY_METRICS_TOOL}\`. Returns up to 250 recordings with \`playerUrl\` + metadata. Sort options: \`newest\` (default), \`oldest\`, \`longest\`, \`shortest\`, \`most-clicks\`, \`most-pages\`.

#### \`${COMPARE_BY_VARIANT_TOOL}\`
Convenience: comparison table for one experiment. Auto-discovers values for the given \`tagKey\`, queries each, and computes deltas vs. control.

Use for variant comparison reports specifically. For single-variant questions or non-variant questions, use \`${QUERY_METRICS_TOOL}\` directly.

### Documentation tool (bearer auth via CLARITY_API_TOKEN)

#### \`${DOCUMENTATION_TOOL}\`
RAG over Microsoft Clarity documentation. Use for "how does X work" questions about Clarity itself.

## Routing rules

- For ANY data question: use \`${QUERY_METRICS_TOOL}\` or \`${SESSION_RECORDINGS_TOOL}\`. Variant filters are just two optional fields (\`tagKey\`, \`tagValue\`) within the same filter union.
- For variant comparison reports: use \`${COMPARE_BY_VARIANT_TOOL}\`.
- For "what tags exist": use \`${TAG_DISCOVERY_TOOL}\`.
- For Clarity-doc questions: use \`${DOCUMENTATION_TOOL}\`.

## Error handling

If you see "Clarity dashboard session expired", relay the message to the user — the cookie needs to be rotated by an operator. The data tools will not work until a fresh cookie is provided via Pulumi config.

If you see "Clarity API token not set", the documentation tool can't run. The data tools may still work.
`;
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add src/instructions.ts
git commit -m "docs(instructions): rewrite system prompt for new 5-tool surface"
```

---

## Task 14: Rewrite `src/index.ts` to register the 5 tools

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Replace the file**

Overwrite `src/index.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import pkg from "../package.json" with { type: "json" };

import {
  CLARITY_API_TOKEN,
  CLARITY_DASHBOARD_COOKIE,
  CLARITY_PROJECT_ID,
  COMPARE_BY_VARIANT_DESCRIPTION,
  COMPARE_BY_VARIANT_TOOL,
  DOCUMENTATION_DESCRIPTION,
  DOCUMENTATION_TOOL,
  NEW_SESSION_RECORDINGS_DESCRIPTION,
  QUERY_METRICS_DESCRIPTION,
  QUERY_METRICS_TOOL,
  SESSION_RECORDINGS_TOOL,
  TAG_DISCOVERY_DESCRIPTION,
  TAG_DISCOVERY_TOOL,
} from "./constants.js";
import { SYSTEM_INSTRUCTIONS_PROMPT } from "./instructions.js";
import {
  CompareByVariantInputShape,
  ListRecordingsInputShape,
  QueryMetricsInputShape,
  compareByVariant,
  listCustomTags,
  listSessionRecordings,
  queryMetrics,
} from "./dashboard/tools.js";
import { queryDocumentationAsync } from "./docs-tool.js";
import { z } from "zod";

const DocsInput = { query: z.string().describe("Natural-language question about Microsoft Clarity documentation.") };

const server = new McpServer(
  {
    name: pkg.name,
    version: pkg.version,
    capabilities: { resources: {}, tools: {} },
  },
  { instructions: SYSTEM_INSTRUCTIONS_PROMPT },
);

// === Cookie-authenticated dashboard tools ===

server.tool(
  TAG_DISCOVERY_TOOL,
  TAG_DISCOVERY_DESCRIPTION,
  {},
  { title: "List Custom Tags", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async () => {
    try {
      const tags = await listCustomTags();
      return { content: [{ type: "text", text: JSON.stringify(tags, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: msg }] };
    }
  },
);

server.tool(
  QUERY_METRICS_TOOL,
  QUERY_METRICS_DESCRIPTION,
  QueryMetricsInputShape,
  { title: "Query Clarity Metrics", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async (input) => {
    try {
      const result = await queryMetrics(input);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: msg }] };
    }
  },
);

server.tool(
  SESSION_RECORDINGS_TOOL,
  NEW_SESSION_RECORDINGS_DESCRIPTION,
  ListRecordingsInputShape,
  { title: "List Session Recordings", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async (input) => {
    try {
      const result = await listSessionRecordings(input);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: msg }] };
    }
  },
);

server.tool(
  COMPARE_BY_VARIANT_TOOL,
  COMPARE_BY_VARIANT_DESCRIPTION,
  CompareByVariantInputShape,
  { title: "Compare by Variant", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async (input) => {
    try {
      const result = await compareByVariant(input);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: msg }] };
    }
  },
);

// === Bearer-authenticated documentation tool ===

server.tool(
  DOCUMENTATION_TOOL,
  DOCUMENTATION_DESCRIPTION,
  DocsInput,
  { title: "Query Clarity Documentation", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ query }) => {
    return (await queryDocumentationAsync(query)) as { content: { type: "text"; text: string }[] };
  },
);

async function main() {
  console.error(`Clarity MCP Server (fork) starting...`);
  console.error(`  CLARITY_API_TOKEN:        ${CLARITY_API_TOKEN ? "configured" : "MISSING (docs tool will fail)"}`);
  console.error(`  CLARITY_DASHBOARD_COOKIE: ${CLARITY_DASHBOARD_COOKIE ? "configured" : "MISSING (data tools will fail)"}`);
  console.error(`  CLARITY_PROJECT_ID:       ${CLARITY_PROJECT_ID ?? "MISSING (data tools will fail)"}`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Clarity MCP Server (fork) running on stdio.");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: clean build. The `*Shape` exports are plain objects of Zod schemas, matching upstream's `ListRequest`/`SearchRequest` pattern in `src/types.ts`. The MCP SDK accepts those directly as parameter schemas.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(index): register 4 dashboard tools + docs tool, drop NL/old recordings"
```

---

## Task 15: Smoke-test script (`npm run probe`)

Hits the live `/api/v2` to confirm the cookie + queries work end-to-end. Not a CI test — run by the operator before deploys.

**Files:**
- Create: `scripts/probe.ts`

- [ ] **Step 1: Create scripts/probe.ts**

```ts
import "dotenv/config";
import { listCustomTags, queryMetrics } from "../src/dashboard/tools.js";

async function main() {
  console.log("Probing Clarity /api/v2 with current cookie...\n");

  console.log("[1/3] list-custom-tags");
  const tags = await listCustomTags();
  console.log("  → Got", tags.length, "tag keys:", tags.slice(0, 5).join(", "), tags.length > 5 ? "..." : "");
  if (tags.length === 0) throw new Error("Expected at least 1 custom tag key. Has the project run any clarity('set', ...) calls?");

  console.log("\n[2/3] query-metrics with no filter (last 7 days)");
  const baseline = await queryMetrics({ metrics: ["sessions"] });
  console.log("  → sessions:", baseline.sessions);
  if (!baseline.sessions || baseline.sessions.total <= 0) throw new Error("Expected total sessions > 0 for last 7 days.");

  console.log("\n[3/3] query-metrics with custom-tag filter (cro-cart-3way=0 vs =1)");
  const v0 = await queryMetrics({ filters: { tagKey: "cro-cart-3way", tagValue: "0" }, metrics: ["sessions"] });
  const v1 = await queryMetrics({ filters: { tagKey: "cro-cart-3way", tagValue: "1" }, metrics: ["sessions"] });
  console.log("  → v0 sessions:", v0.sessions, "v1 sessions:", v1.sessions);
  if (!v0.sessions || !v1.sessions) throw new Error("Expected both variants to return sessions.");
  if (v0.sessions.total === v1.sessions.total) {
    console.warn("  ⚠ Both variants returned identical session counts — filter may not be applied. Investigate before relying on data.");
  } else {
    console.log("  ✓ Variant filter is producing distinct results.");
  }

  console.log("\n✓ Probe successful.");
}

main().catch((err) => {
  console.error("\n✗ Probe failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: Add `dotenv` for local probe runs**

```bash
npm install --save-dev dotenv
```

- [ ] **Step 3: Verify build emits the script**

```bash
npm run build && ls dist/scripts/
```

Expected: `dist/scripts/probe.js` exists.

- [ ] **Step 4: Run the probe locally (manual)**

```bash
CLARITY_PROJECT_ID=w3y4c1nfgk \
  CLARITY_DASHBOARD_COOKIE="$(grep -E '^CLARITY_DASHBOARD_COOKIE=' .env | cut -d= -f2-)" \
  npm run probe
```

Expected output:
```
Probing Clarity /api/v2 with current cookie...
[1/3] list-custom-tags
  → Got 9 tag keys: checkout_error_code, cro-cart-3way, ...
[2/3] query-metrics with no filter (last 7 days)
  → sessions: { total: <some positive number>, bot: ... }
[3/3] query-metrics with custom-tag filter (cro-cart-3way=0 vs =1)
  → v0 sessions: ... v1 sessions: ...
  ✓ Variant filter is producing distinct results.
✓ Probe successful.
```

If the probe fails with `DashboardAuthError`, capture a fresh cookie. If it fails with shape errors, revisit Task 1 (capture refresh).

- [ ] **Step 5: Commit**

```bash
git add scripts/probe.ts package.json package-lock.json
git commit -m "feat(scripts): probe script to smoke-test /api/v2 connectivity + variant filter"
```

---

## Task 16: Cody integration — Dockerfile, entrypoint, Pulumi

This is in the `foreversongs-agents` repo (sibling to `clarity-mcp-server`). The agent doing this task should `cd /Users/angel/Desktop/foreversongs-agents` and treat that as the working tree.

**Files:**
- Modify: `docker/Dockerfile.cody`
- Modify: `docker/entrypoint-cody.sh`
- Modify: `infra/src/secrets.ts`
- Modify: `infra/src/agents.ts`

- [ ] **Step 1: Update Dockerfile.cody**

Open `docker/Dockerfile.cody`. Find the line that does `npm install -g @microsoft/clarity-mcp-server` (the explorer earlier reported it at line 37). Replace with:

```diff
- RUN npm install -g @microsoft/clarity-mcp-server
+ RUN npm install -g git+ssh://git@github.com/angelrojasm/clarity-mcp-server.git
```

(Iteration option: vendor by `COPY ../clarity-mcp-server /opt/clarity-mcp-server && cd /opt/clarity-mcp-server && npm ci && npm run build && npm install -g .`)

- [ ] **Step 2: Update entrypoint-cody.sh**

Open `docker/entrypoint-cody.sh`. Find the existing `clarity` mcporter block (around lines 102-109 per earlier exploration). Replace it with:

```bash
if [ -n "${CLARITY_API_TOKEN:-}" ] || [ -n "${CLARITY_DASHBOARD_COOKIE:-}" ]; then
  [ -n "${MCP_SERVERS}" ] && MCP_SERVERS="${MCP_SERVERS}, "
  MCP_SERVERS="${MCP_SERVERS}\"clarity\": { \
    \"command\": \"clarity-mcp-server\", \
    \"args\": [\"--clarity_api_token=${CLARITY_API_TOKEN:-}\"], \
    \"env\": { \
      \"CLARITY_DASHBOARD_COOKIE\": \"${CLARITY_DASHBOARD_COOKIE:-}\", \
      \"CLARITY_PROJECT_ID\": \"${CLARITY_PROJECT_ID:-w3y4c1nfgk}\" \
    } \
  }"
  echo "Clarity MCP configured (token=${CLARITY_API_TOKEN:+yes}, cookie=${CLARITY_DASHBOARD_COOKIE:+yes}, project=${CLARITY_PROJECT_ID:-w3y4c1nfgk})"
else
  echo "WARN: Neither CLARITY_API_TOKEN nor CLARITY_DASHBOARD_COOKIE set — Clarity MCP will be disabled."
fi
```

- [ ] **Step 3: Add the Pulumi secret**

Open `infra/src/secrets.ts`. Find the `clarityApiToken` block (around lines 89-93). Below it, add:

```ts
const clarityDashboardCookieValue = config.getSecret("clarityDashboardCookie");
const clarityDashboardCookie = clarityDashboardCookieValue !== undefined
  ? createSecret("openclaw/clarity-dashboard-cookie", clarityDashboardCookieValue)
  : undefined;

const clarityProjectId = config.get("clarityProjectId") ?? "w3y4c1nfgk";
```

Add to the `sharedSecretArns` export (whatever object aggregates secrets — match the existing pattern):

```ts
clarityDashboardCookieArn: clarityDashboardCookie?.arn,
clarityProjectId,
```

- [ ] **Step 4: Inject secret into Cody's container**

Open `infra/src/agents.ts`. Find the Cody container's secret/env injection (around line 145 per earlier exploration). Add:

```ts
if (args.sharedSecretArns.clarityDashboardCookieArn) {
  containerSecrets.push({
    name: "CLARITY_DASHBOARD_COOKIE",
    valueFrom: args.sharedSecretArns.clarityDashboardCookieArn,
  });
}
containerEnvironment.push({
  name: "CLARITY_PROJECT_ID",
  value: args.sharedSecretArns.clarityProjectId,
});
```

The exact field names (`containerSecrets`, `containerEnvironment`) may differ in the actual code; match what's there for `CLARITY_API_TOKEN`.

- [ ] **Step 5: Provision the cookie secret in dev (manual, by operator)**

```bash
cd infra
pulumi config set --secret clarityDashboardCookie "<paste cookie string>"
```

Do NOT run `pulumi up` yet — that's a separate deploy step on a real infra change.

- [ ] **Step 6: Commit**

```bash
cd /Users/angel/Desktop/foreversongs-agents
git add docker/Dockerfile.cody docker/entrypoint-cody.sh infra/src/secrets.ts infra/src/agents.ts
git commit -m "feat(cody): wire clarity-mcp-server-fs with cookie auth + project ID"
```

---

## Task 17: Verify acceptance criteria end-to-end

**Files:** none (this is a verification task).

- [ ] **Step 1: Build clean**

In `clarity-mcp-server`:

```bash
npm run build
```

Expected: clean.

- [ ] **Step 2: All tests pass**

```bash
npm test -- --run
```

Expected: all suites green (date-range: 6, client: 6, filters: 6, tools: 8 = 26 total).

- [ ] **Step 3: Probe passes against live `/api/v2`**

```bash
npm run probe
```

Expected: green output as in Task 15.

- [ ] **Step 4: Pinned parity check against the live dashboard (acceptance criterion #4)**

Goal: prove `query-metrics` with no filters reproduces the unfiltered dashboard within ±2% on three load-bearing metrics.

a) Open the live dashboard at `clarity.microsoft.com/projects/view/<project-id>/dashboard?date=Last%207%20days`. Capture the values shown for:
   - Sessions (totalSessions number on the Sessions card)
   - Dead-click rate (% on the dead-click card or behavior section)
   - Scroll depth (avg %)

   Save these to `scripts/captures/parity-fixture.json`:
   ```json
   {
     "capturedAt": "2026-05-04T15:00:00Z",
     "dashboardUrl": "<exact URL with date param>",
     "expected": {
       "sessions.total": <number>,
       "deadClickRate": <number>,
       "scrollDepth": <number>
     }
   }
   ```

b) Run the same period through `query-metrics`:
   ```bash
   node -e "
   import('./dist/dashboard/tools.js').then(async ({ queryMetrics }) => {
     const r = await queryMetrics({ metrics: ['sessions', 'deadClicks', 'scrollDepth'], dateRange: 'last 7 days' });
     console.log(JSON.stringify(r, null, 2));
   });
   "
   ```

c) Compute relative error for each metric: `|actual - expected| / expected`. Each must be ≤ 2%.

If any metric exceeds 2%, **stop**. Possible causes: filter envelope diff (e.g. dashboard implicitly filters bots; we don't), date-range edge mismatch, or operation drift. Re-capture (Task 1) and re-test before proceeding.

- [ ] **Step 4b: Transcript replay — every Cody Clarity workflow we have evidence of**

Acceptance criterion #11: every Cody-Clarity workflow visible in the captured transcripts must be reproducible via the new tools.

Walk through each ask from the two transcripts (cart 5-way and cart 3-way) and record which new tool answers it. Save to `docs/superpowers/notes/2026-05-04-transcript-replay.md`:

```markdown
# Transcript Replay — Cody Clarity Workflows on New Tools

| Transcript | Boss's ask | New tool used | ✅/❌ | Notes |
|---|---|---|---|---|
| cart-5way | "Review recordings, heatmaps, aggregate behavior across variants" | compare-by-variant({ tagKey: 'cro-cart-control-v2-v5' }) | ✅ | Returned 5-row table with deltas |
| cart-5way | "Top dead-click targets per variant" | compare-by-variant + topDeadClickTargets metric | ✅ |   |
| cart-5way | "Where is X dead-click happening?" | n/a — page-layout question, answered from code | n/a | Not a Clarity question |
| cart-3way | "Top rage-click coordinates per variant" | compare-by-variant + rageClicks metric | ✅ |   |
| cart-3way | "Average scroll depth per variant" | compare-by-variant + scrollDepth metric | ✅ |   |
| cart-3way | "Session recordings of typical drop-offs in v3" | list-session-recordings({ filters: { tagKey: 'cro-cart-3way', tagValue: '3' } }) | ✅ |   |
| ...add every distinct Clarity-ask from the transcripts |
```

Every row must end up ✅ or n/a. If any row is ❌, that's a missing capability — file a sub-task before declaring done.

- [ ] **Step 4c: NL-fallback decision (spec open question #8)**

Confirm during this verification that no captured Cody Clarity workflow required the old NL parser to express a query that can't be expressed via the typed surface.

In the transcript-replay note above, add a line:

```markdown
## NL-fallback assessment
Reviewed all Clarity asks above. None require natural-language parsing
beyond what Claude can handle by mapping a Slack message into the typed
filter/metric parameters. Decision: NO NL-fallback tool needed for v1.

If Cody fails to answer a real question via typed inputs after deploy,
revisit by adding a minimal local NL→typed shim — DO NOT re-introduce
the broken /mcp/dashboard/query NL parser.
```

If the assessment finds an NL-only workflow, file a follow-up task in this plan and reconsider.

- [ ] **Step 5: Spot-check variant ratios**

```bash
node -e "
import('./dist/dashboard/tools.js').then(async ({ compareByVariant }) => {
  const r = await compareByVariant({ tagKey: 'cro-cart-3way', metrics: ['sessions'] });
  console.log(JSON.stringify(r, null, 2));
});
"
```

Expected: a 3-row table where variant 0 has approximately 4× variant 1 sessions (matches our manual probe).

- [ ] **Step 6: End-to-end via Cody**

After `cd /Users/angel/Desktop/foreversongs-agents && pulumi up` (operator step) and a Cody redeploy, in the Cody Slack:

> @cody compare cro-cart-3way variants on dead clicks last 7 days

Expected: Cody calls `compare-by-variant` and posts a 3-row table with deltas. Verify in the Cody logs that:
- Both `CLARITY_API_TOKEN` and `CLARITY_DASHBOARD_COOKIE` were present at startup.
- The MCP registered `list-custom-tags`, `query-metrics`, `list-session-recordings`, `compare-by-variant`, `query-documentation-resources`.

- [ ] **Step 7: File the upstream issue**

Open https://github.com/microsoft/clarity-mcp-server/issues/new with:

- **Title:** Support filtering by custom tags (`clarity('set', ...)` data) — replicates issue #24
- **Body:** Concrete use case (variant-level analysis), evidence the data is in the dashboard and not on `/mcp/*`, link to the fork as a reference impl, link to issue #24 to consolidate.

---

## Self-Review

(Performed by author after completing the plan above; revised after spec ↔ plan diff.)

**1. Spec coverage:**

| Spec section | Plan tasks |
|---|---|
| Terms of Service review | Task 0 |
| Architecture / file layout | Tasks 2, 3, 5, 6, 7, 12, 14 |
| Auth model (cookie + bearer) | Tasks 5, 12 |
| Wire-level call shape | Tasks 5, 6 |
| `list-custom-tags` | Task 8 |
| `query-metrics` | Task 9 |
| `list-session-recordings` | Task 10 |
| `compare-by-variant` | Task 11 |
| `query-documentation-resources` (kept) | Task 12 |
| Defaults / ergonomics | Tasks 4, 6, 9, 10 |
| Instructions update | Task 13 |
| Cody integration | Task 16 |
| Smoke test | Task 15 |
| Risks / cookie rotation | Task 5 (auth error message), Task 16 (Pulumi secret pattern) |
| Acceptance criteria #1-#9 | Tasks 2, 8-11, 15, 17 |
| Acceptance criteria #10-#11 (Cody E2E + transcript replay) | Task 17 (Steps 4b, 6) |
| Acceptance criteria #12 (upstream issue) | Task 17 Step 7 |
| Open question #8 (NL-fallback decision) | Task 17 Step 4c |

All spec sections have a corresponding task.

**2. Placeholders:** None remaining. The "<replace with capture>" strings in Task 7 are intentional and gated by the explicit "Action required" callout in Task 7. Task 0's note template has fill-in-the-blanks but they're for the operator to fill, not the engineer.

**3. Type consistency:**
- `FiltersType`, `MetricKeyType`, `DateRange` defined in Tasks 4/6 and reused identically in Tasks 8-11.
- `Operation` interface defined in Task 7 used in Tasks 8-11.
- `QueryMetricsOutput` defined in Task 9 extended in Task 11.
- `*InputShape` (plain object) and `*Input` (ZodObject) are paired exports in Tasks 9, 10, 11; Task 14 imports the shapes for SDK registration.

**4. Scope:** Single subsystem (the Clarity MCP fork + Cody integration). One implementation cycle.

**5. Drift fixed in this revision:**
- Added Task 0 (ToS review) as a blocking gate.
- Plain-object `*InputShape` exports added in Tasks 9-11; Task 14 uses them instead of `.shape`.
- Task 9 fanout: `skip/limit/isAscending` now scoped to paginated ops only.
- Task 9 metric→output rename has an explanatory comment.
- Task 17 Step 4 now pins parity to a fixture file with explicit ±2% assertion.
- Task 17 Step 4b adds transcript replay table covering both captured Cody sessions.
- Task 17 Step 4c addresses spec open question #8 (NL fallback decision).
