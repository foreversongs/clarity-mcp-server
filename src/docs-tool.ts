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
