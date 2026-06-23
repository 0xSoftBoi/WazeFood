// RedisCache, tested offline against an in-memory fake that stands in for one Redis server shared by
// multiple nodes. The point under test is multi-node correctness: authoritative server-side INCRBY /
// ZINCRBY (so concurrent nodes aggregate instead of clobbering) and refresh() reconciling the L1
// mirror with the server. The live `redis` client is the only un-tested part (gated IT).

import { test } from "node:test";
import assert from "node:assert/strict";
import { systemClock } from "../clock.ts";
import { RedisCache, type RedisLike } from "./redis.ts";

// One shared fake = one Redis server. Two RedisCache instances over it = two nodes.
class FakeRedis implements RedisLike {
  strings = new Map<string, string>();
  zsets = new Map<string, Map<string, number>>();
  async connect() {}
  async quit() { return undefined; }
  async get(k: string) { return this.strings.get(k) ?? null; }
  async set(k: string, v: string) { this.strings.set(k, v); return undefined; }
  async del(k: string) { this.strings.delete(k); return undefined; }
  async incrBy(k: string, by: number) { const n = Number(this.strings.get(k) ?? 0) + by; this.strings.set(k, String(n)); return n; }
  async pExpire() { return undefined; }
  async zIncrBy(s: string, by: number, m: string) {
    let z = this.zsets.get(s);
    if (z === undefined) { z = new Map(); this.zsets.set(s, z); }
    z.set(m, (z.get(m) ?? 0) + by);
    return undefined;
  }
  async zRangeWithScores(k: string) {
    const z = this.zsets.get(k) ?? new Map<string, number>();
    return [...z.entries()].map(([value, score]) => ({ value, score }));
  }
  async type(k: string) { return this.zsets.has(k) ? "zset" : this.strings.has(k) ? "string" : "none"; }
  async *scanIterator() { for (const k of this.strings.keys()) yield k; for (const k of this.zsets.keys()) yield k; }
}

function nodesOn(server: FakeRedis, n: number) {
  return Promise.all(
    Array.from({ length: n }, async () => {
      const c = new RedisCache("redis://fake", systemClock, { createClient: () => server, refreshIntervalMs: 0 });
      await c.init();
      return c;
    }),
  );
}

test("two nodes' counter increments aggregate authoritatively (no lost updates)", async () => {
  const server = new FakeRedis();
  const [a, b] = await nodesOn(server, 2);
  a!.incr("rl:dev1", 1, 60_000);
  b!.incr("rl:dev1", 1, 60_000);
  await a!.flush();
  await b!.flush();
  // The bug this fixes: SET-of-local-value would leave the server at 1. INCRBY makes it 2.
  assert.equal(Number(server.strings.get("rl:dev1")), 2);
  await a!.refresh();
  assert.equal(a!.get<number>("rl:dev1"), 2, "node A sees both nodes' increments after refresh");
});

test("leaderboard zincr aggregates across nodes", async () => {
  const server = new FakeRedis();
  const [a, b] = await nodesOn(server, 2);
  a!.zincr("lb:week", "userX", 10);
  b!.zincr("lb:week", "userX", 5);
  await a!.flush();
  await b!.flush();
  await b!.refresh();
  assert.equal(b!.zscore("lb:week", "userX"), 15);
});

test("set / del propagate and survive a refresh", async () => {
  const server = new FakeRedis();
  const [a] = await nodesOn(server, 1);
  a!.set("k", { hello: "world" }, 60_000);
  await a!.refresh();
  assert.deepEqual(a!.get("k"), { hello: "world" });
  a!.del("k");
  await a!.refresh();
  assert.equal(a!.get("k"), undefined);
});

test("the increment's ttl is set once, not reset on every bump", async () => {
  const server = new FakeRedis();
  let expireCalls = 0;
  server.pExpire = async () => { expireCalls++; return undefined; };
  const c = new RedisCache("redis://fake", systemClock, { createClient: () => server, refreshIntervalMs: 0 });
  await c.init();
  c.incr("win:1", 1, 60_000);
  c.incr("win:1", 1, 60_000);
  c.incr("win:1", 1, 60_000);
  await c.flush();
  assert.equal(expireCalls, 1, "expiry window set only on first touch");
});
