// Geo-cell indexing — the shard/cache/query key for the whole pricing & alert path
// (see docs/proven-patterns.md §2). This is the REAL Uber H3 (h3-js): true hexagonal
// hierarchical cells with equidistant neighbours. The rest of the codebase treats a Cell as an
// opaque string and only uses the functions below, so this is the single file that defines geo.

import {
  latLngToCell,
  cellToParent,
  gridDisk,
  greatCircleDistance,
  getHexagonEdgeLengthAvg,
  getResolution,
} from "h3-js";

export type LatLng = { lat: number; lng: number };
export type Cell = string; // H3 index, e.g. "882696ab63fffff"

// The H3 cell containing a point at the given resolution (res 8 ≈ ~0.5 km edge, our default key).
export function cellOf(p: LatLng, res: number): Cell {
  return latLngToCell(p.lat, p.lng, res);
}

// Parent cell at a coarser resolution — powers metro/category roll-ups & the deal feed.
export function parent(cell: Cell, coarserRes: number): Cell {
  if (coarserRes >= getResolution(cell)) return cell;
  return cellToParent(cell, coarserRes);
}

// gridDisk(origin, k): all cells within grid-distance k (a hexagonal "ring disk") — how we answer
// "stores / deals / watchers within N miles". Note: at a fine resolution a wide radius yields many
// cells; production uses a coarser resolution for wide queries (the two-resolution trick).
export function kRing(origin: Cell, k: number): Cell[] {
  return gridDisk(origin, Math.max(0, Math.trunc(k)));
}

export function distanceMeters(a: LatLng, b: LatLng): number {
  return greatCircleDistance([a.lat, a.lng], [b.lat, b.lng], "m");
}

// The ring radius (in cells) needed to cover `meters` at the given resolution.
export function ringForMeters(_at: LatLng, meters: number, res: number): number {
  const edge = getHexagonEdgeLengthAvg(res, "m");
  return Math.max(1, Math.ceil(meters / edge));
}
