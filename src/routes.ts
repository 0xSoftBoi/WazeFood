// BFF routes — coarse, screen-shaped endpoints over the modular monolith. A real deployment
// fronts these with a managed gateway/CDN, but the shape (and the anti-scrape + identity
// middleware in main.ts) is the same.

import type { App } from "./app.ts";
import { badRequest, notFound } from "./platform/errors.ts";
import { isOk } from "./platform/result.ts";
import type { Reply, Router } from "./platform/http/router.ts";
import type { RoutingMode } from "./modules/identity/service.ts";
import type { ContributionType } from "./platform/events/events.ts";

type Body = Record<string, unknown>;
const asBody = (b: unknown): Body => (b !== null && typeof b === "object" ? (b as Body) : {});
function str(b: Body, k: string): string {
  const v = b[k];
  if (typeof v !== "string" || v.length === 0) throw badRequest(`missing string '${k}'`);
  return v;
}
function num(b: Body, k: string): number {
  const v = b[k];
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw badRequest(`missing number '${k}'`);
  return n;
}
function optStr(b: Body, k: string): string | undefined {
  const v = b[k];
  return typeof v === "string" ? v : undefined;
}
const ok = (body: unknown, status = 200): Reply => ({ status, body });

export function registerRoutes(router: Router, app: App): Router {
  router.get("/health", () => ok({ status: "ok", service: "smartcart" }));

  // Readiness: drivers configured + demo data present.
  router.get("/ready", () =>
    ok({
      ready: app.catalog.listProducts().length > 0,
      drivers: { store: app.config.storeDriver, cache: app.config.cacheDriver },
    }),
  );

  // Basic operational metrics: catalog size, event-log totals, and the perception cost receipt.
  router.get("/metrics", () =>
    ok({
      products: app.catalog.listProducts().length,
      events: { total: app.outbox.count(), byType: app.outbox.countByType(), unpublished: app.outbox.unpublishedCount() },
      perception: app.perception.stats(),
    }),
  );

  // Durable event log (the outbox a future CDC relay would publish from).
  router.get("/admin/outbox", (ctx) => {
    const limit = Number(ctx.query.get("limit") ?? "50");
    return ok({ count: app.outbox.count(), recent: app.outbox.recent(Number.isFinite(limit) ? limit : 50) });
  });

  // --- Identity ---
  router.post("/users", (ctx) => {
    const b = asBody(ctx.body);
    const user = app.identity.createAnonymousUser({ metro: optStr(b, "metro"), platform: optStr(b, "platform"), deviceId: ctx.deviceId });
    return ok(user, 201);
  });

  router.post("/users/:id/verify-phone", async (ctx) => {
    const user = app.identity.setPhoneVerified(ctx.params.id!, true);
    if (user === undefined) throw notFound("user");
    await app.referral.evaluate(user.id); // a referred user verifying phone may now activate
    return ok(user);
  });

  router.post("/users/:id/location", async (ctx) => {
    const b = asBody(ctx.body);
    const user = app.identity.setLocation(ctx.params.id!, str(b, "zip"), optStr(b, "metro") ?? "unknown");
    if (user === undefined) throw notFound("user");
    await app.referral.evaluate(user.id);
    return ok(user);
  });

  router.get("/users/:id/entitlements", (ctx) => ok(app.entitlements.status(ctx.params.id!)));

  router.get("/users/:id/gamification", (ctx) => {
    const id = ctx.params.id!;
    return ok({ karma: app.gamification.karmaOf(id), reputation: app.gamification.reputation(id), badges: app.gamification.badges(id) });
  });

  router.get("/users/:id/notifications", (ctx) => ok(app.alerts.listNotifications(ctx.params.id!)));

  // --- Catalog / search ---
  router.get("/search", (ctx) => {
    const q = ctx.query.get("q") ?? "";
    if (ctx.userId !== null) app.referral.recordActivity(ctx.userId, { searches: 1 });
    return ok({ query: q, results: app.catalog.search(q) });
  });

  // Resolve a barcode or a line-item string to a canonical product (client-side scan helper).
  router.get("/catalog/resolve", (ctx) => {
    const barcode = ctx.query.get("barcode");
    const text = ctx.query.get("text");
    if (barcode === null && text === null) throw badRequest("barcode or text required");
    return ok(app.matching.resolve({ barcode, text }));
  });

  router.get("/prices/best", (ctx) => {
    const productId = ctx.query.get("productId");
    const lat = Number(ctx.query.get("lat"));
    const lng = Number(ctx.query.get("lng"));
    if (productId === null || !Number.isFinite(lat) || !Number.isFinite(lng)) throw badRequest("productId, lat, lng required");
    const radius = Number(ctx.query.get("radius") ?? "15000");
    const best = app.pricing.bestNearbyPrice(productId, { lat, lng }, radius);
    return best === undefined ? ok({ found: false }) : ok({ found: true, ...best });
  });

  // --- Lists ---
  router.post("/lists", (ctx) => {
    const b = asBody(ctx.body);
    return ok(app.lists.createList(str(b, "ownerId"), optStr(b, "name") ?? "My list"), 201);
  });

  router.get("/lists/:id", (ctx) => {
    const list = app.lists.getList(ctx.params.id!);
    return list === undefined ? (() => { throw notFound("list"); })() : ok(list);
  });

  router.post("/lists/:id/items", (ctx) => {
    const b = asBody(ctx.body);
    const item = app.lists.addItem({
      listId: ctx.params.id!,
      ownerId: str(b, "ownerId"),
      productId: str(b, "productId"),
      qty: typeof b.qty === "number" ? b.qty : 1,
    });
    return ok(item, 201);
  });

  // --- Ingestion (the write path) ---
  router.post("/contributions", async (ctx) => {
    const b = asBody(ctx.body);
    const contribution = await app.ingestion.submit({
      idempotencyKey: str(b, "idempotencyKey"),
      userId: str(b, "userId"),
      storeId: str(b, "storeId"),
      kind: str(b, "kind") as ContributionType,
      productId: optStr(b, "productId") ?? null,
      reportedPrice: typeof b.reportedPrice === "number" ? b.reportedPrice : null,
      barcode: optStr(b, "barcode") ?? null,
      text: optStr(b, "text") ?? null,
      mediaHash: optStr(b, "mediaHash") ?? null,
      lat: num(b, "lat"),
      lng: num(b, "lng"),
    });
    return ok(contribution, 201);
  });

  // --- Optimization ---
  router.post("/optimize", (ctx) => {
    const b = asBody(ctx.body);
    const itemsRaw = Array.isArray(b.items) ? b.items : [];
    const items = itemsRaw.map((i) => {
      const ib = asBody(i);
      return { productId: str(ib, "productId"), qty: typeof ib.qty === "number" ? ib.qty : 1 };
    });
    const plan = app.optimization.optimize({
      userId: str(b, "userId"),
      items,
      at: { lat: num(b, "lat"), lng: num(b, "lng") },
      mode: (optStr(b, "mode") as RoutingMode) ?? "balanced",
      meter: { consume: (userId, feature) => ({ ok: isOk(app.entitlements.consume(userId, feature)) }) },
    });
    return ok(plan);
  });

  // --- Alerts / watchlist ---
  router.post("/watches", (ctx) => {
    const b = asBody(ctx.body);
    const r = app.alerts.addWatch(str(b, "userId"), str(b, "productId"), { lat: num(b, "lat"), lng: num(b, "lng") }, typeof b.radius === "number" ? b.radius : 16000);
    return isOk(r) ? ok(r.value, 201) : ok({ error: r.error }, 402);
  });

  // --- Leaderboard ---
  router.get("/leaderboard", (ctx) => {
    const window = (ctx.query.get("window") ?? "weekly") as "weekly" | "monthly" | "alltime";
    const metro = ctx.query.get("metro") ?? "unknown";
    return ok({ window, metro, entries: app.gamification.leaderboard(window, metro) });
  });

  // --- Referral ---
  router.post("/referrals", (ctx) => ok(app.referral.createInvite(str(asBody(ctx.body), "referrerId")), 201));
  router.post("/referrals/open", (ctx) => {
    const b = asBody(ctx.body);
    const r = app.referral.recordOpen(str(b, "token"), str(b, "referredUserId"));
    return r === undefined ? (() => { throw notFound("referral token"); })() : ok(r);
  });
  router.post("/referrals/evaluate", async (ctx) => {
    const status = await app.referral.evaluate(str(asBody(ctx.body), "referredUserId"));
    return ok({ status });
  });
  router.get("/referrals/:referrerId/progress", (ctx) => ok(app.referral.progress(ctx.params.referrerId!)));

  // --- Local deals feed (also powers AR deal pins) ---
  router.get("/deals/near", (ctx) => {
    const lat = Number(ctx.query.get("lat"));
    const lng = Number(ctx.query.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw badRequest("lat, lng required");
    const radius = Number(ctx.query.get("radius") ?? "16000");
    return ok({ deals: app.alerts.dealsNear({ lat, lng }, radius) });
  });

  // --- AR & wearables ---
  // Device capability matrix — clients call this to learn what their surface can render.
  router.get("/ar/devices", () =>
    ok({
      tiers: {
        phone_ar: "ARKit / ARCore + Geospatial — world + geo anchors, occlusion, route line",
        web_ar: "WebXR / web AR — geo-anchored cards + route, no occlusion",
        glasses_display: "Meta Ray-Ban Display / Snap Spectacles — a few HUD cards, capture",
        glasses_audio: "Ray-Ban Meta (no display) — spoken cues + POV capture",
      },
    }),
  );

  // Build an AR scene tailored to the device tier.
  router.post("/ar/scene", (ctx) => {
    const b = asBody(ctx.body);
    const itemsRaw = Array.isArray(b.items) ? b.items : undefined;
    const items = itemsRaw?.map((i) => { const ib = asBody(i); return { productId: str(ib, "productId"), qty: typeof ib.qty === "number" ? ib.qty : 1 }; });
    const scene = app.arscene.buildScene({
      userId: str(b, "userId"),
      at: { lat: num(b, "lat"), lng: num(b, "lng") },
      deviceTier: (optStr(b, "deviceTier") as "phone_ar" | "web_ar" | "glasses_display" | "glasses_audio") ?? "phone_ar",
      storeId: optStr(b, "storeId"),
      listId: optStr(b, "listId"),
      items,
      mode: (optStr(b, "mode") as "chill" | "balanced" | "max") ?? "balanced",
      radiusMeters: typeof b.radiusMeters === "number" ? b.radiusMeters : undefined,
    });
    return ok(scene);
  });

  // POV-glasses (or web) capture → the same idempotent ingestion pipeline, tagged by channel.
  router.post("/ar/capture", async (ctx) => {
    const b = asBody(ctx.body);
    const contribution = await app.ingestion.submit({
      idempotencyKey: str(b, "idempotencyKey"),
      userId: str(b, "userId"),
      storeId: str(b, "storeId"),
      kind: str(b, "kind") as ContributionType,
      productId: optStr(b, "productId") ?? null,
      reportedPrice: typeof b.reportedPrice === "number" ? b.reportedPrice : null,
      aisle: optStr(b, "aisle") ?? null,
      via: (optStr(b, "via") as "glasses" | "web" | "app") ?? "glasses",
      barcode: optStr(b, "barcode") ?? null,
      text: optStr(b, "text") ?? null,
      mediaHash: optStr(b, "mediaHash") ?? null,
      lat: num(b, "lat"),
      lng: num(b, "lng"),
    });
    return ok(contribution, 201);
  });

  return router;
}
