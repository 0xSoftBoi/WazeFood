// Optimization & Routing (docs/ARCHITECTURE.md §4.5). Token-gated, and *layered like Meituan*
// (proven-patterns-east.md §3): a cheap real-time tier serves most carts from a precompute
// cache; novel carts fall through to the planning tier. Always emits the explainable savings
// breakdown (swaps / store差 / −gas), and accounts for gas so "saving $4" never silently
// costs a 25-minute drive unless the user picked Max Savings.

import type { Cache } from "../../platform/cache/cache.ts";
import { cellOf, distanceMeters, type LatLng } from "../../platform/geo/h3.ts";
import type { RoutingMode } from "../identity/service.ts";

export type OptimizeItem = { productId: string; qty: number };

export type PlannedItem = {
  productId: string;
  qty: number;
  storeId: string;
  unitPrice: number;
  swappedFrom: string | null;
};

export type SavingsBreakdown = {
  productSwaps: number;
  storeDifferences: number;
  coupons: number;
  gasEstimate: number; // negative
};

export type CartPlan = {
  mode: RoutingMode;
  locked: boolean; // true => free user out of tokens; show total but gate the detail
  baselineStoreId: string;
  baselineCost: number;
  optimizedCost: number;
  estimatedSavings: number;
  breakdown: SavingsBreakdown;
  stores: Array<{ storeId: string; items: PlannedItem[] }>;
};

// Ports — optimization reads pricing & catalog, never their storage.
export type PricingPort = {
  bestNearbyPrice: (
    productId: string,
    at: LatLng,
    radiusMeters: number,
  ) => { storeId: string; price: number } | undefined;
  priceAtStore: (productId: string, storeId: string) => number | undefined;
};
export type CatalogPort = {
  nearbyStores: (at: LatLng, radiusMeters: number) => Array<{ id: string; lat: number; lng: number }>;
  swapsFor: (productId: string) => Array<{ swapProductId: string; avgSavings: number }>;
};
export type MeterPort = { consume: (userId: string, feature: "cart_optimize") => { ok: boolean } };

const RADIUS_M = 15_000;
const GAS_PER_KM = 0.15; // $ per km, round-trip applied per extra store

export class OptimizationService {
  private readonly deps: { cache: Cache; pricing: PricingPort; catalog: CatalogPort; h3Resolution: number };
  constructor(deps: { cache: Cache; pricing: PricingPort; catalog: CatalogPort; h3Resolution: number }) {
    this.deps = deps;
  }

  private cacheKey(items: OptimizeItem[], cell: string, mode: RoutingMode): string {
    const norm = [...items].sort((a, b) => a.productId.localeCompare(b.productId)).map((i) => `${i.productId}x${i.qty}`).join(",");
    return `opt:${cell}:${mode}:${norm}`;
  }

  optimize(input: {
    userId: string;
    items: OptimizeItem[];
    at: LatLng;
    mode: RoutingMode;
    meter: MeterPort;
  }): CartPlan | { error: "no_stores" | "no_prices" } {
    const stores = this.deps.catalog.nearbyStores(input.at, RADIUS_M);
    if (stores.length === 0) return { error: "no_stores" };
    const baselineStore = stores[0]!;

    // Real-time tier: precompute cache hit returns immediately (cheap path).
    const cell = cellOf(input.at, this.deps.h3Resolution);
    const ck = this.cacheKey(input.items, cell, input.mode);
    const cached = this.deps.cache.get<CartPlan>(ck);

    // Token gate: free users get a limited number of optimizations (PDF feature matrix).
    const allowed = input.meter.consume(input.userId, "cart_optimize").ok;

    const plan = cached ?? this.plan(input.items, input.at, baselineStore, input.mode);
    if (plan === undefined) return { error: "no_prices" };
    if (cached === undefined) this.deps.cache.set(ck, plan, 5 * 60_000);

    if (!allowed) {
      // Locked preview: reveal the headline savings (the paywall hook) but hide the detail.
      return { ...plan, locked: true, stores: [], breakdown: { ...plan.breakdown }, };
    }
    return { ...plan, locked: false };
  }

  private plan(
    items: OptimizeItem[],
    at: LatLng,
    baselineStore: { id: string; lat: number; lng: number },
    mode: RoutingMode,
  ): CartPlan | undefined {
    let baselineCost = 0;
    let swapSavings = 0;
    let storeSavings = 0;
    const usedStores = new Map<string, PlannedItem[]>();
    const addItem = (storeId: string, item: PlannedItem) => {
      const list = usedStores.get(storeId) ?? [];
      list.push(item);
      usedStores.set(storeId, list);
    };

    let pricedAny = false;
    for (const it of items) {
      const baseP = this.deps.pricing.priceAtStore(it.productId, baselineStore.id)
        ?? this.deps.pricing.bestNearbyPrice(it.productId, at, RADIUS_M)?.price;
      if (baseP === undefined) continue; // no data for this item
      pricedAny = true;
      baselineCost += baseP * it.qty;

      // Best swap (held at baseline store for attribution clarity).
      let chosenProduct = it.productId;
      let chosenPrice = baseP;
      let swappedFrom: string | null = null;
      for (const sw of this.deps.catalog.swapsFor(it.productId)) {
        const swP = this.deps.pricing.priceAtStore(sw.swapProductId, baselineStore.id)
          ?? this.deps.pricing.bestNearbyPrice(sw.swapProductId, at, RADIUS_M)?.price;
        if (swP !== undefined && swP < chosenPrice) {
          chosenPrice = swP;
          chosenProduct = sw.swapProductId;
          swappedFrom = it.productId;
        }
      }
      swapSavings += (baseP - chosenPrice) * it.qty;

      // Store choice (Chill stays at baseline; Balanced/Max may move to the cheapest store).
      let storeId = baselineStore.id;
      let finalPrice = chosenPrice;
      if (mode !== "chill") {
        const best = this.deps.pricing.bestNearbyPrice(chosenProduct, at, RADIUS_M);
        if (best !== undefined && best.price < chosenPrice) {
          storeId = best.storeId;
          storeSavings += (chosenPrice - best.price) * it.qty;
          finalPrice = best.price;
        }
      }
      addItem(storeId, { productId: chosenProduct, qty: it.qty, storeId, unitPrice: finalPrice, swappedFrom });
    }
    if (!pricedAny) return undefined;

    // Gas: charge per extra store beyond the baseline, round-trip from `at`.
    const extraStoreIds = [...usedStores.keys()].filter((id) => id !== baselineStore.id);
    let gas = 0;
    for (const id of extraStoreIds) {
      const s = this.findStore(id, at);
      if (s !== undefined) gas += (distanceMeters(at, s) / 1000) * 2 * GAS_PER_KM;
    }

    // Balanced: only keep the multi-store split if store savings beat the gas it costs.
    if (mode === "balanced" && storeSavings <= gas) {
      return this.plan(items, at, baselineStore, "chill");
    }

    const breakdown: SavingsBreakdown = {
      productSwaps: round2(swapSavings),
      storeDifferences: round2(storeSavings),
      coupons: 0,
      gasEstimate: -round2(gas),
    };
    const estimatedSavings = round2(swapSavings + storeSavings - gas);
    return {
      mode,
      locked: false,
      baselineStoreId: baselineStore.id,
      baselineCost: round2(baselineCost),
      optimizedCost: round2(baselineCost - estimatedSavings),
      estimatedSavings,
      breakdown,
      stores: [...usedStores.entries()].map(([storeId, items]) => ({ storeId, items })),
    };
  }

  // The catalog port doesn't expose a single-store lookup with coords, so recover it from the
  // nearby list (small, already in hand in practice).
  private findStore(storeId: string, at: LatLng): LatLng | undefined {
    const s = this.deps.catalog.nearbyStores(at, RADIUS_M).find((x) => x.id === storeId);
    return s === undefined ? undefined : { lat: s.lat, lng: s.lng };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
