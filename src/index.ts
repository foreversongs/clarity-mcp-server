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
  GET_CLICK_ELEMENTS_DESCRIPTION,
  GET_CLICK_ELEMENTS_TOOL,
  SESSION_RECORDINGS_DESCRIPTION,
  QUERY_METRICS_DESCRIPTION,
  QUERY_METRICS_TOOL,
  SESSION_RECORDINGS_TOOL,
  TAG_DISCOVERY_DESCRIPTION,
  TAG_DISCOVERY_TOOL,
} from "./constants.js";
import { SYSTEM_INSTRUCTIONS_PROMPT } from "./instructions.js";
import {
  CompareByVariantInputShape,
  GetClickElementsInputShape,
  ListRecordingsInputShape,
  QueryMetricsInputShape,
  compareByVariant,
  getClickElements,
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
  },
  {
    capabilities: { resources: {}, tools: {} },
    instructions: SYSTEM_INSTRUCTIONS_PROMPT,
  },
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
  SESSION_RECORDINGS_DESCRIPTION,
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

server.tool(
  GET_CLICK_ELEMENTS_TOOL,
  GET_CLICK_ELEMENTS_DESCRIPTION,
  GetClickElementsInputShape,
  { title: "Get Click Elements", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async (input) => {
    try {
      const result = await getClickElements(input);
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
