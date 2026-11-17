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

  if (params.grant_type !== "authorization_code") {
    return sendJson(res, 400, { error: "unsupported_grant_type" });
  }

  const code = readCode(params.code ?? "");
  if (!code) return sendJson(res, 400, { error: "invalid_grant", error_description: "código inválido ou expirado" });

  if (params.redirect_uri !== code.redirectUri) {
    return sendJson(res, 400, { error: "invalid_grant", error_description: "redirect_uri não confere" });
  }

  if (!params.code_verifier || !pkceMatches(params.code_verifier, code.codeChallenge)) {
    return sendJson(res, 400, { error: "invalid_grant", error_description: "PKCE não confere" });
  }

  return sendJson(res, 200, {
    access_token: issueAccessToken(),
    token_type: "Bearer",
    expires_in: TTL_ACCESS_SECONDS,
  });
}
