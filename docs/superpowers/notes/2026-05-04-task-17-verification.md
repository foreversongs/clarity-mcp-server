# Task 17 — Acceptance Criteria Verification

**Date:** 2026-05-04
**Branch:** `feat/variant-tools`
**Build:** clean (`tsc` exits 0)
**Tests:** 27/27 passing across 4 test files

## Acceptance Criteria Status

| # | Criterion | Status | Notes |
|---|---|---|---|
| 1 | Fork builds clean (`npm run build`); upstream `tools.ts`/`types.ts` present but not imported by `index.ts` | ✅ DONE | Verified. Index imports only from `./constants`, `./instructions`, `./dashboard/tools`, `./docs-tool`. |
| 2 | `npm run probe` (a new script) successfully exercises operations and asserts response shapes | ⚠ DEFERRED | Probe script exists and compiles. Live run blocked because `.env` only contains the bearer token (`CLARITY_TOKEN`) — not the dashboard cookie (`CLARITY_DASHBOARD_COOKIE`). The cookie capture is part of Task 16. The probe correctly errored with the documented "session expired or missing" message, demonstrating the auth-failure path works. |
| 3 | `list-custom-tags` returns the same 9 tag keys we observed on 2026-05-01 | ⚠ DEFERRED | Requires live cookie. Verified in browser exploration during Task 1: 16 tag keys present (project has expanded since 2026-05-01). |
| 4 | `query-metrics` with no `tagKey` reproduces unfiltered Clarity dashboard metrics within ±2% | ⚠ DEFERRED | Requires live cookie. To verify: load the live dashboard, capture sessions/deadClickRate/scrollDepth, run probe with same date range, compute relative error. |
| 5 | `query-metrics` with `filters: { tagKey: "cro-cart-3way", tagValue: "0" }` returns ~4× the sessions of `tagValue: "1"` | ⚠ DEFERRED | Requires live cookie. Direct curl test during spec-design phase confirmed 4080 sessions (variant 0) vs 1018 sessions (variant 1) — a 4× delta. |
| 6 | `list-session-recordings` with `tagKey/tagValue` filter returns variant-specific recordings | ⚠ DEFERRED | Requires live cookie. The `GET_RECORDINGS` operation is currently a PROVISIONAL stub in `operations.ts` (recordings page kept redirecting to dashboard during Task 1's Playwright capture). The Task 16 operator should capture the real recordings-list query just-in-time as part of cookie setup, then update operations.ts. |
| 7 | `list-session-recordings` with `filters: { url: ..., device: ["Mobile"] }` (no variant) returns same as live dashboard | ⚠ DEFERRED | Same constraint. |
| 8 | `compare-by-variant` with `tagKey: "cro-cart-3way"` returns 3-row table with deltas | ⚠ DEFERRED | Requires live cookie. Unit test passes (`auto-discovers values, fans out, and computes deltas vs control`); live verification needs cookie. |
| 9 | `query-documentation-resources` with sample question returns documentation snippets | ⚠ DEFERRED | Requires live `CLARITY_API_TOKEN`. The bearer-token plumbing is unchanged from upstream; behavior should match. |
| 10 | Cody, deployed with both credentials, can call all 5 tools end-to-end from Slack | ⚠ NEEDS DEPLOY | See `2026-05-04-task-16-cody-integration-handoff.md`. |
| 11 | Every Cody-Clarity workflow in captured transcripts (cart 5-way, cart 3-way) is reproducible via new tools | ⚠ NEEDS DEPLOY | Spec coverage maps each workflow to a tool — `compare-by-variant` for variant tables, `query-metrics` with filters for non-variant questions, `list-session-recordings` with `tagKey/tagValue` for per-variant drilldown, `list-custom-tags` for discovery. |
| 12 | Upstream issue filed at `microsoft/clarity-mcp-server` referencing #24 | ⏭ TODO | Owner: Angel. Independent of code. |

## Provisional operations (still need just-in-time capture)

The following GraphQL operations were marked PROVISIONAL in `src/dashboard/operations.ts` because they were not observed during Task 1's Playwright capture sweep:

- `LIST_CUSTOM_TAG_KEYS` — populates the tag-key dropdown. Likely solvable by extending `getFilterOptions`'s selection set to include `Variables`. Capture during Task 16 cookie probe.
- `LIST_CUSTOM_TAG_VALUES` — populates the value combobox after selecting a key. Same pattern.
- `GET_RECORDINGS` — the recordings-list query. The Recordings page redirected back to `/dashboard` during the Playwright capture. Capture by clicking "Go to recordings" from a dashboard metric card.
- `GET_TOP_PAGES`, `GET_TOP_DEAD_CLICK_TARGETS`, `GET_TOP_CLICKED_ELEMENTS` — provisional stubs based on the `getTopMetrics` pattern. Confirm field names by triggering the corresponding dashboard cards.

When operators run the probe successfully and confirm one of these provisional stubs returns the wrong shape, replace the placeholder query in `operations.ts` with a verbatim capture from the live dashboard.

## NL-fallback decision (spec open question #8)

**Decision: NO NL-fallback tool needed for v1.**

Reviewed all Cody Clarity asks in the captured transcripts (cart 5-way, cart 3-way). Every question maps cleanly to typed parameters:
- "Top dead-click targets per variant on mobile last 7 days" → `compare-by-variant({ tagKey, additionalFilters: { device: ["Mobile"] }, metrics: ["topDeadClickTargets"] })`
- "Sessions for variant 1" → `query-metrics({ filters: { tagKey: ..., tagValue: "1" }, metrics: ["sessions"] })`
- "Recordings of variant 1 drop-offs" → `list-session-recordings({ filters: { tagKey: ..., tagValue: "1", scrollDepth: { max: 50 } } })`

If Cody fails to answer a real question via typed inputs after deploy, the response is to add a minimal local NL→typed shim — NOT to re-introduce the broken `/mcp/dashboard/query` NL parser.

## What ships in this PR

- 4 new dashboard tools backed by `clarity.microsoft.com/api/v2` with cookie auth
- 1 retained documentation tool from upstream
- Microsoft's two data tools are no longer registered (their code stays as `src/tools.ts` / `src/types.ts` reference)
- Per-call structured stderr telemetry for production observability
- Shape-drift `_warnings` on `query-metrics` responses
- Smoke probe (`npm run probe`)
- Spec, plan, ToS-review note, captures (`scripts/captures/`), Cody integration handoff doc

## What does NOT ship in this PR

- Cody runtime integration (Dockerfile.cody, entrypoint, Pulumi) — operator handoff doc instead
- Live API verification (acceptance criteria 3-9) — requires operator cookie capture
- Upstream issue at microsoft/clarity-mcp-server — operator action

## Recommended next steps for the operator

1. Read `2026-05-04-task-16-cody-integration-handoff.md`. Apply the foreversongs-agents changes on a feature branch there.
2. Capture a fresh dashboard cookie. Set Pulumi secrets. Build & push the Cody image. `pulumi up`.
3. Run `npm run probe` from this repo with the cookie set. Surface drift if any. Update PROVISIONAL operations in `operations.ts` with verbatim captures as needed.
4. File the upstream issue on `microsoft/clarity-mcp-server` referencing #24.
5. Test end-to-end via Slack. Verify each Cody-Clarity workflow from the transcripts.
6. Open PR from `feat/variant-tools` → `main` once probe runs clean and Cody E2E passes.
