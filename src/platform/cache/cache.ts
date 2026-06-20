// Cache contract modelling the Redis features the design leans on (docs/data-model.md):
//   - KV with TTL        → TAO follower price cache, idempotency markers
//   - TTL counters       → freemium token metering
//   - sorted sets        → karma leaderboards (weekly/monthly/all-time)
// The in-memory implementation makes the whole system runnable with no Redis; a Redis
// adapter implements the same interface in production.

import type { Clock } from "../clock.ts";
import { systemClock } from "../clock.ts";

export type Cache = {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs?: number): void;
  del(key: string): void;
  // Atomically increment a counter, creating it with the given ttl on first touch.
  incr(key: string, by: number, ttlMs?: number): number;
  // Sorted-set ops for leaderboards.
  zincr(set: string, member: string, by: number): number;
  zrevrange(set: string, limit: number): Array<{ member: string; score: number }>;
  zscore(set: string, member: string): number | undefined;
};

type Entry = { value: unknown; expiresAt: number | undefined };

export class MemoryCache implements Cache {
  private readonly kv = new Map<string, Entry>();
  private readonly zsets = new Map<string, Map<string, number>>();
  private readonly clock: Clock;

  constructor(clock: Clock = systemClock) {
    this.clock = clock;
  }

  private alive(entry: Entry | undefined): entry is Entry {
    if (entry === undefined) return false;
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.clock.now().getTime()) {
      return false;
    }
    return true;
  }

  get<T>(key: string): T | undefined {
    const entry = this.kv.get(key);
    if (!this.alive(entry)) {
      this.kv.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    const expiresAt = ttlMs === undefined ? undefined : this.clock.now().getTime() + ttlMs;
    this.kv.set(key, { value, expiresAt });
  }

  del(key: string): void {
    this.kv.delete(key);
  }

  incr(key: string, by: number, ttlMs?: number): number {
    const current = this.get<number>(key) ?? 0;
    const next = current + by;
    // Preserve existing expiry window; only set ttl when creating the counter.
    const existing = this.kv.get(key);
    const ttl = this.alive(existing) ? undefined : ttlMs;
    this.set(key, next, ttl);
    return next;
  }

  zincr(set: string, member: string, by: number): number {
    let z = this.zsets.get(set);
    if (z === undefined) {
      z = new Map();
      this.zsets.set(set, z);
    }
    const next = (z.get(member) ?? 0) + by;
    z.set(member, next);
    return next;
  }

  zrevrange(set: string, limit: number): Array<{ member: string; score: number }> {
    const z = this.zsets.get(set);
    if (z === undefined) return [];
    return [...z.entries()]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  zscore(set: string, member: string): number | undefined {
    return this.zsets.get(set)?.get(member);
  }
}
