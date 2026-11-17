import type { VercelRequest, VercelResponse } from "@vercel/node";
import Ably from "ably";
import { checkBearer } from "../lib/auth";

/**
 * Emite um token Ably com permissão restrita para o servidor local:
 * só pode assinar o próprio canal de comandos e publicar respostas.
 * A chave principal do Ably nunca sai do Vercel.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!checkBearer(req.headers, process.env.MACHINE_TOKEN)) {
    return res.status(401).end();
  }

  const machineId = process.env.MACHINE_ID;
  if (!machineId) return res.status(500).json({ error: "MACHINE_ID não configurado" });

  const rest = new Ably.Rest({ key: process.env.ABLY_API_KEY! });
  const tokenRequest = await rest.auth.createTokenRequest({
    clientId: machineId,
    capability: JSON.stringify({
      [`cmd:${machineId}`]: ["subscribe"],
      "res:*": ["publish"],
    }),
    ttl: 60 * 60 * 1000, // 1 hora; o SDK renova sozinho
  });

  return res.status(200).json(tokenRequest);
}
