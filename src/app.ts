// Composition root. Builds every bounded-context service, wires the cross-module *ports*
// (each module exposes only a narrow interface to others), and subscribes modules to the
// event bus. This file is the one place that knows how the modules fit together — the seam
// that lets any module be lifted into its own service later (docs/ARCHITECTURE.md §2).

import { type Config, loadConfig } from "./config.ts";
import { systemClock, type Clock } from "./platform/clock.ts";
import { MemoryCache } from "./platform/cache/cache.ts";
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

export type App = ReturnType<typeof buildApp>;

export function buildApp(config: Config = loadConfig(), clock: Clock = systemClock) {
  const cache = new MemoryCache(clock);
  const bus = new EventBus(({ event, error }) => {
    console.error(`[bus] handler failed for ${event.type}:`, error);
  });
  const h3Resolution = config.h3Resolution;

  // --- Services (no cross-module wiring yet) ---
  const identity = new IdentityService();
  const catalog = new CatalogService({ bus, h3Resolution });
  const gamification = new GamificationService({ cache, clock });
  const entitlements = new EntitlementsService({ cache, clock });

  const pricing = new PricingService({
    bus,
    cache,
    stores: {
      nearby: (at, r) =>
        catalog.nearbyStores(at, r).map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, cell: s.cell, distanceMeters: s.distanceMeters })),
    },
  });

  const ingestion = new IngestionService({
    bus,
    h3Resolution,
    stores: { get: (id) => { const s = catalog.getStore(id); return s === undefined ? undefined : { lat: s.lat, lng: s.lng, metro: s.metro }; } },
    reputation: { reputation: (userId) => gamification.reputation(userId) },
    priorPrice: { getProjection: (p, s) => pricing.getProjection(p, s) },
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
  });

  const referral = new ReferralService({
    bus,
    identity: { getUser: (id) => { const u = identity.getUser(id); return u === undefined ? undefined : { phoneVerified: u.phoneVerified, homeZip: u.homeZip }; } },
    rewards: { grantPremiumDays: (userId, days, source) => entitlements.grantPremiumDays(userId, days, source) },
  });

  const lists = new ListsService({
    h3Resolution,
    activity: { recordActivity: (userId, delta) => referral.recordActivity(userId, delta) },
    pricing: { bestNearbyPrice: (p, at, r) => pricing.bestNearbyPrice(p, at, r) },
  });

  // --- Event subscriptions (the async backbone) ---
  const metroOf = (storeId: string): string => catalog.getStore(storeId)?.metro ?? "unknown";

  bus.on("price.updated", (e) => pricing.onPriceUpdated(e));
  bus.on("price.dropped", (e) => { alerts.onPriceDropped(e); });
  bus.on("deal.reported", (e) => { alerts.onDealReported(e); });
  bus.on("contribution.received", (e) => { gamification.awardForContribution(e.userId, e.kind, metroOf(e.storeId)); });

  return { config, clock, cache, bus, identity, catalog, pricing, ingestion, entitlements, gamification, alerts, optimization, referral, lists };
}
