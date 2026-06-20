// Entitlements & Metering (docs/ARCHITECTURE.md §4.7). The single place that answers
// "can this user do this?" — plan + earned Premium + token buckets. Every gated feature
// checks here, so gating logic lives once (the 中台/复用 idea, proven-patterns-east.md §8).
// Token buckets are TTL counters (the Redis pattern); a durable ledger would audit them.

import type { Cache } from "../../platform/cache/cache.ts";
import type { Clock } from "../../platform/clock.ts";
import { err, ok, type Result } from "../../platform/result.ts";
import { MemoryTable } from "../../platform/store/store.ts";

export type Feature = "item_compare" | "cart_optimize" | "image_search" | "route" | "price_alert";

// Free monthly allowances; Premium is unlimited. Mirrors the PDF's feature matrix.
const FREE_LIMITS: Record<Feature, number> = {
  item_compare: 10,
  cart_optimize: 3,
  image_search: 3,
  route: 1,
  price_alert: 3,
};

export type Grant = { id: string; userId: string; feature: string; source: string; expiresAt: string | null };

export type CheckResult = { allowed: true; remaining: number | "unlimited" };

export class EntitlementsService {
  private readonly premiumUntil = new MemoryTable<{ id: string; until: string }>();
  private readonly grants = new MemoryTable<Grant>();

  private readonly deps: { cache: Cache; clock: Clock };
  constructor(deps: { cache: Cache; clock: Clock }) {
    this.deps = deps;
  }

  private period(): string {
    return this.deps.clock.now().toISOString().slice(0, 7); // YYYY-MM
  }

  isPremium(userId: string): boolean {
    const row = this.premiumUntil.get(userId);
    if (row === undefined) return false;
    return new Date(row.until).getTime() > this.deps.clock.now().getTime();
  }

  // Grant Premium for N days (subscription, referral reward, contributor reward, tip).
  grantPremiumDays(userId: string, days: number, source: string): void {
    const base = Math.max(this.deps.clock.now().getTime(), this.currentPremiumMs(userId));
    const until = new Date(base + days * 86_400_000).toISOString();
    this.premiumUntil.upsert({ id: userId, until });
    this.grants.insert({ id: `${userId}|${source}|${until}`, userId, feature: "premium", source, expiresAt: until });
  }

  private currentPremiumMs(userId: string): number {
    const row = this.premiumUntil.get(userId);
    return row === undefined ? 0 : new Date(row.until).getTime();
  }

  // Consume one unit of a gated feature. Premium → always allowed. Free → metered.
  consume(userId: string, feature: Feature): Result<CheckResult, { code: "payment_required"; remaining: 0 }> {
    if (this.isPremium(userId)) return ok({ allowed: true, remaining: "unlimited" });
    const limit = FREE_LIMITS[feature];
    const key = `meter:${userId}:${feature}:${this.period()}`;
    const used = this.deps.cache.get<number>(key) ?? 0;
    if (used >= limit) return err({ code: "payment_required", remaining: 0 });
    this.deps.cache.incr(key, 1, 32 * 86_400_000); // ~1 month TTL
    return ok({ allowed: true, remaining: limit - used - 1 });
  }

  status(userId: string): { plan: "free" | "premium"; premiumUntil: string | null; usage: Record<Feature, number> } {
    const usage = {} as Record<Feature, number>;
    for (const f of Object.keys(FREE_LIMITS) as Feature[]) {
      usage[f] = this.deps.cache.get<number>(`meter:${userId}:${f}:${this.period()}`) ?? 0;
    }
    const row = this.premiumUntil.get(userId);
    return {
      plan: this.isPremium(userId) ? "premium" : "free",
      premiumUntil: row?.until ?? null,
      usage,
    };
  }
}
