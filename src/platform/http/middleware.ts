// Gateway middleware. Anonymous-first identity + a Cloudflare-style edge rate limit that is
// the first line of anti-scraping defense (docs/proven-patterns.md §4). A real deployment
// adds device attestation + H3 geo-coherence scoring on top of this same hook.

import type { Cache } from "../cache/cache.ts";
import { rateLimited } from "../errors.ts";
import type { Ctx, Middleware } from "./router.ts";
import type { AbuseScoreService } from "../../modules/abuse/service.ts";

function header(ctx: Ctx, name: string): string | undefined {
  const v = ctx.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

// Attaches deviceId (anonymous-ok) and userId (when a valid access JWT is present). Anonymous-
// first: a missing/invalid token simply leaves userId null — the request still proceeds.
export function identity(verifyAccess?: (token: string) => { userId: string } | null): Middleware {
  return async (ctx, next) => {
    ctx.deviceId = header(ctx, "x-device-id") ?? "anon-device";
    const authz = header(ctx, "authorization");
    if (authz?.startsWith("Bearer ") && verifyAccess !== undefined) {
      const result = verifyAccess(authz.slice("Bearer ".length));
      if (result !== null) ctx.userId = result.userId;
    }
    return next();
  };
}

// Sliding-window-ish per-device rate limit using a TTL counter (the Redis pattern).
export function rateLimit(cache: Cache, perMinute: number): Middleware {
  return async (ctx, next) => {
    const windowKey = `ratelimit:${ctx.deviceId}:${Math.floor(Date.now() / 60_000)}`;
    const count = cache.incr(windowKey, 1, 60_000);
    if (count > perMinute) {
      throw rateLimited(`rate limit exceeded (${perMinute}/min)`);
    }
    return next();
  };
}

function field(ctx: Ctx, name: string): string | undefined {
  const fromQuery = ctx.query.get(name);
  if (fromQuery !== null) return fromQuery;
  const body = ctx.body;
  if (body !== null && typeof body === "object" && name in body) {
    const v = (body as Record<string, unknown>)[name];
    return typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
  }
  return undefined;
}

// Anti-scraping guard: scores each request on velocity + H3 geo-coherence + honeytokens and
// acts on the decision (docs/research/anti-scraping.md). The heavy edge signals (JA4, DDoS) are
// the CDN/WAF's job; this is the domain-specific layer. Sets x-abuse-score for observability.
export function abuseGuard(abuse: AbuseScoreService): Middleware {
  return async (ctx, next) => {
    const latRaw = field(ctx, "lat");
    const lngRaw = field(ctx, "lng");
    const lat = latRaw === undefined ? undefined : Number(latRaw);
    const lng = lngRaw === undefined ? undefined : Number(lngRaw);
    const result = abuse.score({
      deviceId: ctx.deviceId,
      userId: ctx.userId,
      route: ctx.path,
      productId: field(ctx, "productId") ?? null,
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
    });

    if (result.decision === "block") {
      return { status: 403, body: { error: "forbidden", message: "request blocked", reasons: result.reasons }, headers: { "x-abuse-score": String(result.score) } };
    }
    if (result.decision === "challenge") {
      return { status: 429, body: { error: "challenge_required", message: "verify you are human", reasons: result.reasons }, headers: { "x-abuse-score": String(result.score) } };
    }
    const reply = await next();
    return { ...reply, headers: { ...(reply.headers ?? {}), "x-abuse-score": String(result.score) } };
  };
}
