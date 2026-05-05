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
  if (!match || !match[1]) {
    throw new DashboardAuthError("CSRF token not found in cookie. Cookie must include the '_csrf' value. " + COOKIE_ROTATION_HINT);
  }
  return match[1];
}

/**
 * Emit a structured stderr line with telemetry the operator can grep for in
 * CloudWatch when something feels off. Format:
 *   [clarity-mcp] op=<name> status=<int> ms=<int> bytes=<int> gql_errors=<int>
 *
 * `extracted=true|false` is logged separately by the tool layer once it has
 * tried to apply its responseExtractPath — the client doesn't know what the
 * caller expected.
 */
function logCall(op: string, fields: Record<string, string | number>): void {
  const parts = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(" ");
  console.error(`[clarity-mcp] op=${op} ${parts}`);
}

export async function postGraphQL(operationName: string, query: string, variables: Record<string, unknown>): Promise<unknown> {
  const cookie = readCookieFromEnv();
  const csrf = extractCsrf(cookie);

  const t0 = Date.now();
  const response = await fetch(DASHBOARD_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": cookie,
      "csrf-token": csrf,
    },
    body: JSON.stringify({ operationName, query, variables }),
  });
  const ms = Date.now() - t0;

  if (response.status === 401) {
    logCall(operationName, { status: response.status, ms, bytes: 0, gql_errors: 0 });
    throw new DashboardAuthError(`HTTP ${response.status} from dashboard API. ${COOKIE_ROTATION_HINT}`);
  }

  const text = await response.text();
  const bytes = text.length;

  if (!response.ok) {
    logCall(operationName, { status: response.status, ms, bytes, gql_errors: 0 });
    throw new DashboardHttpError(`Dashboard API HTTP ${response.status}: ${text.slice(0, 200)}`, response.status);
  }

  let json: { data?: unknown; errors?: { message: string }[] };
  try {
    json = JSON.parse(text);
  } catch {
    logCall(operationName, { status: response.status, ms, bytes, gql_errors: 0 });
    throw new DashboardHttpError(`Dashboard API returned non-JSON body: ${text.slice(0, 200)}`);
  }

  const gqlErrors = json.errors?.length ?? 0;
  logCall(operationName, { status: response.status, ms, bytes, gql_errors: gqlErrors });

  if (gqlErrors > 0) {
    throw new DashboardHttpError(`Dashboard GraphQL errors: ${json.errors!.map((e) => e.message).join("; ")}`);
  }
  return json;
}

/**
 * Tool-layer logging: called after the caller tries to apply its
 * responseExtractPath, so the operator can grep for `extracted=false` to find
 * shape drift even when the HTTP call succeeded.
 */
export function logExtract(op: string, extracted: boolean): void {
  console.error(`[clarity-mcp] op=${op} extracted=${extracted}`);
}
