// Demo seed for Salt Lake City — the MVP's first launch metro (docs/roadmap.md Phase 0).
// Seeds stores, products, a store-brand swap, and baseline prices (pushed through the real
// price.updated handler so the projection is built exactly as it is in production).

import type { App } from "./app.ts";

export type SeedRefs = {
  metro: string;
  at: { lat: number; lng: number };
  stores: { smiths: string; walmart: string; target: string };
  products: { eggs: string; eggsKroger: string; milk: string; cereal: string; bread: string };
};

export async function seedDemo(app: App): Promise<SeedRefs> {
  const metro = "slc";
  const smiths = app.catalog.seedStore({ id: "str_smiths", retailer: "Smith's", name: "Smith's Sugar House", lat: 40.7608, lng: -111.891, metro });
  const walmart = app.catalog.seedStore({ id: "str_walmart", retailer: "Walmart", name: "Walmart Supercenter", lat: 40.755, lng: -111.88, metro });
  const target = app.catalog.seedStore({ id: "str_target", retailer: "Target", name: "Target SLC", lat: 40.77, lng: -111.85, metro });

  app.catalog.seedProduct({ id: "prd_eggs", name: "Eggland's Best Large Eggs 12ct", brand: "Eggland's Best", sizeValue: 12, sizeUnit: "ct", category: "dairy", isStoreBrand: false, upc: "0001" });
  app.catalog.seedProduct({ id: "prd_eggs_kroger", name: "Kroger Large Eggs 12ct", brand: "Kroger", sizeValue: 12, sizeUnit: "ct", category: "dairy", isStoreBrand: true, upc: "0002" });
  app.catalog.seedProduct({ id: "prd_milk", name: "Whole Milk 1gal", brand: null, sizeValue: 1, sizeUnit: "gal", category: "dairy", isStoreBrand: false, upc: "0003" });
  app.catalog.seedProduct({ id: "prd_cereal", name: "Cheerios 18oz", brand: "General Mills", sizeValue: 18, sizeUnit: "oz", category: "pantry", isStoreBrand: false, upc: "0004" });
  app.catalog.seedProduct({ id: "prd_bread", name: "Wheat Bread 20oz", brand: null, sizeValue: 20, sizeUnit: "oz", category: "bakery", isStoreBrand: false, upc: "0005" });

  // "Other shoppers commonly swap Eggland's Best for Kroger eggs and save $2.14."
  app.catalog.seedSwap({ productId: "prd_eggs", swapProductId: "prd_eggs_kroger", kind: "store_brand", avgSavings: 2.14, supportCount: 42 });

  const cell = (storeId: string): string => app.catalog.getStore(storeId)!.cell;
  const price = async (productId: string, storeId: string, value: number) => {
    await app.bus.publish({
      type: "price.updated",
      productId,
      storeId,
      price: value,
      confidence: 0.8,
      asOf: new Date("2026-06-01T12:00:00Z").toISOString(),
      source: "crawl",
      cell: cell(storeId),
    });
  };

  await price("prd_eggs", smiths.id, 5.49);
  await price("prd_eggs", walmart.id, 4.99);
  await price("prd_eggs", target.id, 5.29);
  await price("prd_eggs_kroger", smiths.id, 3.35);
  await price("prd_eggs_kroger", walmart.id, 3.29);
  await price("prd_milk", smiths.id, 3.49);
  await price("prd_milk", walmart.id, 3.19);
  await price("prd_cereal", smiths.id, 5.49);
  await price("prd_cereal", target.id, 3.39);
  await price("prd_cereal", walmart.id, 4.5);
  await price("prd_bread", smiths.id, 2.99);

  return {
    metro,
    at: { lat: 40.7608, lng: -111.891 },
    stores: { smiths: smiths.id, walmart: walmart.id, target: target.id },
    products: { eggs: "prd_eggs", eggsKroger: "prd_eggs_kroger", milk: "prd_milk", cereal: "prd_cereal", bread: "prd_bread" },
  };
}
