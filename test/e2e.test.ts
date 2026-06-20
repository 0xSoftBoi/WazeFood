// End-to-end test of the core value loop, proving the architecture's seams work together:
// seed → search/price read (TAO projection) → contribute (idempotent, geofenced, scored) →
// price.updated → price.dropped → alert fan-out → karma/leaderboard → token-gated, explainable
// optimization. One test exercises ingestion, pricing, alerts, gamification, entitlements,
// optimization and the event bus end to end.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { fixedClock } from "../src/platform/clock.ts";
import { seedDemo } from "../src/seed.ts";
import type { CartPlan } from "../src/modules/optimization/service.ts";

function planOf(r: CartPlan | { error: string }): CartPlan {
  assert.ok(!("error" in r), `optimize failed: ${"error" in r ? r.error : ""}`);
  return r as CartPlan;
}

test("core value loop: contribute → projection → drop alert → karma → optimize", async () => {
  const app = buildApp(loadConfig(), fixedClock(new Date("2026-06-20T12:00:00Z")));
  const seed = await seedDemo(app);
  const user = app.identity.createAnonymousUser({ metro: seed.metro });
  app.identity.setLocation(user.id, "84106", seed.metro);

  // Read path: cheapest eggs nearby is Walmart at $4.99 (Smith's $5.49, Target $5.29).
  const before = app.pricing.bestNearbyPrice(seed.products.eggs, seed.at, 15_000);
  assert.equal(before?.storeId, seed.stores.walmart);
  assert.equal(before?.price, 4.99);

  // User watches eggs, then uploads a receipt showing Smith's eggs at $4.50 (a drop from $5.49).
  const watch = app.alerts.addWatch(user.id, seed.products.eggs, seed.at, 16_000);
  assert.ok(watch.ok);

  const contribution = await app.ingestion.submit({
    idempotencyKey: "rcpt-1",
    userId: user.id,
    storeId: seed.stores.smiths,
    kind: "receipt",
    productId: seed.products.eggs,
    reportedPrice: 4.5,
    lat: seed.at.lat, // standing at Smith's → geofence valid
    lng: seed.at.lng,
  });
  assert.equal(contribution.status, "scored");
  assert.ok((contribution.confidence ?? 0) > 0.4);

  // Projection updated write-through; a price.dropped fanned out to the watcher.
  assert.equal(app.pricing.getProjection(seed.products.eggs, seed.stores.smiths)?.price, 4.5);
  const notifs = app.alerts.listNotifications(user.id);
  assert.equal(notifs.length, 1);
  assert.equal(notifs[0]?.kind, "price_drop");

  // Idempotency: re-submitting the same receipt does not double-count or re-notify.
  const dup = await app.ingestion.submit({
    idempotencyKey: "rcpt-1",
    userId: user.id,
    storeId: seed.stores.smiths,
    kind: "receipt",
    productId: seed.products.eggs,
    reportedPrice: 4.5,
    lat: seed.at.lat,
    lng: seed.at.lng,
  });
  assert.equal(dup.id, contribution.id);
  assert.equal(app.ingestion.byUser(user.id).length, 1);
  assert.equal(app.alerts.listNotifications(user.id).length, 1);

  // Karma awarded for the receipt; the user tops the weekly leaderboard.
  assert.equal(app.gamification.karmaOf(user.id), 25);
  const lb = app.gamification.leaderboard("weekly", seed.metro);
  assert.equal(lb[0]?.userId, user.id);

  // Token-gated, explainable optimization (free user, first run allowed).
  const meter = { consume: (uid: string, f: "cart_optimize") => ({ ok: app.entitlements.consume(uid, f).ok }) };
  const items = [
    { productId: seed.products.eggs, qty: 1 },
    { productId: seed.products.milk, qty: 1 },
    { productId: seed.products.cereal, qty: 1 },
  ];
  const plan = planOf(app.optimization.optimize({ userId: user.id, items, at: seed.at, mode: "balanced", meter }));
  assert.equal(plan.locked, false);
  assert.equal(plan.baselineStoreId, seed.stores.smiths);
  // Eggs → Kroger store-brand swap saves $4.50 - $3.35 = $1.15.
  assert.ok(Math.abs(plan.breakdown.productSwaps - 1.15) < 0.001, `productSwaps=${plan.breakdown.productSwaps}`);
  // Store differences: kroger eggs, milk, cereal all cheaper elsewhere = 0.06 + 0.30 + 2.10.
  assert.ok(Math.abs(plan.breakdown.storeDifferences - 2.46) < 0.001, `storeDiff=${plan.breakdown.storeDifferences}`);
  assert.ok(plan.breakdown.gasEstimate < 0, "gas should be charged for extra stores");
  assert.ok(plan.estimatedSavings > 0 && plan.estimatedSavings < 3.61);
  assert.ok(plan.stores.length >= 2, "balanced mode should split across stores when it beats gas");
});

test("free optimization tokens run out and the plan locks (paywall hook)", async () => {
  const app = buildApp(loadConfig(), fixedClock(new Date("2026-06-20T12:00:00Z")));
  const seed = await seedDemo(app);
  const user = app.identity.createAnonymousUser({ metro: seed.metro });
  const meter = { consume: (uid: string, f: "cart_optimize") => ({ ok: app.entitlements.consume(uid, f).ok }) };
  const items = [{ productId: seed.products.eggs, qty: 1 }];

  const run = () => planOf(app.optimization.optimize({ userId: user.id, items, at: seed.at, mode: "balanced", meter }));
  assert.equal(run().locked, false); // 1
  assert.equal(run().locked, false); // 2
  assert.equal(run().locked, false); // 3
  const locked = run(); // 4 -> out of free tokens
  assert.equal(locked.locked, true);
  assert.equal(locked.stores.length, 0); // detail hidden, but headline savings still present
  assert.ok(locked.estimatedSavings > 0);
});
