import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryCache } from "../../platform/cache/cache.ts";
import { fixedClock } from "../../platform/clock.ts";
import { EntitlementsService } from "./service.ts";
import { isOk } from "../../platform/result.ts";
import { memoryTableFactory } from "../../platform/store/store.ts";

function svc() {
  const clock = fixedClock(new Date("2026-06-20T00:00:00Z"));
  return new EntitlementsService({ cache: new MemoryCache(clock), clock, tables: memoryTableFactory });
}

test("free users get a metered number of cart optimizations then are gated", () => {
  const e = svc();
  const u = "usr_1";
  assert.ok(isOk(e.consume(u, "cart_optimize"))); // 1
  assert.ok(isOk(e.consume(u, "cart_optimize"))); // 2
  assert.ok(isOk(e.consume(u, "cart_optimize"))); // 3
  assert.equal(isOk(e.consume(u, "cart_optimize")), false); // 4 -> payment_required
});

test("granting Premium makes gated features unlimited", () => {
  const e = svc();
  const u = "usr_2";
  for (let i = 0; i < 3; i++) e.consume(u, "cart_optimize");
  assert.equal(isOk(e.consume(u, "cart_optimize")), false);
  e.grantPremiumDays(u, 30, "referral");
  assert.ok(e.isPremium(u));
  const r = e.consume(u, "cart_optimize");
  assert.ok(isOk(r) && r.value.remaining === "unlimited");
});

test("status reports plan and per-feature usage", () => {
  const e = svc();
  const u = "usr_3";
  e.consume(u, "image_search");
  const s = e.status(u);
  assert.equal(s.plan, "free");
  assert.equal(s.usage.image_search, 1);
});
