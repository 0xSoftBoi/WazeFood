// Redis-backed cache. The Cache interface is synchronous (it's on the hot read path), so RedisCache
// keeps a synchronous in-memory mirror as an L1 cache and reconciles with Redis as the source of
// truth:
//   - writes are AUTHORITATIVE and atomic server-side — counters use INCRBY (not SET-of-local), so
//     two nodes incrementing the same key aggregate correctly instead of clobbering each other;
//     leaderboards use ZINCRBY. This is the multi-node correctness fix.
//   - a periodic refresh() flushes pending ops then re-hydrates the L1 mirror from Redis, so each
//     node sees the others' writes (eventually-consistent reads; a production deployment would swap
//     polling for keyspace-notification invalidation).
// `redis` is loaded dynamically so the default build stays dependency-free; the client is injectable
// for offline tests.

import type { Cache } from "./cache.ts";
import { MemoryCache } from "./cache.ts";
import type { Clock } from "../clock.ts";
import { systemClock } from "../clock.ts";

// The subset of the redis client we use — also the seam tests inject a fake through.
export type RedisLike = {
  connect: () => Promise<void>;
  quit: () => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  set: (key: string, val: string, opts?: { PX?: number }) => Promise<unknown>;
  del: (key: string) => Promise<unknown>;
  incrBy: (key: string, by: number) => Promise<number>;
  pExpire: (key: string, ms: number) => Promise<unknown>;
  zIncrBy: (set: string, by: number, member: string) => Promise<unknown>;
  zRangeWithScores: (key: string, start: number, stop: number) => Promise<Array<{ value: string; score: number }>>;
  type: (key: string) => Promise<string>;
  scanIterator: () => AsyncIterable<string | string[]>;
};

export type RedisCacheDeps = { createClient?: (url: string) => RedisLike; refreshIntervalMs?: number };

export class RedisCache implements Cache {
  private mirror: MemoryCache;
  private client: RedisLike | undefined;
  private pending: Array<() => Promise<unknown>> = [];
  private readonly url: string;
  private readonly clock: Clock;
  private readonly injectedCreate: ((url: string) => RedisLike) | undefined;
  private readonly refreshIntervalMs: number;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;

  constructor(url: string, clock: Clock = systemClock, deps: RedisCacheDeps = {}) {
    this.url = url;
    this.clock = clock;
    this.mirror = new MemoryCache(clock);
    this.injectedCreate = deps.createClient;
    this.refreshIntervalMs = deps.refreshIntervalMs ?? 0;
  }

  async init(): Promise<void> {
    if (this.injectedCreate !== undefined) {
      this.client = this.injectedCreate(this.url);
    } else {
      const { createClient } = await import("redis");
      this.client = createClient({ url: this.url }) as unknown as RedisLike;
    }
    await this.client.connect();
    await this.hydrate(this.mirror);
    if (this.refreshIntervalMs > 0) {
      this.refreshTimer = setInterval(() => void this.refresh().catch(() => {}), this.refreshIntervalMs);
      this.refreshTimer.unref?.();
    }
  }

  // Load Redis state into a fresh mirror (strings + sorted sets). Shared by init() and refresh().
  private async hydrate(target: MemoryCache): Promise<void> {
    const client = this.must();
    for await (const chunk of client.scanIterator()) {
      const keys = Array.isArray(chunk) ? chunk : [chunk];
      for (const key of keys) {
        const k = String(key);
        const type = await client.type(k);
        if (type === "zset") {
          const entries = await client.zRangeWithScores(k, 0, -1);
          for (const e of entries) target.zincr(k, String(e.value), Number(e.score));
        } else if (type === "string") {
          const raw = await client.get(k);
          if (raw !== null) {
            try {
              target.set(k, JSON.parse(raw));
            } catch {
              target.set(k, raw);
            }
          }
        }
      }
    }
  }

  // Flush pending writes, then rebuild the L1 mirror from the authoritative Redis state so this node
  // observes other nodes' writes. Flush-before-read guarantees our own writes are reflected.
  async refresh(): Promise<void> {
    await this.flush();
    const fresh = new MemoryCache(this.clock);
    await this.hydrate(fresh);
    this.mirror = fresh;
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
    if (this.refreshTimer !== undefined) clearInterval(this.refreshTimer);
    await this.flush().catch(() => {});
    await this.client?.quit();
  }

  // --- Cache interface (sync reads from the L1 mirror; writes update mirror + enqueue authoritative Redis ops) ---
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
    const firstTouch = this.mirror.get<number>(key) === undefined;
    const next = this.mirror.incr(key, by, ttlMs);
    // Authoritative atomic increment server-side (aggregates across nodes). Set the expiry window
    // only on first creation so a sliding window isn't reset by every increment.
    this.enqueue(() => this.must().incrBy(key, by));
    if (firstTouch && ttlMs !== undefined) this.enqueue(() => this.must().pExpire(key, ttlMs));
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

  private must(): RedisLike {
    if (this.client === undefined) throw new Error("RedisCache not initialized — call init() first");
    return this.client;
  }
}
