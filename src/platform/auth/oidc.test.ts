// Real id_token verification, tested offline: we generate RSA/EC keypairs, mint signed tokens, and
// expose the public keys as a JWKS the verifier reads through an injected fetch (no network). Covers
// the security-critical paths: good token, wrong aud/iss, expired, tampered, alg-confusion (HS/none),
// key rotation (unknown kid triggers a refresh), and the EC (ES256) curve.

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import { OidcVerifier, JwksCache, googleProvider, decodeJwt, type Jwk } from "./oidc.ts";

const NOW = new Date("2026-06-22T12:00:00Z");
const nowSec = Math.floor(NOW.getTime() / 1000);
const clock = { now: () => NOW };

function b64url(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}

// Mint a signed JWT and return it alongside the public JWK (kid-tagged) for the JWKS.
function mintRsa(claims: Record<string, unknown>, opts: { kid?: string; alg?: "RS256" } = {}) {
  const kid = opts.kid ?? "rsa-1";
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: "jwk" }) as object), kid, alg: "RS256", use: "sig" } as Jwk;
  const token = signWith(privateKey, { alg: "RS256", kid }, claims, false);
  return { token, jwk };
}

function mintEc(claims: Record<string, unknown>, kid = "ec-1") {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = { ...(publicKey.export({ format: "jwk" }) as object), kid, alg: "ES256", use: "sig" } as Jwk;
  const token = signWith(privateKey, { alg: "ES256", kid }, claims, true);
  return { token, jwk };
}

function signWith(key: KeyObject, header: { alg: string; kid: string }, claims: Record<string, unknown>, ec: boolean): string {
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const sig = ec
    ? cryptoSign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" })
    : cryptoSign("RSA-SHA256", Buffer.from(signingInput), key);
  return `${signingInput}.${sig.toString("base64url")}`;
}

const goodGoogleClaims = {
  iss: "https://accounts.google.com",
  aud: "my-client-id.apps.googleusercontent.com",
  sub: "google-user-123",
  email: "shopper@gmail.com",
  exp: nowSec + 3600,
  iat: nowSec - 5,
};

function verifierFor(jwk: Jwk, audiences = ["my-client-id.apps.googleusercontent.com"]) {
  return new OidcVerifier({
    providers: { google: googleProvider({ audiences, fetch: async () => [jwk], clock }) },
    clock,
  });
}

test("a valid Google id_token verifies and yields subject + email", async () => {
  const { token, jwk } = mintRsa(goodGoogleClaims);
  const v = await verifierFor(jwk).verify("google", token);
  assert.deepEqual(v, { subject: "google-user-123", email: "shopper@gmail.com" });
});

test("wrong audience is rejected", async () => {
  const { token, jwk } = mintRsa({ ...goodGoogleClaims, aud: "someone-elses-client" });
  assert.equal(await verifierFor(jwk).verify("google", token), null);
});

test("wrong issuer is rejected", async () => {
  const { token, jwk } = mintRsa({ ...goodGoogleClaims, iss: "https://evil.example.com" });
  assert.equal(await verifierFor(jwk).verify("google", token), null);
});

test("expired token is rejected (beyond clock tolerance)", async () => {
  const { token, jwk } = mintRsa({ ...goodGoogleClaims, exp: nowSec - 120 });
  assert.equal(await verifierFor(jwk).verify("google", token), null);
});

test("a token signed by a different key is rejected", async () => {
  const { token } = mintRsa(goodGoogleClaims); // signed by key A
  const { jwk: otherJwk } = mintRsa(goodGoogleClaims, { kid: "rsa-1" }); // JWKS serves key B, same kid
  assert.equal(await verifierFor(otherJwk).verify("google", token), null);
});

test("a tampered payload is rejected", async () => {
  const { token, jwk } = mintRsa(goodGoogleClaims);
  const [h, , s] = token.split(".");
  const forged = `${h}.${b64url({ ...goodGoogleClaims, sub: "attacker" })}.${s}`;
  assert.equal(await verifierFor(jwk).verify("google", forged), null);
});

test("alg confusion: an HS256 / none token is rejected outright", async () => {
  const { jwk } = mintRsa(goodGoogleClaims);
  const hsToken = `${b64url({ alg: "HS256", kid: "rsa-1" })}.${b64url(goodGoogleClaims)}.${Buffer.from("x").toString("base64url")}`;
  const noneToken = `${b64url({ alg: "none", kid: "rsa-1" })}.${b64url(goodGoogleClaims)}.`;
  assert.equal(await verifierFor(jwk).verify("google", hsToken), null);
  assert.equal(await verifierFor(jwk).verify("google", noneToken), null);
});

test("an unknown provider is rejected", async () => {
  const { token, jwk } = mintRsa(goodGoogleClaims);
  assert.equal(await verifierFor(jwk).verify("facebook", token), null);
});

test("ES256 (EC) tokens verify too", async () => {
  const { token, jwk } = mintEc({ ...goodGoogleClaims, sub: "ec-user" });
  const v = await verifierFor(jwk).verify("google", token);
  assert.deepEqual(v, { subject: "ec-user", email: "shopper@gmail.com" });
});

test("JwksCache refreshes when an unknown kid appears (key rotation)", async () => {
  let serving: Jwk[] = [];
  let fetches = 0;
  const cache = new JwksCache({ fetch: async () => { fetches++; return serving; }, clock, minRefreshMs: 0 });

  const { jwk: k1 } = mintRsa(goodGoogleClaims, { kid: "old" });
  serving = [k1];
  assert.equal((await cache.getKey("old"))?.kid, "old");
  assert.equal(fetches, 1);

  // Provider rotates to a new kid; the cache must refetch to find it.
  const { jwk: k2 } = mintRsa(goodGoogleClaims, { kid: "new" });
  serving = [k2];
  assert.equal((await cache.getKey("new"))?.kid, "new");
  assert.equal(fetches, 2, "unknown kid triggered exactly one refresh");
});

test("decodeJwt returns null on malformed input", () => {
  assert.equal(decodeJwt("not-a-jwt"), null);
  assert.equal(decodeJwt("a.b"), null);
});
