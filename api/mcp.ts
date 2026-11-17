import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { safeEqual } from "../lib/auth";
import { isValidAccessToken, publicBaseUrl } from "../lib/oauth";
import { sendToBridge } from "../lib/bridge";

export const config = { maxDuration: 60 };

type McpTool = { name: string; description?: string; inputSchema: Record<string, unknown> };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const secret = process.env.API_SECRET;
  const authorized =
    token !== "" && (isValidAccessToken(token) || (!!secret && safeEqual(token, secret)));

  if (!authorized) {
    res.setHeader(
      "WWW-Authenticate",
      `Bearer resource_metadata="${publicBaseUrl(req)}/.well-known/oauth-protected-resource"`
    );
    return res.status(401).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const server = new Server(
    { name: "roblox-studio", version: "0.2.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const list = await sendToBridge("list");
    if (!list.ok) throw new Error(list.error);
    const tools = (list.tools ?? []) as McpTool[];
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema as { type: "object"; [key: string]: unknown },
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const reply = await sendToBridge("call", {
      tool: request.params.name,
      args: request.params.arguments ?? {},
    });
    if (!reply.ok) {
      return { isError: true, content: [{ type: "text" as const, text: reply.error }] };
    }
    const result = reply.result as { content?: unknown[]; isError?: boolean } | undefined;
    if (result && Array.isArray(result.content)) {
      return result as { content: { type: "text"; text: string }[]; isError?: boolean };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(reply.result ?? null) }] };
  });

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
