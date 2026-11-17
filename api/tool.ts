import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkBearer } from "../lib/auth";
import { sendToBridge } from "../lib/bridge";

export const config = { maxDuration: 30 };

/**
 * Endpoint direto: executa uma ferramenta no Studio.
 * POST /api/tool  { "tool": "nome", "args": { ... } }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  if (!checkBearer(req.headers, process.env.API_SECRET)) return res.status(401).end();

  const { tool, args } = (req.body ?? {}) as { tool?: string; args?: Record<string, unknown> };
  if (!tool) return res.status(400).json({ ok: false, error: "campo 'tool' obrigatório" });

  const reply = await sendToBridge("call", { tool, args: args ?? {} });
  return res.status(reply.ok ? 200 : 502).json(reply);
}
