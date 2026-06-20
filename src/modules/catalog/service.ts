// Catalog & Product Match (docs/ARCHITECTURE.md §4.2). Canonical product graph + stores +
// store-brand/swap equivalences. Resolves barcode/text inputs to canonical products and
// lets users add products that aren't in the catalog yet (emitting product.created).

import type { EventBus } from "../../platform/events/bus.ts";
import { cellOf, distanceMeters, type LatLng } from "../../platform/geo/h3.ts";
import { newId } from "../../platform/id.ts";
import { MemoryTable } from "../../platform/store/store.ts";

export type Product = {
  id: string;
  name: string;
  brand: string | null;
  sizeValue: number | null;
  sizeUnit: string | null;
  category: string;
  isStoreBrand: boolean;
  upc: string | null;
};

export type Store = {
  id: string;
  retailer: string;
  name: string;
  lat: number;
  lng: number;
  metro: string;
  cell: string;
};

// "Other shoppers commonly swap X for Y and save $Z" (docs PDF). support_count grows with use.
export type Swap = {
  id: string;
  productId: string;
  swapProductId: string;
  kind: "exact" | "store_brand" | "size" | "unit";
  avgSavings: number;
  supportCount: number;
};

export class CatalogService {
  private readonly products = new MemoryTable<Product>();
  private readonly stores = new MemoryTable<Store>();
  private readonly swaps = new MemoryTable<Swap>();
  // Crowdsourced "where is this product in the store" (PDF: aisle/location reporting).
  private readonly aisles = new MemoryTable<{ id: string; storeId: string; productId: string; section: string; updatedAt: string }>();

  private readonly deps: { bus: EventBus; h3Resolution: number };
  constructor(deps: { bus: EventBus; h3Resolution: number }) {
    this.deps = deps;
  }

  seedProduct(p: Omit<Product, "id"> & { id?: string }): Product {
    return this.products.upsert({ ...p, id: p.id ?? newId("prd") });
  }

  seedStore(s: Omit<Store, "id" | "cell"> & { id?: string }): Store {
    const cell = cellOf({ lat: s.lat, lng: s.lng }, this.deps.h3Resolution);
    return this.stores.upsert({ ...s, id: s.id ?? newId("str"), cell });
  }

  seedSwap(s: Omit<Swap, "id"> & { id?: string }): Swap {
    return this.swaps.upsert({ ...s, id: s.id ?? newId("swp") });
  }

  getProduct(id: string): Product | undefined {
    return this.products.get(id);
  }

  getStore(id: string): Store | undefined {
    return this.stores.get(id);
  }

  // Resolve by UPC first, else by case-insensitive name contains. Returns the best match.
  resolve(input: { upc?: string; text?: string }): Product | undefined {
    if (input.upc !== undefined) {
      const byUpc = this.products.findOne((p) => p.upc === input.upc);
      if (byUpc !== undefined) return byUpc;
    }
    if (input.text !== undefined) {
      const q = input.text.toLowerCase();
      const matches = this.products.find((p) => p.name.toLowerCase().includes(q));
      return matches[0];
    }
    return undefined;
  }

  search(text: string): Product[] {
    const q = text.toLowerCase();
    return this.products.find((p) => p.name.toLowerCase().includes(q));
  }

  async createUserProduct(input: Omit<Product, "id">): Promise<Product> {
    const product = this.products.insert({ ...input, id: newId("prd") });
    await this.deps.bus.publish({ type: "product.created", productId: product.id, source: "user" });
    return product;
  }

  // Aisle/section location for in-store AR product cards ("Milk — aisle 12").
  setAisle(storeId: string, productId: string, section: string): void {
    this.aisles.upsert({ id: `${storeId}|${productId}`, storeId, productId, section, updatedAt: new Date().toISOString() });
  }

  getAisle(storeId: string, productId: string): string | undefined {
    return this.aisles.get(`${storeId}|${productId}`)?.section;
  }

  swapsFor(productId: string): Swap[] {
    return this.swaps.find((s) => s.productId === productId).sort((a, b) => a.avgSavings - b.avgSavings);
  }

  // Stores within `radiusMeters` of a point, nearest first.
  nearbyStores(at: LatLng, radiusMeters: number): Array<Store & { distanceMeters: number }> {
    return this.stores
      .all()
      .map((s) => ({ ...s, distanceMeters: distanceMeters(at, { lat: s.lat, lng: s.lng }) }))
      .filter((s) => s.distanceMeters <= radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }
}
