import type { VercelRequest, VercelResponse } from "@vercel/node";
import { publicBaseUrl } from "../../lib/oauth";

/** Metadados do recurso protegido (RFC 9728): diz onde fica o servidor de login. */
export default function handler(req: VercelRequest, res: VercelResponse) {
  const base = publicBaseUrl(req);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.end(
    JSON.stringify({
      resource: `${base}/api/mcp`,
      authorization_servers: [base],
      bearer_methods_supported: ["header"],
      resource_name: "Roblox Studio",
    })
  );
}
