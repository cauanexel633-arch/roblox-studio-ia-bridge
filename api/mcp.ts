import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { checkSecret } from "../lib/auth";
import { sendToBridge } from "../lib/bridge";

export const config = { maxDuration: 30 };

type McpTool = { name: string; description?: string; inputSchema: Record<string, unknown> };

/**
 * Servidor MCP remoto (Streamable HTTP, sem estado).
 * Qualquer IA que aceite conector/plugin MCP aponta para:
 *   https://SEU-DOMINIO.vercel.app/api/mcp?key=API_SECRET
 * (ou envia "Authorization: Bearer API_SECRET").
 *
 * As ferramentas expostas são as que o servidor local liberou em ALLOWED_TOOLS.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!checkSecret(req.headers, req.query ?? {}, process.env.API_SECRET)) {
    return res.status(401).end();
  }

  // Modo sem estado: só POST. GET (stream SSE) e DELETE não são usados aqui.
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const server = new Server(
    { name: "roblox-studio", version: "0.1.0" },
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

    // O resultado já vem no formato do MCP do Studio ({ content, isError })
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
