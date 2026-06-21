// Composition root. Builds every bounded-context service, wires the cross-module *ports*
// (each module exposes only a narrow interface to others), and subscribes modules to the
// event bus. This file is the one place that knows how the modules fit together — the seam
// that lets any module be lifted into its own service later (docs/ARCHITECTURE.md §2).

import { type Config, loadConfig } from "./config.ts";
import { systemClock, type Clock } from "./platform/clock.ts";
import { MemoryCache, type Cache } from "./platform/cache/cache.ts";
import { memoryTableFactory, type TableFactory } from "./platform/store/store.ts";
import { EventBus } from "./platform/events/bus.ts";
import { IdentityService } from "./modules/identity/service.ts";
import { CatalogService } from "./modules/catalog/service.ts";
import { PricingService } from "./modules/pricing/service.ts";
import { IngestionService } from "./modules/ingestion/service.ts";
import { EntitlementsService } from "./modules/entitlements/service.ts";
import { GamificationService } from "./modules/gamification/service.ts";
import { AlertsService } from "./modules/alerts/service.ts";
import { OptimizationService } from "./modules/optimization/service.ts";
import { ReferralService } from "./modules/referral/service.ts";
import { ListsService } from "./modules/lists/service.ts";
import { ARSceneService } from "./modules/arscene/service.ts";
import { MatchingService } from "./modules/matching/service.ts";
import { RoutingPerception } from "./modules/ingestion/perception.ts";

export type App = ReturnType<typeof buildApp>;

// Optional overrides let a durable bootstrap inject a persistent table factory and a Redis
// cache (see src/bootstrap.ts); defaults are the zero-dependency in-memory adapters.
export type BuildOpts = { tables?: TableFactory; cache?: Cache };

export function buildApp(config: Config = loadConfig(), clock: Clock = systemClock, opts: BuildOpts = {}) {
  const cache = opts.cache ?? new MemoryCache(clock);
  const tables = opts.tables ?? memoryTableFactory;
  const bus = new EventBus(({ event, error }) => {
    console.error(`[bus] handler failed for ${event.type}:`, error);
  });
  const h3Resolution = config.h3Resolution;

  // --- Services (no cross-module wiring yet) ---
  const identity = new IdentityService({ tables });
  const catalog = new CatalogService({ bus, h3Resolution, tables });
  const gamification = new GamificationService({ cache, clock, tables });
  const entitlements = new EntitlementsService({ cache, clock, tables });

  const pricing = new PricingService({
    bus,
    cache,
    tables,
    stores: {
      nearby: (at, r) =>
        catalog.nearbyStores(at, r).map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, cell: s.cell, distanceMeters: s.distanceMeters })),
    },
  });

  const matching = new MatchingService({
    catalog: {
      getByUpc: (upc) => { const p = catalog.getByUpc(upc); return p === undefined ? undefined : { id: p.id }; },
      listProducts: () => catalog.listProducts().map((p) => ({ id: p.id, name: p.name, brand: p.brand })),
    },
  });
  const perception = new RoutingPerception();

  const ingestion = new IngestionService({
    bus,
    h3Resolution,
    tables,
    stores: { get: (id) => { const s = catalog.getStore(id); return s === undefined ? undefined : { lat: s.lat, lng: s.lng, metro: s.metro }; } },
    reputation: { reputation: (userId) => gamification.reputation(userId) },
    priorPrice: { getProjection: (p, s) => pricing.getProjection(p, s) },
    locations: { setAisle: (storeId, productId, section) => catalog.setAisle(storeId, productId, section) },
    matching: { resolve: (i) => matching.resolve(i) },
    perception: { perceive: (i) => perception.perceive(i) },
  });

  // Meter adapter reused by optimization callers (free cart-optimize tokens).
  const optimizeMeter = { consume: (userId: string, feature: "cart_optimize") => ({ ok: entitlements.consume(userId, feature).ok }) };

  const arscene = new ARSceneService({
    meter: optimizeMeter,
    pricing: {
      priceAtStore: (p, s) => pricing.getProjection(p, s)?.price,
      bestNearbyPrice: (p, at, r) => pricing.bestNearbyPrice(p, at, r),
    },
    catalog: {
      nearbyStores: (at, r) => catalog.nearbyStores(at, r).map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, distanceMeters: s.distanceMeters })),
      getStore: (id) => { const s = catalog.getStore(id); return s === undefined ? undefined : { name: s.name, lat: s.lat, lng: s.lng }; },
      getProduct: (id) => { const p = catalog.getProduct(id); return p === undefined ? undefined : { canonicalName: p.name }; },
      getAisle: (storeId, productId) => catalog.getAisle(storeId, productId),
    },
    deals: { dealsNear: (at, r) => alerts.dealsNear(at, r).map((d) => ({ storeId: d.storeId, productId: d.productId, kind: d.kind })) },
    optimize: {
      optimize: (i) => optimization.optimize(i),
    },
    lists: { getList: (id) => { const l = lists.getList(id); return l === undefined ? undefined : { items: l.items.map((it) => ({ productId: it.productId, qty: it.qty })) }; } },
  });

  const optimization = new OptimizationService({
    cache,
    h3Resolution,
    pricing: {
      bestNearbyPrice: (p, at, r) => pricing.bestNearbyPrice(p, at, r),
      priceAtStore: (p, s) => pricing.getProjection(p, s)?.price,
    },
    catalog: {
      nearbyStores: (at, r) => catalog.nearbyStores(at, r).map((s) => ({ id: s.id, lat: s.lat, lng: s.lng })),
      swapsFor: (p) => catalog.swapsFor(p).map((sw) => ({ swapProductId: sw.swapProductId, avgSavings: sw.avgSavings })),
    },
  });

  const alerts = new AlertsService({
    entitlements: { isPremium: (userId) => entitlements.isPremium(userId) },
    h3Resolution,
    tables,
  });

  const referral = new ReferralService({
    bus,
    tables,
    identity: { getUser: (id) => { const u = identity.getUser(id); return u === undefined ? undefined : { phoneVerified: u.phoneVerified, homeZip: u.homeZip }; } },
    rewards: { grantPremiumDays: (userId, days, source) => entitlements.grantPremiumDays(userId, days, source) },
  });

  const lists = new ListsService({
    h3Resolution,
    tables,
    activity: { recordActivity: (userId, delta) => referral.recordActivity(userId, delta) },
    pricing: { bestNearbyPrice: (p, at, r) => pricing.bestNearbyPrice(p, at, r) },
  });

  // --- Event subscriptions (the async backbone) ---
  const metroOf = (storeId: string): string => catalog.getStore(storeId)?.metro ?? "unknown";

  bus.on("price.updated", (e) => pricing.onPriceUpdated(e));
  bus.on("price.dropped", (e) => { alerts.onPriceDropped(e); });
  bus.on("deal.reported", (e) => { alerts.onDealReported(e); });
  bus.on("contribution.received", (e) => { gamification.awardForContribution(e.userId, e.kind, metroOf(e.storeId)); });

  return { config, clock, cache, bus, identity, catalog, pricing, ingestion, entitlements, gamification, alerts, optimization, referral, lists, arscene, matching, perception };
}
