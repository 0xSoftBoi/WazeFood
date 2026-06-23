// Real OIDC id_token verification (Apple / Google "Sign in with…"). The IdP is bought; this is the
// verify side SmartCart owns: validate a provider id_token by its asymmetric signature (RS256/ES256)
// against the provider's published JWKS, then check the standard claims (iss, aud, exp). Zero deps —
// node:crypto imports JWKs directly and verifies. This replaces the dev "subject|email" stand-in
// behind the AuthService.IdentityVerifier seam (docs/research/auth-and-onboarding.md).
//
// Security posture: only asymmetric algorithms are accepted (HS*/none are rejected → no alg-confusion
// where an attacker signs with the public key as an HMAC secret); JWKS refresh on unknown `kid`
// (key rotation) is rate-limited so a bogus-kid flood can't hammer the provider.

import { createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { systemClock, type Clock } from "../clock.ts";

export type Jwk = {
  kid?: string; kty: string; alg?: string; use?: string;
  n?: string; e?: string; // RSA
  crv?: string; x?: string; y?: string; // EC
};

export type JwtHeader = { alg: string; kid?: string; typ?: string };

export type IdTokenClaims = {
  iss?: string; sub?: string; aud?: string | string[];
  exp?: number; iat?: number; nbf?: number;
  email?: string; email_verified?: boolean | string; nonce?: string;
  [k: string]: unknown;
};

export type DecodedJwt = { header: JwtHeader; claims: IdTokenClaims; signingInput: string; signature: Buffer };

export type VerifiedIdentity = { subject: string; email: string | null };

// Only asymmetric algorithms — symmetric (HS*) and "none" are intentionally absent so they reject.
const ALG: Record<string, { hash: string; ec?: boolean }> = {
  RS256: { hash: "RSA-SHA256" }, RS384: { hash: "RSA-SHA384" }, RS512: { hash: "RSA-SHA512" },
  ES256: { hash: "sha256", ec: true }, ES384: { hash: "sha384", ec: true }, ES512: { hash: "sha512", ec: true },
};

export function decodeJwt(token: string): DecodedJwt | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  try {
    const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as JwtHeader;
    const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as IdTokenClaims;
    if (typeof header.alg !== "string") return null;
    return { header, claims, signingInput: `${h}.${p}`, signature: Buffer.from(s, "base64url") };
  } catch {
    return null;
  }
}

// Verify the JWT signature against a JWK. EC sigs in JOSE are raw r||s (ieee-p1363), not DER.
export function verifySignature(decoded: DecodedJwt, jwk: Jwk): boolean {
  const algo = ALG[decoded.header.alg];
  if (algo === undefined) return false;
  let key: KeyObject;
  try {
    key = createPublicKey({ key: jwk as Record<string, unknown>, format: "jwk" });
  } catch {
    return false;
  }
  try {
    const data = Buffer.from(decoded.signingInput);
    const keyArg = algo.ec ? { key, dsaEncoding: "ieee-p1363" as const } : key;
    return cryptoVerify(algo.hash, data, keyArg, decoded.signature);
  } catch {
    return false;
  }
}

export type ProviderConfig = {
  issuers: string[]; // acceptable `iss` values
  audiences: string[]; // acceptable `aud` values (your OAuth client IDs)
  jwks: JwksProvider;
};

// Validate registered claims. `aud` may be a string or array; we require an intersection with the
// configured audiences. A small clock tolerance absorbs skew between the IdP and this node.
export function validateClaims(claims: IdTokenClaims, cfg: ProviderConfig, nowSec: number, toleranceSec: number): boolean {
  if (typeof claims.sub !== "string" || claims.sub.length === 0) return false;
  if (typeof claims.iss !== "string" || !cfg.issuers.includes(claims.iss)) return false;
  const auds = Array.isArray(claims.aud) ? claims.aud : typeof claims.aud === "string" ? [claims.aud] : [];
  if (!auds.some((a) => cfg.audiences.includes(a))) return false;
  if (typeof claims.exp !== "number" || claims.exp <= nowSec - toleranceSec) return false;
  if (typeof claims.nbf === "number" && claims.nbf > nowSec + toleranceSec) return false;
  if (typeof claims.iat === "number" && claims.iat > nowSec + toleranceSec) return false;
  return true;
}

export type JwksProvider = { getKey: (kid: string | undefined) => Promise<Jwk | null> };

// Fetch a JWKS document over HTTP (the only live-network part; injected so tests stay offline).
export function httpJwksFetcher(uri: string): () => Promise<Jwk[]> {
  return async () => {
    const res = await fetch(uri, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`JWKS fetch ${res.status} ${uri}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    return body.keys ?? [];
  };
}

// Caches a provider's signing keys. Refreshes when the cache is stale (TTL) or when an unknown `kid`
// is seen (key rotation) — the latter rate-limited by minRefreshMs so a bogus-kid flood can't be a
// JWKS-amplification DoS. Concurrent refreshes are deduped to a single in-flight fetch.
export class JwksCache implements JwksProvider {
  private keys = new Map<string, Jwk>();
  private fetchedAtMs = 0;
  private inflight: Promise<void> | null = null;
  private readonly fetchKeys: () => Promise<Jwk[]>;
  private readonly ttlMs: number;
  private readonly minRefreshMs: number;
  private readonly clock: Clock;

  constructor(opts: { fetch: () => Promise<Jwk[]>; ttlMs?: number; minRefreshMs?: number; clock?: Clock }) {
    this.fetchKeys = opts.fetch;
    this.ttlMs = opts.ttlMs ?? 3_600_000; // 1h — providers publish Cache-Control ~ this
    this.minRefreshMs = opts.minRefreshMs ?? 60_000;
    this.clock = opts.clock ?? systemClock;
  }

  async getKey(kid: string | undefined): Promise<Jwk | null> {
    const sinceMs = this.clock.now().getTime() - this.fetchedAtMs;
    const fresh = sinceMs < this.ttlMs;
    const have = kid !== undefined && this.keys.has(kid);
    if (have && fresh) return this.keys.get(kid!)!;
    if (!fresh || (!have && sinceMs >= this.minRefreshMs)) await this.refresh();
    if (kid === undefined) return this.keys.size === 1 ? [...this.keys.values()][0]! : null;
    return this.keys.get(kid) ?? null;
  }

  private refresh(): Promise<void> {
    if (this.inflight !== null) return this.inflight;
    this.inflight = (async () => {
      const ks = await this.fetchKeys();
      const next = new Map<string, Jwk>();
      let i = 0;
      for (const k of ks) next.set(k.kid ?? `__nokid_${i++}`, k);
      this.keys = next;
      this.fetchedAtMs = this.clock.now().getTime();
    })();
    const done = this.inflight.finally(() => { this.inflight = null; });
    return done;
  }
}

// The IdentityVerifier the AuthService uses in production. One config per provider name.
export class OidcVerifier {
  private readonly providers: Map<string, ProviderConfig>;
  private readonly clock: Clock;
  private readonly toleranceSec: number;

  constructor(opts: { providers: Record<string, ProviderConfig>; clock?: Clock; toleranceSec?: number }) {
    this.providers = new Map(Object.entries(opts.providers));
    this.clock = opts.clock ?? systemClock;
    this.toleranceSec = opts.toleranceSec ?? 60;
  }

  async verify(provider: string, token: string): Promise<VerifiedIdentity | null> {
    const cfg = this.providers.get(provider);
    if (cfg === undefined) return null;
    const decoded = decodeJwt(token);
    if (decoded === null) return null;
    if (ALG[decoded.header.alg] === undefined) return null; // reject HS*/none (alg confusion)
    const jwk = await cfg.jwks.getKey(decoded.header.kid);
    if (jwk === null) return null;
    if (!verifySignature(decoded, jwk)) return null;
    const nowSec = Math.floor(this.clock.now().getTime() / 1000);
    if (!validateClaims(decoded.claims, cfg, nowSec, this.toleranceSec)) return null;
    return { subject: decoded.claims.sub as string, email: typeof decoded.claims.email === "string" ? decoded.claims.email : null };
  }
}

// Presets for the two providers SmartCart launches with. `audiences` = your client IDs. `fetch` is
// injectable for tests; production uses the live JWKS endpoint.
export function googleProvider(opts: { audiences: string[]; fetch?: () => Promise<Jwk[]>; clock?: Clock; ttlMs?: number }): ProviderConfig {
  return {
    issuers: ["https://accounts.google.com", "accounts.google.com"],
    audiences: opts.audiences,
    jwks: new JwksCache({ fetch: opts.fetch ?? httpJwksFetcher("https://www.googleapis.com/oauth2/v3/certs"), clock: opts.clock, ttlMs: opts.ttlMs }),
  };
}

export function appleProvider(opts: { audiences: string[]; fetch?: () => Promise<Jwk[]>; clock?: Clock; ttlMs?: number }): ProviderConfig {
  return {
    issuers: ["https://appleid.apple.com"],
    audiences: opts.audiences,
    jwks: new JwksCache({ fetch: opts.fetch ?? httpJwksFetcher("https://appleid.apple.com/auth/keys"), clock: opts.clock, ttlMs: opts.ttlMs }),
  };
}
