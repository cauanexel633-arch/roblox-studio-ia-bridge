import { timingSafeEqual } from "crypto";
import type { IncomingHttpHeaders } from "http";

/** Confere "Authorization: Bearer <segredo>" em tempo constante. */
export function checkBearer(headers: IncomingHttpHeaders, secret: string | undefined): boolean {
  const header = headers.authorization;
  if (!secret || typeof header !== "string") return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
