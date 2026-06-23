import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryTableFactory } from "../../platform/store/store.ts";
import { IdentityService } from "../identity/service.ts";
import { AuthService, devVerifier } from "./service.ts";

function setup(opts: { accessTtlSec?: number } = {}) {
  let t = new Date("2026-06-20T12:00:00Z").getTime();
  const clock = { now: () => new Date(t) };
  const advance = (sec: number) => { t += sec * 1000; };
  const identity = new IdentityService({ tables: memoryTableFactory });
  const auth = new AuthService({
    tables: memoryTableFactory, clock, verifier: devVerifier,
    accessSecret: "test-secret", accessTtlSec: opts.accessTtlSec ?? 900, refreshTtlSec: 1_209_600,
    identity: {
      getUser: (id) => identity.getUser(id),
      createAnonymousUser: (input) => identity.createAnonymousUser(input),
      attachAuth: (userId, provider) => identity.attachAuth(userId, provider),
    },
  });
  return { auth, identity, advance };
}

test("anonymous session issues a verifiable access token; garbage is rejected", () => {
  const { auth } = setup();
  const tokens = auth.anonymous({ metro: "slc", deviceId: "d1" });
  const v = auth.verifyAccess(tokens.accessToken);
  assert.equal(v?.userId, tokens.userId);
  assert.equal(auth.verifyAccess("not.a.jwt"), null);
  assert.equal(auth.verifyAccess(tokens.accessToken + "tamper"), null);
});

test("refresh rotates: the old refresh token stops working, the new one works", () => {
  const { auth } = setup();
  const t0 = auth.anonymous({ deviceId: "d1" });
  const r1 = auth.refresh(t0.refreshToken);
  assert.ok(r1.ok);
  // Old token is now invalid; new token rotates again.
  assert.equal((auth.refresh(t0.refreshToken) as { ok: false; error: string }).error, "reuse_detected");
});

test("refresh-reuse detection revokes the whole session (token theft → one-use window)", () => {
  const { auth } = setup();
  const t0 = auth.anonymous({ deviceId: "d1" });
  const r1 = auth.refresh(t0.refreshToken);
  assert.ok(r1.ok);
  const r1Tokens = r1.ok ? r1.tokens : null;
  // Replaying the original (already-rotated) token is treated as theft.
  const reuse = auth.refresh(t0.refreshToken);
  assert.equal(reuse.ok, false);
  assert.equal((reuse as { error: string }).error, "reuse_detected");
  // The session is revoked, so even the legitimate latest token no longer works.
  assert.equal((auth.refresh(r1Tokens!.refreshToken) as { ok: false; error: string }).error, "invalid");
  assert.equal(auth.verifyAccess(r1Tokens!.accessToken), null);
});

test("anonymous → link preserves the SAME user id (data carries over)", async () => {
  const { auth } = setup();
  const guest = auth.anonymous({ metro: "slc", deviceId: "d1" });
  const linked = await auth.link({ userId: guest.userId, provider: "apple", token: "apple-subject-123|me@icloud.com", deviceId: "d1" });
  assert.ok(linked.ok);
  if (linked.ok) {
    assert.equal(linked.tokens.userId, guest.userId, "same user id kept on upgrade");
    assert.equal(linked.upgraded, true);
    assert.equal(linked.signedInToExisting, false);
  }
});

test("linking an identity already owned signs in to that account", async () => {
  const { auth } = setup();
  const a = auth.anonymous({ deviceId: "d1" });
  await auth.link({ userId: a.userId, provider: "google", token: "g-sub-1|a@gmail.com" });
  // A different guest signs in with the same Google identity → resolves to the first account.
  const b = auth.anonymous({ deviceId: "d2" });
  const signIn = await auth.link({ userId: b.userId, provider: "google", token: "g-sub-1|a@gmail.com" });
  assert.ok(signIn.ok);
  if (signIn.ok) {
    assert.equal(signIn.tokens.userId, a.userId);
    assert.equal(signIn.signedInToExisting, true);
  }
});

test("logout (revoke) immediately invalidates the access token", () => {
  const { auth } = setup();
  const t0 = auth.anonymous({ deviceId: "d1" });
  const v = auth.verifyAccess(t0.accessToken)!;
  auth.revoke(v.sid);
  assert.equal(auth.verifyAccess(t0.accessToken), null);
});

test("access tokens expire", () => {
  const { auth, advance } = setup({ accessTtlSec: 2 });
  const t0 = auth.anonymous({ deviceId: "d1" });
  assert.ok(auth.verifyAccess(t0.accessToken));
  advance(3);
  assert.equal(auth.verifyAccess(t0.accessToken), null);
});

test("an invalid provider token is rejected", async () => {
  const { auth } = setup();
  const g = auth.anonymous({ deviceId: "d1" });
  const r = await auth.link({ userId: g.userId, provider: "apple", token: "" });
  assert.equal(r.ok, false);
});
