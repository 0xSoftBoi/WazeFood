// AR & wearables scene assembly: outdoor scene (store/deal pins + route line), in-store scene
// (price cards with aisle + cheaper-elsewhere), device-tier tailoring, and POV-glasses capture
// flowing through the same ingestion pipeline.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { fixedClock } from "../src/platform/clock.ts";
import { seedDemo } from "../src/seed.ts";

test("outdoor phone-AR scene has store pins, a deal pin, and a route line", async () => {
  const app = buildApp(loadConfig(), fixedClock(new Date("2026-06-20T12:00:00Z")));
  const seed = await seedDemo(app);
  const user = app.identity.createAnonymousUser({ metro: seed.metro });

  const scene = app.arscene.buildScene({
    userId: user.id,
    at: seed.at,
    deviceTier: "phone_ar",
    items: [{ productId: seed.products.eggs, qty: 1 }, { productId: seed.products.cereal, qty: 1 }],
    mode: "balanced",
  });

  assert.equal(scene.context, "outdoor");
  assert.ok(scene.anchors.some((a) => a.kind === "store_pin"), "expected store pins");
  assert.ok(scene.anchors.some((a) => a.kind === "deal_pin"), "expected the seeded clearance deal pin");
  assert.ok(scene.anchors.some((a) => a.kind === "route_waypoint"), "expected route waypoints");
  assert.ok(scene.route !== null && scene.route.polyline.length >= 2, "expected a route polyline");
  assert.ok(scene.route!.estimatedSavings > 0);
});

test("in-store scene shows price cards with aisle and a cheaper-elsewhere warning", async () => {
  const app = buildApp(loadConfig(), fixedClock(new Date("2026-06-20T12:00:00Z")));
  const seed = await seedDemo(app);
  const user = app.identity.createAnonymousUser({ metro: seed.metro });

  // Shopping at Smith's; eggs are cheaper at Walmart, milk is cheapest at Walmart too.
  const scene = app.arscene.buildScene({
    userId: user.id,
    at: seed.at,
    deviceTier: "phone_ar",
    storeId: seed.stores.smiths,
    items: [{ productId: seed.products.eggs, qty: 1 }, { productId: seed.products.bread, qty: 1 }],
  });

  assert.equal(scene.context, "instore");
  const eggCard = scene.anchors.find((a) => a.kind === "price_card" && a.productId === seed.products.eggs);
  assert.ok(eggCard && eggCard.kind === "price_card");
  assert.equal(eggCard.aisle, "Aisle 4 · Dairy");
  assert.ok(eggCard.cheaperElsewhere !== null, "eggs should flag cheaper at Walmart");
  assert.equal(eggCard.cheaperElsewhere!.storeId, seed.stores.walmart);

  const breadCard = scene.anchors.find((a) => a.kind === "price_card" && a.productId === seed.products.bread);
  assert.ok(breadCard && breadCard.kind === "price_card" && breadCard.buyHere, "bread only sold at Smith's → buy here");
});

test("device tier tailors the payload: display glasses are capped, audio glasses speak", async () => {
  const app = buildApp(loadConfig(), fixedClock(new Date("2026-06-20T12:00:00Z")));
  const seed = await seedDemo(app);
  const user = app.identity.createAnonymousUser({ metro: seed.metro });
  const items = [{ productId: seed.products.eggs, qty: 1 }, { productId: seed.products.milk, qty: 1 }, { productId: seed.products.bread, qty: 1 }];

  const display = app.arscene.buildScene({ userId: user.id, at: seed.at, deviceTier: "glasses_display", storeId: seed.stores.smiths, items });
  assert.ok(display.anchors.length <= 3, "display glasses cap anchors to the HUD budget");

  const audio = app.arscene.buildScene({ userId: user.id, at: seed.at, deviceTier: "glasses_audio", storeId: seed.stores.smiths, items });
  assert.equal(audio.anchors.length, 0, "audio glasses render no visual anchors");
  assert.ok(audio.audioCues.length > 0, "audio glasses produce spoken cues");
  assert.ok(audio.approxPayloadBytes < display.approxPayloadBytes + 1000);
});

test("POV-glasses capture flows through ingestion and records aisle location", async () => {
  const app = buildApp(loadConfig(), fixedClock(new Date("2026-06-20T12:00:00Z")));
  const seed = await seedDemo(app);
  const user = app.identity.createAnonymousUser({ metro: seed.metro });
  // Bump reputation so the aisle report clears the confidence threshold.
  app.gamification.award(user.id, 600, seed.metro);

  const c = await app.ingestion.submit({
    idempotencyKey: "glasses-1",
    userId: user.id,
    storeId: seed.stores.walmart,
    kind: "aisle",
    productId: seed.products.cereal,
    aisle: "Aisle 9 · Cereal",
    via: "glasses",
    lat: 40.755,
    lng: -111.88,
  });
  assert.equal(c.status, "scored");
  assert.equal(c.via, "glasses");
  assert.equal(app.catalog.getAisle(seed.stores.walmart, seed.products.cereal), "Aisle 9 · Cereal");
});
