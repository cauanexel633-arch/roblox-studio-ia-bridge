import type { VercelRequest, VercelResponse } from "@vercel/node";
import { safeEqual } from "../../lib/auth";
import { issueCode } from "../../lib/oauth";
import { escapeHtml, readParams } from "../../lib/http";

export const config = { maxDuration: 10 };

const OAUTH_FIELDS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "state",
  "code_challenge",
  "code_challenge_method",
] as const;

function isValidRedirect(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  } catch {
    return false;
  }
}

function loginPage(params: Record<string, string>, error?: string): string {
  const hidden = OAUTH_FIELDS.map(
    (f) => `<input type="hidden" name="${f}" value="${escapeHtml(params[f] ?? "")}">`
  ).join("\n      ");

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Conectar ao Roblox Studio</title>
  <style>
    :root { color-scheme: light dark; --bg:#f6f6f7; --card:#fff; --fg:#17171a; --muted:#6b6b76; --accent:#2563eb; --err:#b91c1c; }
    @media (prefers-color-scheme: dark) { :root { --bg:#111114; --card:#1c1c21; --fg:#f2f2f5; --muted:#9a9aa6; --accent:#60a5fa; --err:#f87171; } }
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg); font-family:system-ui,-apple-system,Segoe UI,sans-serif; padding:16px; box-sizing:border-box; }
    .card { width:100%; max-width:380px; background:var(--card); border-radius:14px; padding:28px; box-shadow:0 8px 30px rgba(0,0,0,.12); }
    h1 { font-size:1.25rem; margin:0 0 6px; }
    p { color:var(--muted); margin:0 0 20px; line-height:1.45; font-size:.95rem; }
    label { display:block; font-size:.9rem; margin-bottom:6px; }
    input[type=password] { width:100%; box-sizing:border-box; padding:12px; font-size:1rem; border:1px solid #8884; border-radius:10px; background:transparent; color:var(--fg); }
    button { margin-top:16px; width:100%; padding:12px; font-size:1rem; font-weight:600; border:0; border-radius:10px; background:var(--accent); color:#fff; cursor:pointer; }
    .error { color:var(--err); margin:0 0 14px; font-size:.9rem; }
  </style>
</head>
<body>
  <main class="card">
    <h1>Conectar ao Roblox Studio</h1>
    <p>Digite a chave de acesso do seu servidor para autorizar esta IA a usar o Studio.</p>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <form method="POST" action="">
      ${hidden}
      <label for="key">Chave de acesso</label>
      <input id="key" name="key" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">Autorizar</button>
    </form>
  </main>
</body>
</html>`;
}

function sendHtml(res: VercelResponse, status: number, html: string) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(html);
}

/**
 * Tela de login OAuth. GET mostra o formulário; POST confere a chave e
 * devolve o navegador para o redirect_uri com um código de uso único (PKCE).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).end();
  }

  const params = await readParams(req);

  if (
    params.response_type !== "code" ||
    !params.client_id ||
    !params.redirect_uri ||
    !isValidRedirect(params.redirect_uri) ||
    !params.code_challenge ||
    params.code_challenge_method !== "S256"
  ) {
    return sendHtml(res, 400, "<!doctype html><meta charset=utf-8><p>Requisição OAuth inválida.</p>");
  }

  if (req.method === "GET") {
    return sendHtml(res, 200, loginPage(params));
  }

  const secret = process.env.API_SECRET;
  if (!secret || !safeEqual(params.key ?? "", secret)) {
    return sendHtml(res, 401, loginPage(params, "Chave incorreta."));
  }

  const code = issueCode({
    redirectUri: params.redirect_uri,
    codeChallenge: params.code_challenge,
    clientId: params.client_id,
  });

  const target = new URL(params.redirect_uri);
  target.searchParams.set("code", code);
  if (params.state) target.searchParams.set("state", params.state);

  res.statusCode = 302;
  res.setHeader("Location", target.toString());
  res.setHeader("Cache-Control", "no-store");
  return res.end();
}
