// The in-memory repositories are the default (active) implementations and define the contract the
// Postgres ones (pgvector / PostGIS / Timescale) must match — those are exercised by the gated IT.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryVectorIndex, MemoryGeoStoreIndex, MemoryPriceHistory } from "./repositories.ts";

test("vector index: nearest ranks by cosine, tracks signatures, removes", async () => {
  const idx = new MemoryVectorIndex();
  await idx.upsertMany([
    { id: "a", sig: "s1", vec: [1, 0, 0] },
    { id: "b", sig: "s1", vec: [0, 1, 0] },
    { id: "c", sig: "s1", vec: [0.9, 0.1, 0] },
  ]);
  const near = await idx.nearest([1, 0, 0], 2);
  assert.deepEqual(near.map((r) => r.id), ["a", "c"], "closest vectors first");

  assert.deepEqual((await idx.loadSignatures()).sort((x, y) => x.id.localeCompare(y.id)).map((r) => r.id), ["a", "b", "c"]);
  await idx.removeMany(["b"]);
  assert.equal((await idx.loadSignatures()).length, 2);
});

test("geo index: nearby returns only stores within the radius, sorted by distance", async () => {
  const geo = new MemoryGeoStoreIndex();
  await geo.upsert({ id: "downtown", lat: 40.7608, lng: -111.891 });
  await geo.upsert({ id: "near", lat: 40.77, lng: -111.9 });        // ~1.5 km
  await geo.upsert({ id: "far", lat: 41.5, lng: -112.5 });          // ~90 km
  const within = await geo.nearby(40.7608, -111.891, 5000);
  assert.deepEqual(within.map((r) => r.id), ["downtown", "near"]);
  assert.ok(within[0]!.meters < within[1]!.meters);
});

test("price history: range filters by window, latest returns the newest point", async () => {
  const h = new MemoryPriceHistory();
  await h.append({ productId: "p", storeId: "s", price: 3.0, confidence: 0.8, at: "2026-06-01T00:00:00Z" });
  await h.append({ productId: "p", storeId: "s", price: 2.5, confidence: 0.9, at: "2026-06-10T00:00:00Z" });
  await h.append({ productId: "p", storeId: "s", price: 2.8, confidence: 0.7, at: "2026-06-20T00:00:00Z" });
  await h.append({ productId: "other", storeId: "s", price: 9, confidence: 1, at: "2026-06-15T00:00:00Z" });

  const june = await h.range("p", "s", "2026-06-05T00:00:00Z", "2026-06-15T00:00:00Z");
  assert.deepEqual(june.map((p) => p.price), [2.5], "only the in-window point for that product/store");

  const latest = await h.latest("p", "s");
  assert.equal(latest?.price, 2.8);
});
