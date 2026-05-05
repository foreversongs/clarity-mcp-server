/**
 * Smoke test for the dashboard tools against the live /api/v2 endpoint.
 *
 * Configure via env vars (or a local .env):
 *   CLARITY_DASHBOARD_COOKIE  — full Cookie header from a logged-in session
 *   CLARITY_PROJECT_ID        — Clarity project ID (the alphanumeric in the
 *                               dashboard URL)
 *   CLARITY_PROBE_TAG_KEY     — optional, a custom-tag key the project has
 *                               recorded (defaults to the first tag returned
 *                               by list-custom-tags)
 *   CLARITY_PROBE_TAG_VALUES  — optional, comma-separated values to compare
 *                               (defaults to the first two values discovered)
 *
 * Run via `npm run probe` after `npm run build`.
 */

import "dotenv/config";
import { listCustomTags, queryMetrics } from "../src/dashboard/tools.js";

async function main() {
  console.log("Probing Clarity /api/v2 with current cookie...\n");

  console.log("[1/3] list-custom-tags");
  const tags = await listCustomTags();
  console.log("  → Got", tags.length, "tag keys:", tags.slice(0, 5).join(", "), tags.length > 5 ? "..." : "");
  if (tags.length === 0) {
    throw new Error("Expected at least 1 custom tag key. Has the project run any clarity('set', ...) calls?");
  }

  console.log("\n[2/3] query-metrics with no filter (last 7 days)");
  const baseline = await queryMetrics({ metrics: ["sessions"] });
  console.log("  → sessions:", baseline.sessions);
  if (!baseline.sessions || baseline.sessions.total <= 0) {
    throw new Error("Expected total sessions > 0 for last 7 days.");
  }

  // Pick a tag key + two values for the variant-filter sanity check.
  const tagKey = process.env.CLARITY_PROBE_TAG_KEY ?? tags[0]!;
  const explicitValues = process.env.CLARITY_PROBE_TAG_VALUES?.split(",").map((s) => s.trim()).filter(Boolean);
  const [valueA, valueB] = explicitValues && explicitValues.length >= 2 ? explicitValues : ["0", "1"];

  console.log(`\n[3/3] query-metrics with custom-tag filter (${tagKey}=${valueA} vs =${valueB})`);
  const a = await queryMetrics({ filters: { tagKey, tagValue: valueA }, metrics: ["sessions"] });
  const b = await queryMetrics({ filters: { tagKey, tagValue: valueB }, metrics: ["sessions"] });
  console.log(`  → ${valueA} sessions:`, a.sessions, ` ${valueB} sessions:`, b.sessions);
  if (!a.sessions || !b.sessions) {
    throw new Error("Expected both variants to return sessions. Adjust CLARITY_PROBE_TAG_KEY / CLARITY_PROBE_TAG_VALUES if needed.");
  }
  if (a.sessions.total === b.sessions.total) {
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
