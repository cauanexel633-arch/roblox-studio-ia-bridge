import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHttpClient } from "@ably/pubsub-server";
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
  const key = process.env.ABLY_API_KEY;
  if (!machineId || !key) {
    return res.status(500).json({ error: "MACHINE_ID ou ABLY_API_KEY não configurado" });
  }

  const tokenRequest = await createHttpClient({ key }).auth.createTokenRequest({
    clientId: machineId,
    capability: JSON.stringify({
      [`cmd:${machineId}`]: ["subscribe"],
      "res:*": ["publish"],
    }),
    ttl: 60 * 60 * 1000, // 1 hora; o SDK renova sozinho
  });

  return res.status(200).json(tokenRequest);
}
