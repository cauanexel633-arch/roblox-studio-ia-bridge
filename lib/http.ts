import type { IncomingMessage } from "http";

/**
 * Lê parâmetros de um formulário (application/x-www-form-urlencoded) ou da query,
 * funcionando tanto se o Vercel já tiver parseado o body quanto se não tiver.
 */
export async function readParams(req: IncomingMessage & { body?: unknown; query?: unknown }): Promise<Record<string, string>> {
  if (req.method === "GET") {
    return Object.fromEntries(
      Object.entries((req.query ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")])
    );
  }

  if (req.body && typeof req.body === "object") {
    return Object.fromEntries(
      Object.entries(req.body as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")])
    );
  }

  let raw = typeof req.body === "string" ? req.body : "";
  if (!raw) {
    for await (const chunk of req) raw += chunk;
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
