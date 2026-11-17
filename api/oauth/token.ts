import type { VercelRequest, VercelResponse } from "@vercel/node";
import { issueAccessToken, pkceMatches, readCode, TTL_ACCESS_SECONDS } from "../../lib/oauth";
import { readParams } from "../../lib/http";

export const config = { maxDuration: 10 };

function sendJson(res: VercelResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/** Troca o código de autorização (com PKCE) por um access token. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const params = await readParams(req);

  // Registros para diagnóstico. Nunca registram código, verifier nem token.
  const shape = {
    grant_type: params.grant_type ?? "(vazio)",
    code: params.code ? "presente" : "ausente",
    redirect_uri: params.redirect_uri ? "presente" : "ausente",
    code_verifier: params.code_verifier ? "presente" : "ausente",
    client_id: params.client_id ? "presente" : "ausente",
  };

  if (params.grant_type !== "authorization_code") {
    console.warn("[oauth] token: grant_type não suportado", shape);
    return sendJson(res, 400, { error: "unsupported_grant_type" });
  }

  const code = readCode(params.code ?? "");
  if (!code) {
    console.warn("[oauth] token: código inválido, ausente ou expirado", shape);
    return sendJson(res, 400, { error: "invalid_grant", error_description: "código inválido ou expirado" });
  }

  if (params.redirect_uri !== code.redirectUri) {
    console.warn("[oauth] token: redirect_uri não confere com o do código", shape);
    return sendJson(res, 400, { error: "invalid_grant", error_description: "redirect_uri não confere" });
  }

  if (!params.code_verifier || !pkceMatches(params.code_verifier, code.codeChallenge)) {
    console.warn("[oauth] token: PKCE não confere", shape);
    return sendJson(res, 400, { error: "invalid_grant", error_description: "PKCE não confere" });
  }

  console.log("[oauth] token: access token emitido", shape);

  return sendJson(res, 200, {
    access_token: issueAccessToken(),
    token_type: "Bearer",
    expires_in: TTL_ACCESS_SECONDS,
  });
}
