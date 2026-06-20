// Barcode-first ingestion: a capture with a barcode resolves the product with no productId,
// promotes a price, and a re-uploaded photo (same mediaHash) is deduped.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { fixedClock } from "../src/platform/clock.ts";
import { seedDemo } from "../src/seed.ts";

test("a barcode capture resolves the product and updates the projection", async () => {
  const app = buildApp(loadConfig(), fixedClock(new Date("2026-06-20T12:00:00Z")));
  const seed = await seedDemo(app);
  const user = app.identity.createAnonymousUser({ metro: seed.metro });
  app.gamification.award(user.id, 600, seed.metro); // trusted contributor

  // No productId — just a scanned barcode (UPC 0003 = milk) and a price, standing at Smith's.
  const c = await app.ingestion.submit({
    idempotencyKey: "scan-1",
    userId: user.id,
    storeId: seed.stores.smiths,
    kind: "shelf",
    barcode: "0003",
    reportedPrice: 3.29,
    lat: seed.at.lat,
    lng: seed.at.lng,
  });
  assert.equal(c.status, "scored");
  assert.equal(c.productId, seed.products.milk);
  assert.equal(c.matchMethod, "barcode");
  assert.equal(app.pricing.getProjection(seed.products.milk, seed.stores.smiths)?.price, 3.29);
});

test("a cryptic text capture matches by normalization and is damped by match score", async () => {
  const app = buildApp(loadConfig(), fixedClock(new Date("2026-06-20T12:00:00Z")));
  const seed = await seedDemo(app);
  const user = app.identity.createAnonymousUser({ metro: seed.metro });
  app.gamification.award(user.id, 600, seed.metro);

  const c = await app.ingestion.submit({
    idempotencyKey: "ocr-1",
    userId: user.id,
    storeId: seed.stores.smiths,
    kind: "receipt",
    text: "WHP MLK", // partial vs "Whole Milk 1gal" → score < 1
    reportedPrice: 3.25,
    lat: seed.at.lat,
    lng: seed.at.lng,
  });
  assert.equal(c.productId, seed.products.milk);
  assert.equal(c.matchMethod, "text");
  assert.ok(c.matchScore > 0 && c.matchScore < 1, "text match is a partial score");
});

test("the same photo re-uploaded (same mediaHash) is deduped, not double-counted", async () => {
  const app = buildApp(loadConfig(), fixedClock(new Date("2026-06-20T12:00:00Z")));
  const seed = await seedDemo(app);
  const user = app.identity.createAnonymousUser({ metro: seed.metro });
  app.gamification.award(user.id, 600, seed.metro);

  const first = await app.ingestion.submit({
    idempotencyKey: "k-a", userId: user.id, storeId: seed.stores.smiths, kind: "shelf",
    barcode: "0003", reportedPrice: 3.10, mediaHash: "sha-abc", lat: seed.at.lat, lng: seed.at.lng,
  });
  // Different idempotency key, but the SAME photo → must return the first record.
  const second = await app.ingestion.submit({
    idempotencyKey: "k-b", userId: user.id, storeId: seed.stores.smiths, kind: "shelf",
    barcode: "0003", reportedPrice: 3.10, mediaHash: "sha-abc", lat: seed.at.lat, lng: seed.at.lng,
  });
  assert.equal(second.id, first.id);
  assert.equal(app.ingestion.byUser(user.id).length, 1);
});

test("perception cost stats show routing beats the naive baseline", async () => {
  const app = buildApp(loadConfig(), fixedClock(new Date("2026-06-20T12:00:00Z")));
  const seed = await seedDemo(app);
  const user = app.identity.createAnonymousUser({ metro: seed.metro });
  app.gamification.award(user.id, 600, seed.metro);

  // Barcode capture (free perception) + a couple of photo captures.
  await app.ingestion.submit({ idempotencyKey: "p1", userId: user.id, storeId: seed.stores.smiths, kind: "shelf", barcode: "0003", reportedPrice: 3.2, lat: seed.at.lat, lng: seed.at.lng });
  await app.ingestion.submit({ idempotencyKey: "p2", userId: user.id, storeId: seed.stores.smiths, kind: "shelf", mediaHash: "ph-1", text: "WHP MLK", reportedPrice: 3.2, lat: seed.at.lat, lng: seed.at.lng });
  const s = app.perception.stats();
  assert.ok(s.spentCents <= s.baselineCents);
});
