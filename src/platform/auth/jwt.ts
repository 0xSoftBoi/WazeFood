// Minimal HS256 JWT using node:crypto (no dependency). Access tokens are short-lived and signed;
// production would verify provider id_tokens against JWKS (RS256) — same verify shape, different key.

import { createHmac, timingSafeEqual } from "node:crypto";

export type JwtPayload = { sub: string; sid: string; iat: number; exp: number } & Record<string, unknown>;

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

export function signHs256(payload: JwtPayload, secret: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyHs256(token: string, secret: string, nowSec: number): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];
  const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: JwtPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as JwtPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp === "number" && payload.exp <= nowSec) return null;
  return payload;
}
