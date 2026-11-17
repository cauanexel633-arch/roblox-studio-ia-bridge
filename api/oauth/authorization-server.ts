import type { VercelRequest, VercelResponse } from "@vercel/node";
import { publicBaseUrl } from "../../lib/oauth";

/** Metadados do servidor de autorização (RFC 8414). */
export default function handler(req: VercelRequest, res: VercelResponse) {
  const base = publicBaseUrl(req);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.end(
    JSON.stringify({
      issuer: base,
      authorization_endpoint: `${base}/api/oauth/authorize`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    })
  );
}
