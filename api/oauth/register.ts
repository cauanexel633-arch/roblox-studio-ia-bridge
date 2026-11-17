import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 10 };

/**
 * Registro de cliente (RFC 7591) simplificado. Não guarda nada:
 * todo cliente recebe o mesmo client_id público. A segurança vem da chave
 * digitada na tela de login e do PKCE, não do client_id.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const body = (typeof req.body === "object" && req.body ? req.body : {}) as {
    redirect_uris?: unknown;
    client_name?: unknown;
  };

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];

  res.statusCode = 201;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      client_id: "roblox-studio-public",
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: typeof body.client_name === "string" ? body.client_name : "Cliente MCP",
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    })
  );
}
