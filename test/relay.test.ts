// The relay drains the outbox to an external sink at-least-once: it delivers pending events,
// marks them published, never redelivers, and retries a failed batch on the next drain.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { fixedClock } from "../src/platform/clock.ts";
import { seedDemo } from "../src/seed.ts";
import { Relay, collectingSink } from "../src/modules/outbox/relay.ts";

async function appWithEvents() {
  const app = buildApp(loadConfig(), fixedClock(new Date("2026-06-20T12:00:00Z")));
  const seed = await seedDemo(app); // generates price.updated + deal.reported events
  return { app, seed };
}

test("relay delivers pending events to the sink and marks them published exactly once", async () => {
  const { app } = await appWithEvents();
  const total = app.outbox.count();
  assert.ok(total > 0);
  assert.equal(app.outbox.unpublishedCount(), total);

  const sink = collectingSink();
  const relay = new Relay({ outbox: app.outbox, sink });

  const delivered = await relay.drainAll();
  assert.equal(delivered, total, "all pending events delivered");
  assert.equal(sink.delivered.length, total);
  assert.equal(app.outbox.unpublishedCount(), 0, "all marked published");

  // A second drain is a no-op (no redelivery).
  const again = await relay.drainAll();
  assert.equal(again, 0);
  assert.equal(sink.delivered.length, total, "no duplicate delivery");
});

test("a failed batch stays unpublished and is retried on the next drain (at-least-once)", async () => {
  const { app } = await appWithEvents();
  const total = app.outbox.count();

  const sink = collectingSink({ failTimes: 1 }); // first deliver() throws
  const relay = new Relay({ outbox: app.outbox, sink });

  await assert.rejects(() => relay.drainOnce(), /unavailable/);
  assert.equal(app.outbox.unpublishedCount(), total, "nothing marked after a failed delivery");

  // Recovery: the next drain succeeds and delivers everything once.
  const delivered = await relay.drainAll();
  assert.equal(delivered, total);
  assert.equal(app.outbox.unpublishedCount(), 0);
  assert.equal(sink.delivered.length, total);
});

test("events recorded after a drain are picked up by the next drain", async () => {
  const { app, seed } = await appWithEvents();
  const sink = collectingSink();
  const relay = new Relay({ outbox: app.outbox, sink });
  await relay.drainAll();
  const afterFirst = sink.delivered.length;

  // New activity → new events.
  const user = app.identity.createAnonymousUser({ metro: seed.metro });
  app.gamification.award(user.id, 600, seed.metro);
  await app.ingestion.submit({
    idempotencyKey: "relay-1", userId: user.id, storeId: seed.stores.smiths, kind: "receipt",
    productId: seed.products.eggs, reportedPrice: 4.3, lat: seed.at.lat, lng: seed.at.lng,
  });
  assert.ok(app.outbox.unpublishedCount() > 0);

  await relay.drainAll();
  assert.ok(sink.delivered.length > afterFirst, "new events delivered");
  assert.equal(app.outbox.unpublishedCount(), 0);
});
