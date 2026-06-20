// Geo-cell indexing — the shard/cache/query key for the whole pricing & alert path
// (see docs/proven-patterns.md §2, "Uber H3").
//
// In production this is the `h3-js` library (true hexagonal hierarchical cells with
// equidistant neighbours). To keep the scaffold dependency-free and runnable offline,
// this is a faithful *stand-in* that preserves the H3 contract the rest of the code
// relies on: `cellOf`, `parent`, `kRing`, and a haversine `distanceMeters`. Swapping in
// real H3 means reimplementing this one file — nothing else changes.

export type LatLng = { lat: number; lng: number };
export type Cell = string; // opaque cell id, e.g. "8|1234|-5678"

// Approximate degrees-per-cell-edge by resolution. Coarser res = bigger cells, matching
// H3's ~1/7 area step. Res 8 ≈ a few hundred meters (neighbourhood) — our default key.
function edgeDegrees(res: number): number {
  // res 0 ≈ 10°, halving roughly every step; clamps to sane bounds.
  const r = Math.max(0, Math.min(15, res));
  return 10 / 2 ** r;
}

export function cellOf(p: LatLng, res: number): Cell {
  const e = edgeDegrees(res);
  const x = Math.floor(p.lng / e);
  const y = Math.floor(p.lat / e);
  return `${res}|${x}|${y}`;
}

function decode(cell: Cell): { res: number; x: number; y: number } {
  const [resStr, xStr, yStr] = cell.split("|");
  return { res: Number(resStr), x: Number(xStr), y: Number(yStr) };
}

// Parent cell at a coarser resolution — powers metro/category roll-ups & the deal feed.
export function parent(cell: Cell, coarserRes: number): Cell {
  const { res, x, y } = decode(cell);
  if (coarserRes >= res) return cell;
  const factor = 2 ** (res - coarserRes);
  return `${coarserRes}|${Math.floor(x / factor)}|${Math.floor(y / factor)}`;
}

// kRing(origin, k): all cells within grid-distance k — an approximate circle, the way we
// answer "stores / deals / watchers within N miles".
export function kRing(origin: Cell, k: number): Cell[] {
  const { res, x, y } = decode(origin);
  const out: Cell[] = [];
  for (let dx = -k; dx <= k; dx++) {
    for (let dy = -k; dy <= k; dy++) {
      out.push(`${res}|${x + dx}|${y + dy}`);
    }
  }
  return out;
}

const EARTH_RADIUS_M = 6_371_000;

export function distanceMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Convenience: the ring radius (in cells) needed to cover `meters` at a latitude.
export function ringForMeters(at: LatLng, meters: number, res: number): number {
  const e = edgeDegrees(res);
  const metersPerDegLat = 111_320;
  const cellMeters = e * metersPerDegLat * Math.max(0.2, Math.cos((at.lat * Math.PI) / 180));
  return Math.max(1, Math.ceil(meters / cellMeters));
}
