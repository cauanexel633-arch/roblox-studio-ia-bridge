import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkBearer } from "../lib/auth";
import { sendToBridge } from "../lib/bridge";

export const config = { maxDuration: 60 };

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-5";
const MAX_STEPS = 8;

const SYSTEM = `Você controla o Roblox Studio do usuário através de ferramentas.
- Use as ferramentas para ler o estado atual antes de alterar algo.
- Não apague nem sobrescreva nada sem pedido explícito do usuário.
- Responda em português, de forma objetiva, com um resumo do que foi feito.`;

type McpTool = { name: string; description?: string; inputSchema: Record<string, unknown> };

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type OpenRouterResponse = {
  choices?: { message: { role: "assistant"; content: string | null; tool_calls?: ToolCall[] } }[];
  error?: { message?: string; code?: number };
};

/**
 * Endpoint para a IA: recebe uma mensagem em linguagem natural, roda o loop
 * de tool use pela OpenRouter e executa as ferramentas no Studio via Ably.
 * POST /api/chat  { "message": "..." }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  if (!checkBearer(req.headers, process.env.API_SECRET)) return res.status(401).end();

  const { message } = (req.body ?? {}) as { message?: string };
  if (!message) return res.status(400).json({ ok: false, error: "campo 'message' obrigatório" });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: "OPENROUTER_API_KEY não configurada" });

  // Ferramentas disponíveis = as que o servidor local liberou na allowlist
  const list = await sendToBridge("list");
  if (!list.ok) return res.status(502).json(list);

  const tools = ((list.tools ?? []) as McpTool[]).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.inputSchema,
    },
  }));

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: message },
  ];

  for (let step = 1; step <= MAX_STEPS; step++) {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "Roblox Studio IA Bridge",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools: tools.length ? tools : undefined,
        max_tokens: 2048,
      }),
    });

    const data = (await response.json().catch(() => ({}))) as OpenRouterResponse;

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: `OpenRouter respondeu ${response.status}: ${data.error?.message ?? "erro desconhecido"}`,
      });
    }

    const msg = data.choices?.[0]?.message;
    if (!msg) return res.status(502).json({ ok: false, error: "resposta vazia da OpenRouter" });

    messages.push({
      role: "assistant",
      content: msg.content ?? null,
      tool_calls: msg.tool_calls?.length ? msg.tool_calls : undefined,
    });

    if (!msg.tool_calls?.length) {
      return res.status(200).json({ ok: true, answer: msg.content ?? "", steps: step, model: MODEL });
    }

    for (const call of msg.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      const reply = await sendToBridge("call", { tool: call.function.name, args });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(reply),
      });
    }
  }

  return res.status(200).json({ ok: false, error: `limite de ${MAX_STEPS} passos atingido` });
}
