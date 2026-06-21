// Auth & sessions (docs/research/auth-and-onboarding.md). The IdP (Apple/Google/Firebase) is
// bought; this is the thin layer SmartCart owns: mint short-lived access JWTs + rotating refresh
// tokens with reuse detection and per-device revocation, verify a provider token through a
// pluggable seam, and — the make-or-break of anonymous-first — upgrade a guest account IN PLACE
// so all their lists/karma/referrals carry over.

import { createHash, randomBytes } from "node:crypto";
import type { Clock } from "../../platform/clock.ts";
import type { Table, TableFactory } from "../../platform/store/store.ts";
import { newId } from "../../platform/id.ts";
import { signHs256, verifyHs256 } from "../../platform/auth/jwt.ts";

export type Session = {
  id: string; // sid
  userId: string;
  deviceId: string;
  currentRefreshHash: string;
  usedHashes: string[];
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
};

export type Identity = {
  id: string; // `${provider}:${subject}`
  userId: string;
  provider: string;
  subject: string;
  email: string | null;
  linkedAt: string;
};

export type Tokens = { accessToken: string; refreshToken: string; expiresInSec: number; userId: string };

// Verifies a provider id_token. Dev verifier decodes "subject|email"; production swaps in
// Apple/Google JWKS (RS256) verification behind this same interface.
export type IdentityVerifier = { verify: (provider: string, token: string) => { subject: string; email: string | null } | null };

export const devVerifier: IdentityVerifier = {
  verify: (_provider, token) => {
    const [subject, email] = token.split("|");
    if (subject === undefined || subject.length === 0) return null;
    return { subject, email: email ?? null };
  },
};

export type IdentityPort = {
  getUser: (id: string) => { id: string } | undefined;
  createAnonymousUser: (input: { metro?: string; deviceId?: string }) => { id: string };
  attachAuth: (userId: string, provider: string) => unknown;
};

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export class AuthService {
  private readonly sessions: Table<Session>;
  private readonly identities: Table<Identity>;
  private readonly deps: {
    tables: TableFactory; clock: Clock; identity: IdentityPort; verifier: IdentityVerifier;
    accessSecret: string; accessTtlSec: number; refreshTtlSec: number;
  };

  constructor(deps: {
    tables: TableFactory; clock: Clock; identity: IdentityPort; verifier: IdentityVerifier;
    accessSecret: string; accessTtlSec: number; refreshTtlSec: number;
  }) {
    this.deps = deps;
    this.sessions = deps.tables<Session>("sessions");
    this.identities = deps.tables<Identity>("identities");
  }

  private nowSec(): number { return Math.floor(this.deps.clock.now().getTime() / 1000); }

  private issue(userId: string, deviceId: string): Tokens {
    const now = this.nowSec();
    const sid = newId("sess");
    const refresh = randomBytes(32).toString("base64url");
    this.sessions.insert({
      id: sid,
      userId,
      deviceId,
      currentRefreshHash: sha256(refresh),
      usedHashes: [],
      createdAt: new Date(now * 1000).toISOString(),
      expiresAt: new Date((now + this.deps.refreshTtlSec) * 1000).toISOString(),
      revoked: false,
    });
    const accessToken = signHs256({ sub: userId, sid, iat: now, exp: now + this.deps.accessTtlSec }, this.deps.accessSecret);
    return { accessToken, refreshToken: refresh, expiresInSec: this.deps.accessTtlSec, userId };
  }

  // Anonymous-first: start a guest session with no identity (data accrues to this userId).
  anonymous(input: { metro?: string; deviceId?: string }): Tokens {
    const user = this.deps.identity.createAnonymousUser(input);
    return this.issue(user.id, input.deviceId ?? "unknown");
  }

  // Verify an access token. Stateless + a cheap revocation/expiry check so logout is effective.
  verifyAccess(token: string): { userId: string; sid: string } | null {
    const payload = verifyHs256(token, this.deps.accessSecret, this.nowSec());
    if (payload === null) return null;
    const session = this.sessions.get(payload.sid);
    if (session === undefined || session.revoked) return null;
    return { userId: payload.sub, sid: payload.sid };
  }

  // Rotate the refresh token; detect reuse of an already-rotated token and revoke the session.
  refresh(refreshToken: string): { ok: true; tokens: Tokens } | { ok: false; error: "invalid" | "expired" | "reuse_detected" } {
    const hash = sha256(refreshToken);
    const active = this.sessions.findOne((s) => s.currentRefreshHash === hash);
    if (active !== undefined) {
      if (active.revoked) return { ok: false, error: "invalid" };
      if (new Date(active.expiresAt).getTime() <= this.deps.clock.now().getTime()) return { ok: false, error: "expired" };
      const newRefresh = randomBytes(32).toString("base64url");
      const used = [...active.usedHashes, hash].slice(-10);
      this.sessions.update(active.id, { currentRefreshHash: sha256(newRefresh), usedHashes: used });
      const now = this.nowSec();
      const accessToken = signHs256({ sub: active.userId, sid: active.id, iat: now, exp: now + this.deps.accessTtlSec }, this.deps.accessSecret);
      return { ok: true, tokens: { accessToken, refreshToken: newRefresh, expiresInSec: this.deps.accessTtlSec, userId: active.userId } };
    }
    // Presenting a previously-rotated token = theft → revoke the whole session (token family).
    const reused = this.sessions.findOne((s) => s.usedHashes.includes(hash));
    if (reused !== undefined) {
      this.sessions.update(reused.id, { revoked: true });
      return { ok: false, error: "reuse_detected" };
    }
    return { ok: false, error: "invalid" };
  }

  revoke(sid: string): void { this.sessions.update(sid, { revoked: true }); }

  sessionsForUser(userId: string): Session[] { return this.sessions.find((s) => s.userId === userId && !s.revoked); }

  // Upgrade: a guest signs in with a provider. If the identity is new, link it to the SAME guest
  // user (data preserved). If it already belongs to someone, sign in to that account.
  link(input: { userId: string; provider: string; token: string; deviceId?: string }):
    | { ok: true; tokens: Tokens; upgraded: boolean; signedInToExisting: boolean }
    | { ok: false; error: "invalid_token" } {
    const verified = this.deps.verifier.verify(input.provider, input.token);
    if (verified === null) return { ok: false, error: "invalid_token" };

    const key = `${input.provider}:${verified.subject}`;
    const existing = this.identities.get(key);
    const deviceId = input.deviceId ?? "unknown";

    if (existing !== undefined && existing.userId !== input.userId) {
      // Identity belongs to another account → sign in to it (guest data is left as-is).
      return { ok: true, tokens: this.issue(existing.userId, deviceId), upgraded: false, signedInToExisting: true };
    }
    if (existing === undefined) {
      this.identities.insert({
        id: key, userId: input.userId, provider: input.provider, subject: verified.subject,
        email: verified.email, linkedAt: new Date().toISOString(),
      });
      this.deps.identity.attachAuth(input.userId, input.provider);
    }
    // Same user (new link or re-link) → fresh session on the SAME userId; all their data carries over.
    return { ok: true, tokens: this.issue(input.userId, deviceId), upgraded: existing === undefined, signedInToExisting: false };
  }
}
