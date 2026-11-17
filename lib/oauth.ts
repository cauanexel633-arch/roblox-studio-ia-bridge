import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { IncomingMessage } from "http";

/**
 * OAuth stateless: códigos e tokens são strings assinadas (HMAC) com uma chave
 * derivada do API_SECRET. Assim não precisamos de banco. Trocar o API_SECRET
 * invalida todos os tokens emitidos.
 */

export const TTL_CODE_SECONDS = 5 * 60;
export const TTL_ACCESS_SECONDS = 30 * 24 * 60 * 60;

type Payload = { typ: "code" | "access"; exp: number; [key: string]: unknown };

function signingKey(): Buffer {
  const secret = process.env.API_SECRET;
  if (!secret) throw new Error("API_SECRET não configurado");
  return createHash("sha256").update(`oauth-v1:${secret}`).digest();
}

function sign(payload: Payload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", signingKey()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify(token: string, typ: Payload["typ"]): Payload | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;

  const expected = createHmac("sha256", signingKey()).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (payload.typ !== typ) return null;
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

export function issueCode(data: { redirectUri: string; codeChallenge: string; clientId: string }): string {
  return sign({
    typ: "code",
    exp: nowSeconds() + TTL_CODE_SECONDS,
    ru: data.redirectUri,
    cc: data.codeChallenge,
    cid: data.clientId,
  });
}

export function readCode(code: string): { redirectUri: string; codeChallenge: string; clientId: string } | null {
  const p = verify(code, "code");
  if (!p || typeof p.ru !== "string" || typeof p.cc !== "string" || typeof p.cid !== "string") return null;
  return { redirectUri: p.ru, codeChallenge: p.cc, clientId: p.cid };
}

export function issueAccessToken(): string {
  return sign({ typ: "access", exp: nowSeconds() + TTL_ACCESS_SECONDS });
}

export function isValidAccessToken(token: string): boolean {
  return verify(token, "access") !== null;
}

/** PKCE (S256): base64url(sha256(verifier)) deve bater com o code_challenge. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return computed.length === challenge.length && timingSafeEqual(Buffer.from(computed), Buffer.from(challenge));
}

/** URL pública do deploy (ex.: https://projeto.vercel.app). */
export function publicBaseUrl(req: IncomingMessage): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const host = req.headers.host ?? "localhost";
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  return `${proto}://${host}`;
}
