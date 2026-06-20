// Pricing & Geo Index (docs/ARCHITECTURE.md §4.3) — SmartCart's Meta-TAO. The hot read path
// never aggregates raw reports: it serves a `current_price` projection updated write-through
// from price.updated events, behind an H3-cell-keyed follower cache. Drop detection (compare
// prior projection to the new value) emits price.dropped, the trigger for Alerts.

import type { Cache } from "../../platform/cache/cache.ts";
import type { EventBus } from "../../platform/events/bus.ts";
import type { LatLng } from "../../platform/geo/h3.ts";
import { MemoryTable } from "../../platform/store/store.ts";
import type { PriceSource } from "../../platform/events/events.ts";

export type CurrentPrice = {
  id: string; // `${productId}|${storeId}`
  productId: string;
  storeId: string;
  price: number;
  confidence: number;
  asOf: string;
  source: PriceSource;
  cell: string;
};

export type PriceHistoryRow = {
  id: string;
  productId: string;
  storeId: string;
  ts: string;
  price: number;
  confidence: number;
};

// Pricing depends only on *where* stores are, not on the Catalog module's internals.
export type StoreLocatorPort = {
  nearby: (at: LatLng, radiusMeters: number) => Array<{ id: string; lat: number; lng: number; cell: string; distanceMeters: number }>;
};

export type BestPrice = {
  productId: string;
  storeId: string;
  price: number;
  unitOk: boolean;
  confidence: number;
  asOf: string;
  distanceMeters: number;
};

const FOLLOWER_TTL_MS = 30_000; // short TTL: freshness locality (recent prices are hottest)

function key(productId: string, storeId: string): string {
  return `${productId}|${storeId}`;
}

export class PricingService {
  private readonly projection = new MemoryTable<CurrentPrice>();
  private readonly history = new MemoryTable<PriceHistoryRow>();

  private readonly deps: { bus: EventBus; cache: Cache; stores: StoreLocatorPort };
  constructor(deps: { bus: EventBus; cache: Cache; stores: StoreLocatorPort }) {
    this.deps = deps;
  }

  // Event handler: write-through projection update + history append + drop detection.
  async onPriceUpdated(e: {
    productId: string;
    storeId: string;
    price: number;
    confidence: number;
    asOf: string;
    source: PriceSource;
    cell: string;
  }): Promise<void> {
    const prior = this.projection.get(key(e.productId, e.storeId));
    this.projection.upsert({
      id: key(e.productId, e.storeId),
      productId: e.productId,
      storeId: e.storeId,
      price: e.price,
      confidence: e.confidence,
      asOf: e.asOf,
      source: e.source,
      cell: e.cell,
    });
    this.history.insert({
      id: `${key(e.productId, e.storeId)}|${e.asOf}`,
      productId: e.productId,
      storeId: e.storeId,
      ts: e.asOf,
      price: e.price,
      confidence: e.confidence,
    });
    // Bust the follower cache for this product+store (EVCache-style invalidation message).
    this.cacheBust(e.productId, e.storeId);

    if (prior !== undefined && e.price < prior.price) {
      await this.deps.bus.publish({
        type: "price.dropped",
        productId: e.productId,
        storeId: e.storeId,
        oldPrice: prior.price,
        newPrice: e.price,
        cell: e.cell,
      });
    }
  }

  // Follower-cache key is per projection row (product+store). The H3 cell remains the shard
  // key for the table; one cell can hold several stores, so it must not key the row cache.
  private cacheKey(productId: string, storeId: string): string {
    return `price:${productId}:${storeId}`;
  }

  private cacheBust(productId: string, storeId: string): void {
    this.deps.cache.del(this.cacheKey(productId, storeId));
  }

  getProjection(productId: string, storeId: string): CurrentPrice | undefined {
    return this.projection.get(key(productId, storeId));
  }

  priceHistory(productId: string, storeId: string): PriceHistoryRow[] {
    return this.history
      .find((h) => h.productId === productId && h.storeId === storeId)
      .sort((a, b) => a.ts.localeCompare(b.ts));
  }

  // "Best nearby price" — the dominant query. Follower-cache hit returns O(1); a miss fills
  // from the projection ("leader") and repopulates the follower.
  bestNearbyPrice(productId: string, at: LatLng, radiusMeters: number): BestPrice | undefined {
    const stores = this.deps.stores.nearby(at, radiusMeters);
    let best: BestPrice | undefined;
    for (const s of stores) {
      const cacheK = this.cacheKey(productId, s.id);
      let proj = this.deps.cache.get<CurrentPrice>(cacheK);
      if (proj === undefined) {
        proj = this.projection.get(key(productId, s.id));
        if (proj !== undefined) this.deps.cache.set(cacheK, proj, FOLLOWER_TTL_MS);
      }
      if (proj === undefined) continue;
      const candidate: BestPrice = {
        productId,
        storeId: s.id,
        price: proj.price,
        unitOk: true,
        confidence: proj.confidence,
        asOf: proj.asOf,
        distanceMeters: s.distanceMeters,
      };
      if (best === undefined || candidate.price < best.price) best = candidate;
    }
    return best;
  }
}
