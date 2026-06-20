// Gamification (docs/ARCHITECTURE.md §4.9). Weighted karma, badges, and Weekly/Monthly/
// All-Time leaderboards as Redis sorted sets (O(log n) updates, cheap top-N). It also owns
// the contributor *reputation* signal that the Confidence Engine consumes (Waze loop:
// reputation → confidence → which data is shown → good data earns reputation).

import type { Cache } from "../../platform/cache/cache.ts";
import type { Clock } from "../../platform/clock.ts";
import { MemoryTable } from "../../platform/store/store.ts";
import type { ContributionType } from "../../platform/events/events.ts";

// Higher-confidence contribution types earn more (the PDF's weighted karma table).
const KARMA: Record<ContributionType, number> = {
  receipt: 25,
  clearance: 20,
  shelf: 12,
  price: 8,
  coupon: 8,
  aisle: 5,
  oos: 5,
};

export type LeaderboardWindow = "weekly" | "monthly" | "alltime";

export class GamificationService {
  private readonly karma = new MemoryTable<{ id: string; total: number }>();

  private readonly deps: { cache: Cache; clock: Clock };
  constructor(deps: { cache: Cache; clock: Clock }) {
    this.deps = deps;
  }

  private windowKeys(metro: string): Record<LeaderboardWindow, string> {
    const now = this.deps.clock.now();
    const week = `${now.getUTCFullYear()}-W${Math.ceil(now.getUTCDate() / 7)}`;
    const month = now.toISOString().slice(0, 7);
    return {
      weekly: `lb:weekly:${metro}:${week}`,
      monthly: `lb:monthly:${metro}:${month}`,
      alltime: `lb:alltime:${metro}`,
    };
  }

  award(userId: string, delta: number, metro: string): number {
    const row = this.karma.get(userId);
    const total = (row?.total ?? 0) + delta;
    this.karma.upsert({ id: userId, total });
    const keys = this.windowKeys(metro);
    this.deps.cache.zincr(keys.weekly, userId, delta);
    this.deps.cache.zincr(keys.monthly, userId, delta);
    this.deps.cache.zincr(keys.alltime, userId, delta);
    return total;
  }

  // Event handler: award karma when a contribution is received, scaled by type.
  awardForContribution(userId: string, kind: ContributionType, metro: string): number {
    return this.award(userId, KARMA[kind], metro);
  }

  karmaOf(userId: string): number {
    return this.karma.get(userId)?.total ?? 0;
  }

  // Reputation in [0,1] for the Confidence Engine. Saturating curve: a contributor reaches
  // high trust around ~500 karma. New accounts start low, so their reports need corroboration.
  reputation(userId: string): number {
    const k = this.karmaOf(userId);
    return k / (k + 500);
  }

  leaderboard(window: LeaderboardWindow, metro: string, limit = 10): Array<{ userId: string; score: number }> {
    const keys = this.windowKeys(metro);
    return this.deps.cache.zrevrange(keys[window], limit).map((e) => ({ userId: e.member, score: e.score }));
  }

  // Simple badge derivation from karma (visible status; the PDF's badge list).
  badges(userId: string): string[] {
    const k = this.karmaOf(userId);
    const out: string[] = [];
    if (k >= 50) out.push("Local Grocery Guide");
    if (k >= 200) out.push("Verified Price Hunter");
    if (k >= 500) out.push("Receipt Verifier");
    return out;
  }
}
