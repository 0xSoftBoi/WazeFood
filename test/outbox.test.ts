// The outbox records every domain event published on the bus, in order, with type counts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { fixedClock } from "../src/platform/clock.ts";
import { seedDemo } from "../src/seed.ts";

test("a contribution produces an ordered, typed event log", async () => {
  const app = buildApp(loadConfig(), fixedClock(new Date("2026-06-20T12:00:00Z")));
  const seed = await seedDemo(app); // seeding publishes price.updated + deal.reported
  const seededEvents = app.outbox.count();
  assert.ok(seededEvents > 0, "seeding records events");

  const user = app.identity.createAnonymousUser({ metro: seed.metro });
  app.gamification.award(user.id, 600, seed.metro);

  await app.ingestion.submit({
    idempotencyKey: "ob-1", userId: user.id, storeId: seed.stores.smiths, kind: "receipt",
    productId: seed.products.eggs, reportedPrice: 4.4, lat: seed.at.lat, lng: seed.at.lng,
  });

  const byType = app.outbox.countByType();
  // The receipt drove: contribution.received, contribution.scored, price.updated, price.dropped.
  assert.ok((byType["contribution.received"] ?? 0) >= 1);
  assert.ok((byType["contribution.scored"] ?? 0) >= 1);
  assert.ok((byType["price.updated"] ?? 0) >= 1);
  assert.ok((byType["price.dropped"] ?? 0) >= 1, "eggs 5.49 → 4.40 is a drop");

  // recent() is newest-first and strictly ordered by sequence.
  const recent = app.outbox.recent(5);
  for (let i = 1; i < recent.length; i++) {
    assert.ok(recent[i - 1]!.seq > recent[i]!.seq, "recent() is ordered by descending seq");
  }
  // Nothing has been relayed to an external sink yet → all events are unpublished.
  assert.equal(app.outbox.unpublishedCount(), app.outbox.count());
});
