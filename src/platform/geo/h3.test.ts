import { test } from "node:test";
import assert from "node:assert/strict";
import { cellOf, parent, kRing, distanceMeters, ringForMeters } from "./h3.ts";

test("cellOf is stable for the same point and resolution", () => {
  const a = cellOf({ lat: 40.76, lng: -111.89 }, 8);
  const b = cellOf({ lat: 40.76, lng: -111.89 }, 8);
  assert.equal(a, b);
});

test("nearby points share a cell at coarse resolution but split at fine resolution", () => {
  const p1 = { lat: 40.7608, lng: -111.891 };
  const p2 = { lat: 41.4, lng: -111.0 }; // ~85 km away
  assert.equal(cellOf(p1, 2), cellOf(p2, 2)); // coarse: same big cell
  assert.notEqual(cellOf(p1, 10), cellOf(p2, 10)); // fine: different cells
});

test("parent truncates to a coarser cell (hierarchical roll-up)", () => {
  const fine = cellOf({ lat: 40.7608, lng: -111.891 }, 8);
  const nearFine = cellOf({ lat: 40.7611, lng: -111.8908 }, 8); // ~35 m away → same res-5 parent
  assert.equal(parent(fine, 5), parent(nearFine, 5));
  assert.equal(parent(fine, 9), fine); // asking for a finer/equal res is a no-op
});

test("kRing(k=1) returns the 7 cells of a hexagon (center + 6 neighbours)", () => {
  const c = cellOf({ lat: 40.76, lng: -111.89 }, 8);
  const ring = kRing(c, 1);
  assert.equal(ring.length, 7);
  assert.ok(ring.includes(c));
});

test("distanceMeters is ~0 for identical points and positive otherwise", () => {
  const p = { lat: 40.76, lng: -111.89 };
  assert.equal(Math.round(distanceMeters(p, p)), 0);
  assert.ok(distanceMeters(p, { lat: 40.77, lng: -111.85 }) > 1000);
});

test("ringForMeters grows with the requested radius", () => {
  const at = { lat: 40.76, lng: -111.89 };
  assert.ok(ringForMeters(at, 16000, 8) >= ringForMeters(at, 1000, 8));
});
