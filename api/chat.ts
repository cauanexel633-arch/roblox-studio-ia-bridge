import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { checkBearer } from "../lib/auth";
import { sendToBridge } from "../lib/bridge";

export const config = { maxDuration: 60 };

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
const MAX_STEPS = 8;

const SYSTEM = `Você controla o Roblox Studio do usuário através de ferramentas.
- Use as ferramentas para ler o estado atual antes de alterar algo.
- Não apague nem sobrescreva nada sem pedido explícito do usuário.
- Responda em português, de forma objetiva, com um resumo do que foi feito.`;

type McpTool = { name: string; description?: string; inputSchema: Record<string, unknown> };

/**
 * Endpoint para a IA: recebe uma mensagem em linguagem natural,
 * roda o loop de tool use com Claude e executa as ferramentas no Studio.
 * POST /api/chat  { "message": "..." }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  if (!checkBearer(req.headers, process.env.API_SECRET)) return res.status(401).end();

  const { message } = (req.body ?? {}) as { message?: string };
  if (!message) return res.status(400).json({ ok: false, error: "campo 'message' obrigatório" });

  // Ferramentas disponíveis = as que o servidor local liberou na allowlist
  const list = await sendToBridge("list");
  if (!list.ok) return res.status(502).json(list);

  const tools = ((list.tools ?? []) as McpTool[]).map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: message }];

  for (let step = 1; step <= MAX_STEPS; step++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      const answer = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return res.status(200).json({ ok: true, answer, steps: step });
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const reply = await sendToBridge("call", {
        tool: block.name,
        args: (block.input ?? {}) as Record<string, unknown>,
      });
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(reply),
        is_error: !reply.ok,
      });
    }
    messages.push({ role: "user", content: results });
  }

  return res.status(200).json({ ok: false, error: `limite de ${MAX_STEPS} passos atingido` });
}
