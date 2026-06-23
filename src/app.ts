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
import { MatchingService, normalizeText } from "./modules/matching/service.ts";
import { hashingEmbeddings, voyageEmbeddings, type Embeddings } from "./modules/matching/embeddings.ts";
import { memoryRepositories, type Repositories } from "./platform/store/repositories.ts";
import { RoutingPerception } from "./modules/ingestion/perception.ts";
import { anthropicExtractor, deterministicExtractor, type Extractor } from "./modules/ingestion/extractor.ts";
import { OutboxService } from "./modules/outbox/service.ts";
import { AbuseScoreService } from "./modules/abuse/service.ts";
import { AuthService, devVerifier, type IdentityVerifier } from "./modules/auth/service.ts";
import { OidcVerifier, googleProvider, appleProvider, type ProviderConfig } from "./platform/auth/oidc.ts";

export type App = ReturnType<typeof buildApp>;

// Choose the provider-token verifier: when OAuth client IDs are configured, verify Apple/Google
// id_tokens for real (RS256/ES256 against live JWKS); otherwise the dev "subject|email" stand-in.
function buildVerifier(config: Config, clock: Clock): IdentityVerifier {
  const providers: Record<string, ProviderConfig> = {};
  if (config.oidcGoogleAudiences.length > 0) providers.google = googleProvider({ audiences: config.oidcGoogleAudiences, clock });
  if (config.oidcAppleAudiences.length > 0) providers.apple = appleProvider({ audiences: config.oidcAppleAudiences, clock });
  return Object.keys(providers).length > 0 ? new OidcVerifier({ providers, clock }) : devVerifier;
}

// Real VLM perception (Anthropic Messages API: cheap Haiku tier → escalate to Opus) when an API key
// is configured; otherwise the deterministic stub keeps the default build zero-dependency.
function buildExtractor(config: Config): Extractor {
  if (config.anthropicApiKey !== null) {
    return anthropicExtractor({
      apiKey: config.anthropicApiKey,
      cheapModel: config.perceptionCheapModel,
      expensiveModel: config.perceptionExpensiveModel,
    });
  }
  return deterministicExtractor();
}

// Real semantic embeddings (Voyage AI) for product matching when a key is configured; otherwise the
// deterministic local feature-hashing embedder, normalized with the matcher's own tokenizer.
function buildEmbeddings(config: Config): Embeddings {
  if (config.voyageApiKey !== null) {
    return voyageEmbeddings({ apiKey: config.voyageApiKey, model: config.embeddingModel });
  }
  return hashingEmbeddings({ normalizer: normalizeText });
}

// Optional overrides let a durable bootstrap inject a persistent table factory and a Redis
// cache (see src/bootstrap.ts); defaults are the zero-dependency in-memory adapters.
export type BuildOpts = { tables?: TableFactory; cache?: Cache; repositories?: Repositories };

export function buildApp(config: Config = loadConfig(), clock: Clock = systemClock, opts: BuildOpts = {}) {
  const cache = opts.cache ?? new MemoryCache(clock);
  const tables = opts.tables ?? memoryTableFactory;
  const repositories = opts.repositories ?? memoryRepositories();
  const bus = new EventBus(({ event, error }) => {
    console.error(`[bus] handler failed for ${event.type}:`, error);
  });
  const h3Resolution = config.h3Resolution;

  // --- Services (no cross-module wiring yet) ---
  // Outbox records every published event (durable event log); wired to the bus below.
  const outbox = new OutboxService({ tables });
  bus.onPublish((event) => outbox.record(event));

  // Anti-scraping abuse scorer (the domain-specific layer; edge/attestation are bought).
  const abuse = new AbuseScoreService({ cache, clock, h3Resolution, tables, deviceHardPerMin: config.rateLimitPerMin });

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
    embeddings: buildEmbeddings(config),
    vectors: repositories.vectors,
  });
  const perception = new RoutingPerception({ extractor: buildExtractor(config) });

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

  // Auth: session minting + rotating refresh + anonymous→identity upgrade (IdP is bought).
  const auth = new AuthService({
    tables, clock,
    verifier: buildVerifier(config, clock),
    accessSecret: config.authSecret,
    accessTtlSec: config.accessTtlSec,
    refreshTtlSec: config.refreshTtlSec,
    identity: {
      getUser: (id) => identity.getUser(id),
      createAnonymousUser: (input) => identity.createAnonymousUser(input),
      attachAuth: (userId, provider) => identity.attachAuth(userId, provider),
    },
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

  return { config, clock, cache, bus, outbox, abuse, auth, identity, catalog, pricing, ingestion, entitlements, gamification, alerts, optimization, referral, lists, arscene, matching, perception, repositories };
}
