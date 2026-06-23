// Real launch-city seed data (docs/roadmap.md, docs/research/market-and-unit-economics.md).
// Unlike the SLC demo (seed.ts, used by tests), this seeds an actual metro's dense, chain-diverse
// core so "best nearby price" + trip optimization show real, switchable savings from day one —
// the Uber playbook applied to groceries: seed one tight, walkable, high-price-pain core.
//
//   NYC (primary): a Manhattan/Village core where Trader Joe's, Whole Foods, Key Food, C-Town,
//   Gristedes, and Morton Williams compete within walking distance — max density + price spread.
//   SEA (second metro): a Capitol Hill / downtown Seattle core — proves the city-by-city model.
//
// Selected at boot via SEED_CITY (main.ts). Prices are tier-based per store (Whole Foods high,
// Trader Joe's / Grocery Outlet low) with deterministic per-item jitter, so the spread is realistic
// and the optimizer finds genuine multi-store savings.

import { readFileSync } from "node:fs";
import type { App } from "./app.ts";

export type CityKey = "nyc" | "sea";

type StoreSeed = { id: string; retailer: string; name: string; lat: number; lng: number; tier: number };
type CatalogItem = { id: string; name: string; brand: string | null; category: string; base: number; q: string | null };
type ImageInfo = { imageUrl: string; upc: string; offName: string | null };

// Real-brand catalog + real photos/UPCs (db/catalog.json + db/product-images.json, the latter
// backfilled from Open Food Facts by scripts/fetch-product-images.mjs). Loaded at boot.
const here = (p: string): URL => new URL(p, import.meta.url);
const PRODUCTS: CatalogItem[] = JSON.parse(readFileSync(here("../db/catalog.json"), "utf8")).products;
const IMAGES: Record<string, ImageInfo> = JSON.parse(readFileSync(here("../db/product-images.json"), "utf8"));

const CITIES: Record<CityKey, { metro: string; label: string; center: { lat: number; lng: number }; stores: StoreSeed[] }> = {
  nyc: {
    metro: "nyc",
    label: "New York City",
    center: { lat: 40.7359, lng: -73.9911 }, // Union Square
    stores: [
      { id: "str_nyc_tj", retailer: "Trader Joe's", name: "Trader Joe's Union Square", lat: 40.7345, lng: -73.9908, tier: 0.84 },
      { id: "str_nyc_wf", retailer: "Whole Foods", name: "Whole Foods Union Square", lat: 40.7356, lng: -73.9906, tier: 1.28 },
      { id: "str_nyc_mw", retailer: "Morton Williams", name: "Morton Williams East Village", lat: 40.7330, lng: -73.9875, tier: 1.12 },
      { id: "str_nyc_gr", retailer: "Gristedes", name: "Gristedes East Village", lat: 40.7305, lng: -73.9860, tier: 1.06 },
      { id: "str_nyc_kf", retailer: "Key Food", name: "Key Food Avenue A", lat: 40.7270, lng: -73.9790, tier: 0.96 },
      { id: "str_nyc_ct", retailer: "C-Town", name: "C-Town Lower East Side", lat: 40.7180, lng: -73.9840, tier: 0.9 },
    ],
  },
  sea: {
    metro: "sea",
    label: "Seattle",
    center: { lat: 47.6150, lng: -122.3210 }, // Capitol Hill
    stores: [
      { id: "str_sea_tj", retailer: "Trader Joe's", name: "Trader Joe's Capitol Hill", lat: 47.6150, lng: -122.3210, tier: 0.85 },
      { id: "str_sea_wf", retailer: "Whole Foods", name: "Whole Foods Westlake", lat: 47.6180, lng: -122.3380, tier: 1.26 },
      { id: "str_sea_qfc", retailer: "QFC", name: "QFC Broadway", lat: 47.6190, lng: -122.3210, tier: 1.05 },
      { id: "str_sea_saf", retailer: "Safeway", name: "Safeway Capitol Hill", lat: 47.6100, lng: -122.3270, tier: 1.04 },
      { id: "str_sea_fm", retailer: "Fred Meyer", name: "Fred Meyer Ballard", lat: 47.6680, lng: -122.3840, tier: 0.98 },
      { id: "str_sea_go", retailer: "Grocery Outlet", name: "Grocery Outlet SODO", lat: 47.5800, lng: -122.3300, tier: 0.86 },
    ],
  },
};

// Store-brand swap suggestions ("save by switching brand").
const SWAPS = [{ productId: "prd_eggs", swapProductId: "prd_eggs_sb", kind: "store_brand" as const, avgSavings: 1.3, supportCount: 58 }];

// Deterministic 0..1 from a string (FNV-1a) — stable per-item price jitter without RNG.
function unit(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return ((h >>> 0) % 1000) / 1000;
}
const round2 = (n: number): number => Math.round(n * 100) / 100;

export function isCityKey(v: string | null | undefined): v is CityKey {
  return v === "nyc" || v === "sea";
}

export type CitySeedRefs = { metro: string; label: string; at: { lat: number; lng: number }; stores: number; products: number };

export async function seedCity(app: App, key: CityKey): Promise<CitySeedRefs> {
  const city = CITIES[key];

  for (const p of PRODUCTS) {
    const img = IMAGES[p.id];
    app.catalog.seedProduct({
      id: p.id, name: p.name, brand: p.brand, sizeValue: null, sizeUnit: null,
      category: p.category, isStoreBrand: p.id === "prd_eggs_sb",
      upc: img?.upc ?? null, imageUrl: img?.imageUrl ?? null,
    });
  }
  for (const s of SWAPS) app.catalog.seedSwap(s);

  const stores = city.stores.map((s) => app.catalog.seedStore({ id: s.id, retailer: s.retailer, name: s.name, lat: s.lat, lng: s.lng, metro: city.metro }));
  const cellOf = (storeId: string): string => app.catalog.getStore(storeId)!.cell;
  const asOf = new Date("2026-06-20T12:00:00Z").toISOString();

  for (const store of city.stores) {
    for (const p of PRODUCTS) {
      const j = unit(`${p.id}:${store.id}`); // 0..1
      const jitter = 1 + (j - 0.5) * 0.1; // ±5%
      const value = round2(p.base * store.tier * jitter);
      const confidence = round2(0.78 + unit(`c:${p.id}:${store.id}`) * 0.1); // 0.78..0.88
      await app.bus.publish({ type: "price.updated", productId: p.id, storeId: store.id, price: value, confidence, asOf, source: "crawl", cell: cellOf(store.id) });
    }
  }

  // A couple of crowdsourced aisle locations + a clearance deal at the nearest store (deals feed).
  const first = city.stores[0]!;
  app.catalog.setAisle(first.id, "prd_eggs", "Dairy");
  app.catalog.setAisle(first.id, "prd_milk", "Dairy");
  app.catalog.setAisle(first.id, "prd_cereal", "Aisle 7 · Cereal");
  await app.bus.publish({ type: "deal.reported", storeId: city.stores[city.stores.length - 1]!.id, productId: "prd_doritos", kind: "clearance", cell: cellOf(city.stores[city.stores.length - 1]!.id) });

  // Honeytoken canaries (anti-scraping): real shoppers never request these.
  app.catalog.seedProduct({ id: "prd_canary_1", name: "__canary marker A__", brand: null, sizeValue: null, sizeUnit: null, category: "_canary", isStoreBrand: false, upc: "C0001" });
  app.catalog.seedProduct({ id: "prd_canary_2", name: "__canary marker B__", brand: null, sizeValue: null, sizeUnit: null, category: "_canary", isStoreBrand: false, upc: "C0002" });
  app.abuse.addCanary("prd_canary_1");
  app.abuse.addCanary("prd_canary_2");

  return { metro: city.metro, label: city.label, at: city.center, stores: stores.length, products: PRODUCTS.length };
}
