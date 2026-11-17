import { timingSafeEqual } from "crypto";
import type { IncomingHttpHeaders } from "http";

/** Compara duas strings em tempo constante. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Confere "Authorization: Bearer <segredo>". Usado pelos endpoints de teste. */
export function checkBearer(headers: IncomingHttpHeaders, secret: string | undefined): boolean {
  const header = headers.authorization;
  if (!secret || typeof header !== "string") return false;
  return safeEqual(header, `Bearer ${secret}`);
}
