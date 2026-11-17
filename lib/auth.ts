import { timingSafeEqual } from "crypto";
import type { IncomingHttpHeaders } from "http";

/** Compara duas strings em tempo constante. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Confere "Authorization: Bearer <segredo>". */
export function checkBearer(headers: IncomingHttpHeaders, secret: string | undefined): boolean {
  const header = headers.authorization;
  if (!secret || typeof header !== "string") return false;
  return safeEqual(header, `Bearer ${secret}`);
}

/**
 * Confere o segredo no cabeçalho OU na query string (?key=...).
 * A query existe porque conectores de IA nem sempre permitem cabeçalhos customizados.
 */
export function checkSecret(
  headers: IncomingHttpHeaders,
  query: Record<string, unknown>,
  secret: string | undefined
): boolean {
  if (!secret) return false;
  if (checkBearer(headers, secret)) return true;
  const key = query.key;
  return typeof key === "string" && safeEqual(key, secret);
}
