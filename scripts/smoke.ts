// Programmatic smoke test of the value loop — no HTTP, just the wired app. Run: npm run smoke.
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { seedDemo } from "../src/seed.ts";
import { isOk } from "../src/platform/result.ts";

const app = buildApp(loadConfig());
const seed = await seedDemo(app);
const user = app.identity.createAnonymousUser({ metro: seed.metro });

const best = app.pricing.bestNearbyPrice(seed.products.eggs, seed.at, 15_000);
console.log(`cheapest eggs nearby: $${best?.price} @ ${best?.storeId}`);

const c = await app.ingestion.submit({
  idempotencyKey: "smoke-1",
  userId: user.id,
  storeId: seed.stores.smiths,
  kind: "receipt",
  productId: seed.products.eggs,
  reportedPrice: 4.5,
  lat: seed.at.lat,
  lng: seed.at.lng,
});
console.log(`contribution ${c.status} confidence=${c.confidence?.toFixed(2)} karma=${app.gamification.karmaOf(user.id)}`);

const meter = { consume: (uid: string, f: "cart_optimize") => ({ ok: isOk(app.entitlements.consume(uid, f)) }) };
const plan = app.optimization.optimize({
  userId: user.id,
  items: [
    { productId: seed.products.eggs, qty: 1 },
    { productId: seed.products.milk, qty: 1 },
    { productId: seed.products.cereal, qty: 1 },
  ],
  at: seed.at,
  mode: "balanced",
  meter,
});
if (!("error" in plan)) {
  console.log(`optimized cart: baseline $${plan.baselineCost} → $${plan.optimizedCost} (save $${plan.estimatedSavings})`);
  console.log(`  breakdown:`, plan.breakdown);
}
console.log("smoke ok");
