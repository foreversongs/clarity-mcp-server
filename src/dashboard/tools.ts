import { postGraphQL, logExtract } from "./client.js";
import { LIST_CUSTOM_TAG_KEYS } from "./operations.js";

function getProjectId(): string {
  const id = process.env.CLARITY_PROJECT_ID;
  if (!id || id.trim() === "") {
    throw new Error("CLARITY_PROJECT_ID env var is required. Set it to your Clarity project ID (e.g. 'w3y4c1nfgk').");
  }
  return id;
}

/**
 * Walk a dotted path through a parsed JSON response. Returns undefined if any
 * segment is missing.
 */
function extract(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * Extract + emit a CloudWatch-grep-able telemetry line. Tools call this so the
 * operator can see `extracted=false` even when the HTTP call succeeded — that's
 * the symptom of dashboard shape drift.
 */
function extractWithLog(op: string, obj: unknown, path: string): unknown {
  const result = extract(obj, path);
  logExtract(op, result !== undefined);
  return result;
}

let cachedTags: string[] | null = null;

export async function listCustomTags(): Promise<string[]> {
  if (cachedTags) return cachedTags;
  const response = await postGraphQL(
    LIST_CUSTOM_TAG_KEYS.operationName,
    LIST_CUSTOM_TAG_KEYS.query,
    { projectId: getProjectId() },
  );
  const tags = extractWithLog(LIST_CUSTOM_TAG_KEYS.operationName, response, LIST_CUSTOM_TAG_KEYS.responseExtractPath);
  if (!Array.isArray(tags)) {
    throw new Error(`Unexpected response shape from listCustomTagKeys (operation: ${LIST_CUSTOM_TAG_KEYS.operationName}, expected path: ${LIST_CUSTOM_TAG_KEYS.responseExtractPath}). Response head: ${JSON.stringify(response).slice(0, 200)}`);
  }
  cachedTags = tags as string[];
  return cachedTags;
}

// Test-only export so tests can reset the cache between cases.
export function __resetCacheForTests() {
  cachedTags = null;
}
