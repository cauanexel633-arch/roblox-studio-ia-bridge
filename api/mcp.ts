import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { safeEqual } from "../lib/auth";
import { isValidAccessToken, publicBaseUrl } from "../lib/oauth";
import { sendToBridge } from "../lib/bridge";

// Comandos no PC esperam a aprovação humana (até 45 s), então o limite é maior
export const config = { maxDuration: 60 };
const CALL_TIMEOUT_MS = 55_000;

type McpTool = { name: string; description?: string; inputSchema: Record<string, unknown> };

/**
 * Servidor MCP remoto (Streamable HTTP, sem estado).
 * Conectores de IA entram por OAuth: a tela de login em /api/oauth/authorize
 * pede a chave, e o token emitido é enviado como "Authorization: Bearer".
 * O API_SECRET também é aceito direto no cabeçalho, para testes com curl.
 *
 * As ferramentas expostas são as que o servidor local liberou em ALLOWED_TOOLS.
 */
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
    // Se o PC estiver offline, a descoberta ainda responde (sem ferramentas)
    // em vez de falhar. Quando o PC voltar, a lista aparece.
    if (!list.ok) {
      console.warn("tools/list sem ferramentas:", list.error);
      return { tools: [] };
    }
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
    const reply = await sendToBridge(
      "call",
      { tool: request.params.name, args: request.params.arguments ?? {} },
      CALL_TIMEOUT_MS
    );

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
