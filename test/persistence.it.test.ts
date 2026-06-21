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
  } finally {
    await d2.close();
  }
});
