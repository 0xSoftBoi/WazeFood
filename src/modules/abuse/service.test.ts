import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryCache } from "../../platform/cache/cache.ts";
import { fixedClock } from "../../platform/clock.ts";
import { AbuseScoreService } from "./service.ts";

function svc(opts: Partial<{ mode: "monitor" | "enforce"; deviceSoftPerMin: number; deviceHardPerMin: number }> = {}) {
  const clock = fixedClock(new Date("2026-06-20T12:00:00Z"));
  return new AbuseScoreService({ cache: new MemoryCache(clock), clock, h3Resolution: 8, ...opts });
}
const at = { lat: 40.7608, lng: -111.891 };

test("a normal nearby price lookup scores low and is allowed", () => {
  const a = svc();
  const r = a.score({ deviceId: "d1", userId: "u1", route: "/prices/best", productId: "prd_eggs", ...at });
  assert.equal(r.decision, "allow");
  assert.ok(r.score < 30);
});

test("touching a honeytoken canary is an instant block", () => {
  const a = svc();
  a.addCanary("prd_canary_1");
  const r = a.score({ deviceId: "d2", userId: "u2", route: "/prices/best", productId: "prd_canary_1", ...at });
  assert.equal(r.score, 100);
  assert.equal(r.decision, "block");
  assert.ok(r.reasons.includes("honeytoken_canary"));
});

test("high device velocity escalates the decision", () => {
  const a = svc({ deviceSoftPerMin: 2, deviceHardPerMin: 6 });
  let last;
  for (let i = 0; i < 7; i++) last = a.score({ deviceId: "d3", userId: "u3", route: "/prices/best", productId: "prd_eggs", ...at });
  assert.ok(last!.score >= 50, `velocity score ${last!.score}`);
  assert.notEqual(last!.decision, "allow");
});

test("scattered geo-coherence (one account across many distant cells) is flagged", () => {
  const a = svc();
  let last;
  // Same account querying 12 widely-separated locations in a minute = not a shopper.
  for (let i = 0; i < 12; i++) {
    last = a.score({ deviceId: "scraper", userId: "uX", route: "/prices/best", productId: "prd_eggs", lat: 40 + i * 0.5, lng: -111 + i * 0.5 });
  }
  assert.ok(last!.reasons.some((r) => r.startsWith("geo_incoherence")), "geo signal fires");
  assert.notEqual(last!.decision, "allow");
});

test("product breadth (enumerating many distinct products) raises the score", () => {
  const a = svc();
  let last;
  for (let i = 0; i < 45; i++) last = a.score({ deviceId: "d4", userId: "u4", route: "/prices/best", productId: "prd_" + i, ...at });
  assert.ok(last!.reasons.some((r) => r.startsWith("product_breadth")));
  assert.ok(last!.score >= 30);
});

test("monitor mode scores and observes but never blocks (phased rollout)", () => {
  const a = svc({ mode: "monitor" });
  a.addCanary("prd_canary_1");
  const r = a.score({ deviceId: "d5", userId: "u5", route: "/prices/best", productId: "prd_canary_1", ...at });
  assert.equal(r.observed, "block");
  assert.equal(r.decision, "allow", "monitor mode does not enforce");
});
