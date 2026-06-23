// Integration test: durability across a restart, against a real Postgres + Redis.
// Gated on IT_DURABLE=1 (so CI/offline runs skip it). Run locally with servers up:
//   IT_DURABLE=1 DATABASE_URL=postgres://smartcart:smartcart@127.0.0.1:5433/smartcart \
//   REDIS_URL=redis://127.0.0.1:6379 node --test test/persistence.it.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { bootstrap } from "../src/bootstrap.ts";
import { loadConfig } from "../src/config.ts";
import { fixedClock } from "../src/platform/clock.ts";
import { seedDemo } from "../src/seed.ts";

const RUN = process.env.IT_DURABLE === "1";
const clock = fixedClock(new Date("2026-06-20T12:00:00Z"));

function durableConfig() {
  return loadConfig({
    ...process.env,
    STORE_DRIVER: "postgres",
    CACHE_DRIVER: "redis",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgres://smartcart:smartcart@127.0.0.1:5433/smartcart",
    REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  });
}

async function resetState(cfg: ReturnType<typeof durableConfig>) {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: cfg.databaseUrl, max: 1 });
  await pool.query("CREATE TABLE IF NOT EXISTS doc_rows (table_name TEXT, id TEXT, data JSONB, updated_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (table_name, id))");
  await pool.query("TRUNCATE doc_rows");
  // Relational repo tables — drop so bootstrap recreates them fresh via 0002_relational.sql.
  await pool.query("DROP TABLE IF EXISTS product_vectors, store_geo, price_points");
  await pool.end();
  const { createClient } = await import("redis");
  const r = createClient({ url: cfg.redisUrl });
  await r.connect();
  await r.flushAll();
  await r.quit();
}

test("data written by one instance is durable and hydrates into a fresh instance", { skip: !RUN }, async () => {
  const cfg = durableConfig();
  await resetState(cfg);

  // --- Instance 1: seed + write, then flush write-behind buffers ---
  const d1 = await bootstrap(cfg, clock);
  const seed = await seedDemo(d1.app);
  const user = d1.app.identity.createAnonymousUser({ metro: seed.metro });
  d1.app.identity.setPhoneVerified(user.id, true);
  d1.app.gamification.award(user.id, 120, seed.metro); // karma (pg) + leaderboard (redis)
  const contribution = await d1.app.ingestion.submit({
    idempotencyKey: "it-1", userId: user.id, storeId: seed.stores.smiths, kind: "receipt",
    productId: seed.products.eggs, reportedPrice: 4.49, lat: seed.at.lat, lng: seed.at.lng,
  });
  await d1.flush();
  await d1.close();

  // --- Instance 2: fresh process state, hydrate from Postgres + Redis ---
  const d2 = await bootstrap(cfg, clock);
  try {
    // Store (Postgres) durability:
    assert.ok(d2.app.catalog.listProducts().length > 0, "products hydrated from Postgres");
    assert.ok(d2.app.catalog.getProduct(seed.products.eggs) !== undefined, "product row hydrated");
    assert.equal(d2.app.identity.getUser(user.id)?.phoneVerified, true, "user hydrated with phoneVerified");
    assert.ok(d2.app.ingestion.getContribution(contribution.id) !== undefined, "contribution hydrated");
    assert.equal(d2.app.pricing.getProjection(seed.products.eggs, seed.stores.smiths)?.price, 4.49, "price projection hydrated");
    assert.ok(d2.app.gamification.karmaOf(user.id) >= 120, "karma hydrated from Postgres");

    // Cache (Redis) durability — the leaderboard sorted set survived the restart:
    const lb = d2.app.gamification.leaderboard("weekly", seed.metro);
    assert.ok(lb.some((e) => e.userId === user.id && e.score >= 120), "leaderboard hydrated from Redis");

    // Event log (outbox) durability — the full event history persisted to Postgres:
    assert.ok(d2.app.outbox.count() > 0, "outbox event log hydrated from Postgres");
    assert.ok((d2.app.outbox.countByType()["price.updated"] ?? 0) > 0, "price.updated events persisted");

    // Dedicated relational repositories are Postgres-backed in durable mode:
    // pgvector — the matcher's vector index resolved a text query against product_vectors.
    const m = await d2.app.matching.resolve({ text: "eggs" });
    assert.ok(m.productId !== null, "pgvector matcher resolved a text query");
    // PostGIS + Timescale repos round-trip:
    await d2.app.repositories.geo.upsert({ id: seed.stores.smiths, lat: seed.at.lat, lng: seed.at.lng });
    const near = await d2.app.repositories.geo.nearby(seed.at.lat, seed.at.lng, 1000);
    assert.ok(near.some((r) => r.id === seed.stores.smiths), "PostGIS ST_DWithin found the store");
    await d2.app.repositories.history.append({ productId: seed.products.eggs, storeId: seed.stores.smiths, price: 4.49, confidence: 0.9, at: "2026-06-20T12:00:00Z" });
    const latest = await d2.app.repositories.history.latest(seed.products.eggs, seed.stores.smiths);
    assert.equal(latest?.price, 4.49, "Timescale price_points round-tripped");
  } finally {
    await d2.close();
  }
});

test("Redis counters aggregate across two client instances (multi-node correctness)", { skip: !RUN }, async () => {
  const cfg = durableConfig();
  await resetState(cfg);
  const { RedisCache } = await import("../src/platform/cache/redis.ts");
  const a = new RedisCache(cfg.redisUrl, clock);
  const b = new RedisCache(cfg.redisUrl, clock);
  await a.init();
  await b.init();
  try {
    a.incr("it:counter", 1, 60_000);
    b.incr("it:counter", 1, 60_000);
    await a.flush();
    await b.flush();
    await a.refresh();
    assert.equal(a.get<number>("it:counter"), 2, "server-side INCRBY aggregated both nodes (no lost update)");
  } finally {
    await a.close();
    await b.close();
  }
});
