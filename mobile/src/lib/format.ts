// Small presentation helpers.

// Seed store ids look like "str_walmart" / "str_smiths" — render a friendly name until the backend
// exposes store profiles.
export function prettyStore(storeId: string | undefined | null): string {
  if (storeId == null || storeId.length === 0) return "Unknown store";
  const raw = storeId.replace(/^str_/, "").replace(/[_-]+/g, " ").trim();
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function km(meters: number | undefined | null): string {
  if (meters == null) return "";
  return meters < 950 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function confidencePct(c: number | undefined | null): number {
  return Math.round((c ?? 0) * 100);
}

export function dealLabel(kind: string): string {
  const map: Record<string, string> = {
    price: "Price drop", clearance: "Clearance", coupon: "Coupon", shelf: "Shelf price",
    receipt: "Receipt", oos: "Out of stock", aisle: "Aisle update",
  };
  return map[kind] ?? kind;
}
