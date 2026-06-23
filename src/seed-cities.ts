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

import type { App } from "./app.ts";

export type CityKey = "nyc" | "sea";

type StoreSeed = { id: string; retailer: string; name: string; lat: number; lng: number; tier: number };
type ProductSeed = {
  id: string; name: string; brand: string | null; sizeValue: number | null; sizeUnit: string | null;
  category: string; isStoreBrand: boolean; upc: string; base: number;
};

// Shared national grocery catalog — same products, priced per city/store below.
const PRODUCTS: ProductSeed[] = [
  { id: "prd_eggs", name: "Large Eggs 12ct", brand: "Happy Hen", sizeValue: 12, sizeUnit: "ct", category: "dairy", isStoreBrand: false, upc: "100001", base: 4.5 },
  { id: "prd_eggs_sb", name: "Store Brand Large Eggs 12ct", brand: null, sizeValue: 12, sizeUnit: "ct", category: "dairy", isStoreBrand: true, upc: "100002", base: 3.2 },
  { id: "prd_milk", name: "Whole Milk 1gal", brand: null, sizeValue: 1, sizeUnit: "gal", category: "dairy", isStoreBrand: false, upc: "100003", base: 4.2 },
  { id: "prd_bread", name: "Whole Wheat Bread 20oz", brand: "Hearth", sizeValue: 20, sizeUnit: "oz", category: "bakery", isStoreBrand: false, upc: "100004", base: 3.5 },
  { id: "prd_bananas", name: "Bananas (per lb)", brand: null, sizeValue: 1, sizeUnit: "lb", category: "produce", isStoreBrand: false, upc: "100005", base: 0.69 },
  { id: "prd_chicken", name: "Boneless Chicken Breast (per lb)", brand: null, sizeValue: 1, sizeUnit: "lb", category: "meat", isStoreBrand: false, upc: "100006", base: 5.99 },
  { id: "prd_beef", name: "80/20 Ground Beef (per lb)", brand: null, sizeValue: 1, sizeUnit: "lb", category: "meat", isStoreBrand: false, upc: "100007", base: 6.49 },
  { id: "prd_rice", name: "Jasmine Rice 5lb", brand: "Golden Field", sizeValue: 5, sizeUnit: "lb", category: "pantry", isStoreBrand: false, upc: "100008", base: 8.99 },
  { id: "prd_pasta", name: "Spaghetti 16oz", brand: "Bella", sizeValue: 16, sizeUnit: "oz", category: "pantry", isStoreBrand: false, upc: "100009", base: 1.99 },
  { id: "prd_cereal", name: "Cheerios 18oz", brand: "General Mills", sizeValue: 18, sizeUnit: "oz", category: "pantry", isStoreBrand: false, upc: "100010", base: 5.49 },
  { id: "prd_coffee", name: "Ground Coffee 12oz", brand: "Morning Roast", sizeValue: 12, sizeUnit: "oz", category: "pantry", isStoreBrand: false, upc: "100011", base: 8.99 },
  { id: "prd_oj", name: "Orange Juice 52oz", brand: "Sunny", sizeValue: 52, sizeUnit: "oz", category: "beverage", isStoreBrand: false, upc: "100012", base: 4.99 },
  { id: "prd_butter", name: "Butter 1lb", brand: "Meadow", sizeValue: 1, sizeUnit: "lb", category: "dairy", isStoreBrand: false, upc: "100013", base: 5.49 },
  { id: "prd_cheddar", name: "Sharp Cheddar 8oz", brand: "Tillery", sizeValue: 8, sizeUnit: "oz", category: "dairy", isStoreBrand: false, upc: "100014", base: 4.49 },
  { id: "prd_yogurt", name: "Greek Yogurt 32oz", brand: "Aegean", sizeValue: 32, sizeUnit: "oz", category: "dairy", isStoreBrand: false, upc: "100015", base: 5.99 },
  { id: "prd_pb", name: "Peanut Butter 16oz", brand: "Nutty", sizeValue: 16, sizeUnit: "oz", category: "pantry", isStoreBrand: false, upc: "100016", base: 3.99 },
  { id: "prd_oliveoil", name: "Olive Oil 17oz", brand: "Grove", sizeValue: 17, sizeUnit: "oz", category: "pantry", isStoreBrand: false, upc: "100017", base: 9.99 },
  { id: "prd_paper", name: "Paper Towels 6 rolls", brand: "Plush", sizeValue: 6, sizeUnit: "ct", category: "household", isStoreBrand: false, upc: "100018", base: 9.49 },
  // A few recognizable national brands (real UPCs) so search/scan demos resolve.
  { id: "prd_gatorade", name: "Gatorade Lemon-Lime 28oz", brand: "Gatorade", sizeValue: 28, sizeUnit: "oz", category: "beverage", isStoreBrand: false, upc: "052000338393", base: 1.99 },
  { id: "prd_coke", name: "Coca-Cola 12 pack 12oz cans", brand: "Coca-Cola", sizeValue: 12, sizeUnit: "ct", category: "beverage", isStoreBrand: false, upc: "049000028904", base: 8.49 },
  { id: "prd_doritos", name: "Doritos Nacho Cheese 9.25oz", brand: "Doritos", sizeValue: 9.25, sizeUnit: "oz", category: "snack", isStoreBrand: false, upc: "028400647465", base: 5.49 },
  { id: "prd_lays", name: "Lay's Classic Potato Chips 8oz", brand: "Lay's", sizeValue: 8, sizeUnit: "oz", category: "snack", isStoreBrand: false, upc: "028400090728", base: 4.99 },
];

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
    app.catalog.seedProduct({ id: p.id, name: p.name, brand: p.brand, sizeValue: p.sizeValue, sizeUnit: p.sizeUnit, category: p.category, isStoreBrand: p.isStoreBrand, upc: p.upc });
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
  await app.bus.publish({ type: "deal.reported", storeId: city.stores[city.stores.length - 1]!.id, productId: "prd_chicken", kind: "clearance", cell: cellOf(city.stores[city.stores.length - 1]!.id) });

  // Honeytoken canaries (anti-scraping): real shoppers never request these.
  app.catalog.seedProduct({ id: "prd_canary_1", name: "__canary marker A__", brand: null, sizeValue: null, sizeUnit: null, category: "_canary", isStoreBrand: false, upc: "C0001" });
  app.catalog.seedProduct({ id: "prd_canary_2", name: "__canary marker B__", brand: null, sizeValue: null, sizeUnit: null, category: "_canary", isStoreBrand: false, upc: "C0002" });
  app.abuse.addCanary("prd_canary_1");
  app.abuse.addCanary("prd_canary_2");

  return { metro: city.metro, label: city.label, at: city.center, stores: stores.length, products: PRODUCTS.length };
}
