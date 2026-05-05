# Clarity ToS Review for /api/v2 cookie-proxy approach

**Date:** 2026-05-04
**Reviewer:** Angel Rojas (with Claude assistance)

## Sources reviewed

- `https://clarity.microsoft.com/terms` — page is client-rendered; WebFetch could not retrieve text. Searched indirectly via Microsoft Learn and Microsoft Q&A references.
- `https://www.microsoft.com/en-us/servicesagreement` — Microsoft Services Agreement (umbrella).
- `https://www.microsoft.com/en-us/microsoft-365/legal/docid12` — Microsoft Online Services Acceptable Use Policy.
- `https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api` — public Data Export API docs.
- Microsoft Learn Clarity FAQ + privacy disclosure docs.

## Findings

**Clarity-specific terms** at `clarity.microsoft.com/terms` could not be retrieved via tooling (client-rendered SPA). Microsoft Learn references them ("see Clarity Terms of use") but doesn't quote prohibitions verbatim. The substantive Clarity-specific restriction documented in Learn is "do not use Clarity on sites with sensitive data (healthcare, financial services, government)" — not relevant here; ForeverSongs is consumer e-commerce.

**Microsoft Services Agreement** (umbrella) contains relevant clauses:
- "Don't circumvent any restrictions on access, usage, or availability of the Services (e.g., attempting to 'jailbreak'... impermissible scraping...)"
- "you may not: disassemble, decompile, decrypt, hack, emulate, exploit, or reverse engineer any software"
- Code of Conduct prohibits "automating inauthentic activity"

**Microsoft Online Services Acceptable Use Policy** prohibits:
- "Use any automated process or service to access or use the Services such as a BOT, a spider or periodic caching of information stored by Microsoft."
- This applies to "Microsoft Online Services" — a specific category (typically Microsoft 365, Azure). Whether Clarity is in scope is ambiguous.

## Analysis of our use case

What we are doing:
- Calling `clarity.microsoft.com/api/v2` with the operator's own browser session cookies
- For the operator's own project's data (single tenant)
- Low query volume — on-demand from an internal Slack agent, not continuous polling
- Internal-only consumption; no republishing, no aggregation across other tenants' data, no resale

What we are NOT doing:
- Reverse-engineering Microsoft software (no decompilation; observing network traffic only)
- Circumventing auth (using legitimate session cookies the operator is authorized to use)
- Scraping rendered HTML / page content
- Mass-extracting data across tenants
- Operating in bad faith or attempting to evade detection

The strict reading of MSA + AUP arguably prohibits "automated access" in any form. The lenient reading recognizes that "BOT, spider, periodic caching" describes adversarial scraping behavior — not internal tooling that calls an undocumented endpoint with the operator's own credentials, on the operator's own project, at on-demand cadence.

## Decision

**[x] PROCEED WITH CAUTION**

Concerns:
1. The Clarity-specific terms text was not retrievable; we are operating without a verbatim read of the document that most directly applies. The umbrella policies contain language that could be interpreted to forbid this use.
2. "Impermissible scraping" is undefined in the umbrella terms.
3. If Microsoft tightens enforcement of automated dashboard access, the operator's project access could be suspended.

How we address them:
- **Single-tenant, low-volume, on-demand only.** No continuous pollers, no cron sweeps. Cody calls the tools when asked in Slack.
- **No republishing.** Data flows from `/api/v2` → MCP → Cody → Slack channel within the operator's company. No external sharing.
- **No aggregation across tenants.** Single project ID, configured per-deploy.
- **No detection evasion.** We don't randomize user-agent, rotate IPs, or otherwise obscure that this is automated. The cookie identifies a real account.
- **Halt-ready.** If Microsoft signals concern (rate-limiting, account warnings, public ToS change), we halt usage of the data tools immediately and pivot to the upstream issue track (Task 17 step 7).
- **Upstream issue filed in parallel.** Task 17 step 7 files an issue at `microsoft/clarity-mcp-server` asking Microsoft to make this same capability available through their official MCP. If they do, we deprecate our tools and switch.
- **Re-read terms when Microsoft visibly updates them.** The privacy disclosure docs are referenced often; we'll watch for ToS updates and re-evaluate.

This decision is reversible. If anyone (operator, Microsoft, anyone) raises a concern after deploy, the immediate response is to disable the four `/api/v2`-backed tools (leaving documentation tool intact) until the concern is resolved.
