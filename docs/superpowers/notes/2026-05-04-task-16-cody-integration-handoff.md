# Task 16 — Cody Integration Handoff

**Status:** ⚠ Awaiting operator action
**Reason for handoff:** Modifies production infrastructure (ECS Fargate task definition, Pulumi secrets, Docker build). Auto-mode policy + caution: this happens with operator review, not autonomously.
**Owner:** Angel
**Repo:** `/Users/angel/Desktop/foreversongs-agents` (sibling to this repo)
**Branch suggested:** `feat/clarity-mcp-fork`

---

## What you need to do, in order

### 1. Capture a fresh dashboard cookie

The `clarity-mcp-server-fs` cookie auth uses the *operator's* browser session.

1. Sign in at `https://clarity.microsoft.com/projects/view/w3y4c1nfgk/dashboard` in a normal Chrome window.
2. Open DevTools → Application → Cookies → `https://clarity.microsoft.com`.
3. Copy ALL cookies as a single `Cookie:` header string. Easiest path: in the Network tab, click any `/api/v2` request, copy its `Cookie:` header verbatim from the request headers panel.
4. Save it locally for the Pulumi step below. Do NOT paste the cookie into source code, the conversation log, or commits.

### 2. Update `Dockerfile.cody`

Find the line that installs the official Microsoft Clarity MCP. From the agents-repo explorer report, it's around line 37:

```diff
- RUN npm install -g @microsoft/clarity-mcp-server
+ RUN npm install -g git+ssh://git@github.com/angelrojasm/clarity-mcp-server.git#feat/variant-tools
```

(Use the `feat/variant-tools` branch until it merges into `main`. Then drop the `#...` suffix.)

### 3. Update `entrypoint-cody.sh`

Find the existing `clarity` mcporter block (around lines 102–109). Replace with:

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

The block:
- Activates the MCP if EITHER credential is set (data tools work with cookie, docs tool works with token).
- Defaults `CLARITY_PROJECT_ID` to `w3y4c1nfgk` (ForeverSongs).
- Logs which credentials are present at startup so a Slack-output diagnostic shows the state.

### 4. Update `infra/src/secrets.ts`

Find the `clarityApiToken` block (around lines 89–93). Mirror it for the cookie:

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

### 5. Update `infra/src/agents.ts`

Find the Cody container's secret/env injection (around line 145 per the explorer report). Add alongside the existing `CLARITY_API_TOKEN` injection:

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

(Match the actual field/method names used by the existing `CLARITY_API_TOKEN` wiring in your agents.ts; the explorer report's hints may not be 1:1.)

### 6. Provision the cookie secret

```bash
cd /Users/angel/Desktop/foreversongs-agents/infra
pulumi config set --secret clarityDashboardCookie "<paste cookie>"
# Optional override:
# pulumi config set clarityProjectId w3y4c1nfgk
```

### 7. Build & deploy

```bash
cd /Users/angel/Desktop/foreversongs-agents
./scripts/build-and-push.sh --image cody
cd infra && pulumi up
```

### 8. Verify in Slack

In a Cody-accessible channel:

> @cody compare cro-cart-3way variants on dead clicks last 7 days

Expected: Cody invokes `compare-by-variant`, posts a 3-row table with deltas vs. control. Confirm in CloudWatch that:
- Both `CLARITY_API_TOKEN` and `CLARITY_DASHBOARD_COOKIE` show as configured at container startup.
- The MCP registered all 5 tools.
- Per-call telemetry lines (`[clarity-mcp] op=... status=... ms=... bytes=... gql_errors=...`) appear in logs.

If `extracted=false` shows up for any operation, that's drift — see `scripts/captures/README.md` for the recapture procedure.

---

## Cookie rotation

Microsoft session cookies expire in roughly 30–90 days. When you see `DashboardAuthError` in CloudWatch (or Cody starts surfacing "Clarity dashboard session expired"):

1. Re-login at `clarity.microsoft.com`, capture fresh cookie.
2. `pulumi config set --secret clarityDashboardCookie "<new cookie>"`
3. `pulumi up` to roll the running task.

No code change needed.

---

## Why this is a manual operator step

- **Pulumi config writes secrets.** Auto-mode shouldn't paste session cookies into infrastructure tooling without human review.
- **`pulumi up` deploys to real ECS.** This is a production change.
- **The agents-repo conventions vary slightly from what the plan assumed.** Field names like `containerSecrets`/`containerEnvironment` may not match exactly — operator should grep for the existing `CLARITY_API_TOKEN` wiring and mirror it precisely.
