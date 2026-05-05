# Side-by-Side Backend Comparison

**Date:** 2026-05-05
**Question used:** *"Sessions for `cro-cart-3way` variant 1, last 7 days"* (a concrete variant-aware ask Chris gave Cody in the captured Slack threads)
**Window:** 2026-04-28 → 2026-05-05 (UTC)
**Script:** `scripts/compare-backends.ts` (run via `node dist/scripts/compare-backends.js` after `npm run build`)

## Result

| Backend | Endpoint | HTTP | Latency | Result |
|---|---|---|---|---|
| **A. Official MCP NL parser** | `clarity.microsoft.com/mcp/dashboard/query` | 200 | 4759 ms | `{"query":"None","data":null,"dataErrorType":4}` — parser explicitly returned "None" because it cannot translate "custom tag = N". Hard fail. |
| **B. Official MCP recordings (typed)** | `clarity.microsoft.com/mcp/recordings/sample` | 200 | 1403 ms | 50 sessions returned. The `customTags` filter we passed in was **silently dropped** — what came back is not variant-filtered, it's just date+URL-filtered. **False positive: looks fine but the variant constraint did nothing.** |
| **C. `/api/v2` cookie-proxy** | `clarity.microsoft.com/api/v2` (`getSessionsInfo`) | 200 | 513 ms | **`totalSessions: 1459`**, `totalBotSessions: 122`. This is the real answer. |

## Reading the comparison

Cody's existing path (Backend A or B) gives Chris one of two failure modes:

1. **Backend A produces no answer at all** — `dataErrorType: 4` is the NL parser saying "I have no idea what you're asking." Cody surfaces this as an unhelpful error.
2. **Backend B produces a *plausible-looking wrong answer*.** It returns 50 sessions, no error indication, no warning that the variant filter was ignored. If Cody trusts the response, he reports a number that's actually unfiltered — exactly the failure mode we documented in the spec's "Risks" section.

Backend C — the cookie-proxy path the new `query-metrics` tool uses — gives the actual variant-filtered count in 513 ms.

## Implication for confidence

The new tool surface answers the question in well under a second, with the same data the dashboard UI shows. The NL parser is dead-end for variant questions; the typed-recordings path silently lies about the filter. Replacing both with `/api/v2`-backed tools is the right call.

## Caveat

Backend B's silent drop is the most dangerous failure mode. Even if a future Microsoft MCP update adds `customTags` to the schema, this experiment shows that ANY filter we pass that the backend doesn't recognize is silently swallowed. A defensive client would assert every filter it passes is acknowledged in the response — but we can't, because the official API doesn't echo applied filters.

## Reproducing

```bash
# .env must contain CLARITY_TOKEN, CLARITY_DASHBOARD_COOKIE, CLARITY_PROJECT_ID
npm run build
node dist/scripts/compare-backends.js
```
