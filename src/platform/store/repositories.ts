// Dedicated relational repositories — the targeted graduation off the generic JSONB doc-store for
// the three concerns that actually need database engine features (docs/research/realtime-geospatial.md,
// receipt-ocr-product-matching.md):
//   - VectorIndex      → products.embedding, ANN nearest-neighbour (pgvector at scale)
//   - GeoStoreIndex    → stores.geom, radius search (PostGIS ST_DWithin + GiST)
//   - PriceHistory     → price_history, time-bucketed reads (TimescaleDB hypertable)
// KV-shaped data stays on the doc-store. Each interface has an in-memory implementation (the default,
// correct and fast at MVP scale, fully tested) and a Postgres implementation in pg-repositories.ts
// (gated, exercised by the live integration test).

import { cosine } from "../../modules/matching/embeddings.ts";
import { distanceMeters } from "../geo/h3.ts";

// --- Vector index (product embeddings) ---
// Async + batched so a real pgvector backend issues one query per operation, not N. The matcher
// loads existing (id, signature) pairs to compute what changed, upserts the diff, and queries NN.
export type VectorIndex = {
  loadSignatures: () => Promise<Array<{ id: string; sig: string }>>;
  upsertMany: (rows: Array<{ id: string; sig: string; vec: number[] }>) => Promise<void>;
  removeMany: (ids: string[]) => Promise<void>;
  nearest: (query: number[], k: number) => Promise<Array<{ id: string; score: number }>>;
};

// Brute-force cosine over an in-memory map. Exact (not approximate) — at MVP catalog sizes this is
// both correct and fast; pgvector's ivfflat ANN takes over when the catalog is large.
export class MemoryVectorIndex implements VectorIndex {
  private readonly rows = new Map<string, { sig: string; vec: number[] }>();
  async loadSignatures(): Promise<Array<{ id: string; sig: string }>> {
    return [...this.rows.entries()].map(([id, r]) => ({ id, sig: r.sig }));
  }
  async upsertMany(rows: Array<{ id: string; sig: string; vec: number[] }>): Promise<void> {
    for (const r of rows) this.rows.set(r.id, { sig: r.sig, vec: r.vec });
  }
  async removeMany(ids: string[]): Promise<void> {
    for (const id of ids) this.rows.delete(id);
  }
  async nearest(query: number[], k: number): Promise<Array<{ id: string; score: number }>> {
    const scored = [...this.rows.entries()].map(([id, r]) => ({ id, score: cosine(query, r.vec) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }
}

// --- Geo store index (radius search) ---
export type GeoStore = { id: string; lat: number; lng: number };
export type GeoStoreIndex = {
  upsert: (store: GeoStore) => Promise<void>;
  remove: (id: string) => Promise<void>;
  nearby: (lat: number, lng: number, radiusMeters: number) => Promise<Array<{ id: string; meters: number }>>;
};

// Haversine filter over an in-memory map (PostGIS ST_DWithin equivalent for one node).
export class MemoryGeoStoreIndex implements GeoStoreIndex {
  private readonly rows = new Map<string, GeoStore>();
  async upsert(store: GeoStore): Promise<void> { this.rows.set(store.id, store); }
  async remove(id: string): Promise<void> { this.rows.delete(id); }
  async nearby(lat: number, lng: number, radiusMeters: number): Promise<Array<{ id: string; meters: number }>> {
    const here = { lat, lng };
    return [...this.rows.values()]
      .map((s) => ({ id: s.id, meters: distanceMeters(here, { lat: s.lat, lng: s.lng }) }))
      .filter((r) => r.meters <= radiusMeters)
      .sort((a, b) => a.meters - b.meters);
  }
}

// --- Price history (time series) ---
export type PricePoint = { productId: string; storeId: string; price: number; confidence: number; at: string };
export type PriceHistory = {
  append: (point: PricePoint) => Promise<void>;
  range: (productId: string, storeId: string, fromISO: string, toISO: string) => Promise<PricePoint[]>;
  latest: (productId: string, storeId: string) => Promise<PricePoint | undefined>;
};

// In-memory time series (TimescaleDB hypertable equivalent for one node).
export class MemoryPriceHistory implements PriceHistory {
  private readonly points: PricePoint[] = [];
  async append(point: PricePoint): Promise<void> { this.points.push(point); }
  async range(productId: string, storeId: string, fromISO: string, toISO: string): Promise<PricePoint[]> {
    return this.points
      .filter((p) => p.productId === productId && p.storeId === storeId && p.at >= fromISO && p.at <= toISO)
      .sort((a, b) => (a.at < b.at ? -1 : 1));
  }
  async latest(productId: string, storeId: string): Promise<PricePoint | undefined> {
    let best: PricePoint | undefined;
    for (const p of this.points) {
      if (p.productId !== productId || p.storeId !== storeId) continue;
      if (best === undefined || p.at > best.at) best = p;
    }
    return best;
  }
}

// The bundle of relational repositories the app wires in. Defaults are all in-memory.
export type Repositories = { vectors: VectorIndex; geo: GeoStoreIndex; history: PriceHistory };

export function memoryRepositories(): Repositories {
  return { vectors: new MemoryVectorIndex(), geo: new MemoryGeoStoreIndex(), history: new MemoryPriceHistory() };
}
