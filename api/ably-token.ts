import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHttpClient } from "@ably/pubsub-server";
import { checkBearer } from "../lib/auth";

/**
 * Token do agente local. O manager recebe health e publica health-res;
 * o worker recebe cmd e publica res.
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
      [`health:${machineId}`]: ["subscribe"],
      "res:*": ["publish"],
      "health-res:*": ["publish"],
    }),
    ttl: 60 * 60 * 1000,
  });

  return res.status(200).json(tokenRequest);
}
