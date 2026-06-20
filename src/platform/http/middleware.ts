// Gateway middleware. Anonymous-first identity + a Cloudflare-style edge rate limit that is
// the first line of anti-scraping defense (docs/proven-patterns.md §4). A real deployment
// adds device attestation + H3 geo-coherence scoring on top of this same hook.

import type { Cache } from "../cache/cache.ts";
import { rateLimited } from "../errors.ts";
import type { Ctx, Middleware } from "./router.ts";

function header(ctx: Ctx, name: string): string | undefined {
  const v = ctx.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

// Attaches deviceId (anonymous-ok) and userId (when a session token is present). The token
// scheme is intentionally trivial here — swap for OIDC/JWT verification in production.
export function identity(): Middleware {
  return async (ctx, next) => {
    ctx.deviceId = header(ctx, "x-device-id") ?? "anon-device";
    const auth = header(ctx, "authorization");
    if (auth?.startsWith("Bearer user:")) {
      ctx.userId = auth.slice("Bearer user:".length);
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
