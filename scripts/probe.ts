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
