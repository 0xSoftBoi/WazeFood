// Redis-backed cache (write-behind + hydrate). The Cache interface is synchronous (it's on the
// hot read path), so RedisCache keeps a synchronous in-memory mirror for reads and mirrors every
// write to Redis for durability across restarts; `init()` hydrates the mirror from Redis. This
// gives single-node durability of counters/leaderboards/hot entries today; true multi-node
// distribution (async reads from Redis) is the next step. `redis` is loaded dynamically so the
// default build stays dependency-free.

import type { Cache } from "./cache.ts";
import { MemoryCache } from "./cache.ts";
import type { Clock } from "../clock.ts";
import { systemClock } from "../clock.ts";

type RedisClient = ReturnType<typeof import("redis")["createClient"]>;

export class RedisCache implements Cache {
  private readonly mirror: MemoryCache;
  private client: RedisClient | undefined;
  private pending: Array<() => Promise<unknown>> = [];
  private readonly url: string;

  constructor(url: string, clock: Clock = systemClock) {
    this.url = url;
    this.mirror = new MemoryCache(clock);
  }

  async init(): Promise<void> {
    const { createClient } = await import("redis");
    this.client = createClient({ url: this.url });
    await this.client.connect();
    // Hydrate the mirror from Redis. scanIterator yields a batch (array) of keys in redis v5+
    // and a single key in v4 — normalize to handle both.
    for await (const chunk of this.client.scanIterator()) {
      const keys = Array.isArray(chunk) ? chunk : [chunk];
      for (const key of keys) {
        const k = String(key);
        const type = await this.client.type(k);
        if (type === "zset") {
          const entries = await this.client.zRangeWithScores(k, 0, -1);
          for (const e of entries) this.mirror.zincr(k, String(e.value), Number(e.score));
        } else if (type === "string") {
          const raw = await this.client.get(k);
          if (raw !== null) {
            try {
              this.mirror.set(k, JSON.parse(raw));
            } catch {
              this.mirror.set(k, raw);
            }
          }
        }
      }
    }
  }

  private enqueue(op: () => Promise<unknown>): void {
    this.pending.push(op);
  }

  async flush(): Promise<void> {
    const ops = this.pending;
    this.pending = [];
    for (const op of ops) await op();
  }

  async close(): Promise<void> {
    await this.flush().catch(() => {});
    await this.client?.quit();
  }

  // --- Cache interface (sync reads from mirror; writes mirror + enqueue to Redis) ---
  get<T>(key: string): T | undefined {
    return this.mirror.get<T>(key);
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    this.mirror.set(key, value, ttlMs);
    const raw = JSON.stringify(value);
    this.enqueue(() => (ttlMs === undefined ? this.must().set(key, raw) : this.must().set(key, raw, { PX: ttlMs })));
  }

  del(key: string): void {
    this.mirror.del(key);
    this.enqueue(() => this.must().del(key));
  }

  incr(key: string, by: number, ttlMs?: number): number {
    const next = this.mirror.incr(key, by, ttlMs);
    const raw = JSON.stringify(next);
    this.enqueue(() => (ttlMs === undefined ? this.must().set(key, raw) : this.must().set(key, raw, { PX: ttlMs })));
    return next;
  }

  zincr(set: string, member: string, by: number): number {
    const next = this.mirror.zincr(set, member, by);
    this.enqueue(() => this.must().zIncrBy(set, by, member));
    return next;
  }

  zrevrange(set: string, limit: number): Array<{ member: string; score: number }> {
    return this.mirror.zrevrange(set, limit);
  }

  zscore(set: string, member: string): number | undefined {
    return this.mirror.zscore(set, member);
  }

  private must(): RedisClient {
    if (this.client === undefined) throw new Error("RedisCache not initialized — call init() first");
    return this.client;
  }
}
