// Thin typed client over the OpenAPI-generated types in ./schema.ts (regenerate with
// `npm run gen:api` from the repo root). One small fetch wrapper, no extra runtime dependency —
// every request carries x-device-id and (when signed in) the bearer access token.

import type { components } from "./schema";

type S = components["schemas"];
export type Tokens = S["Tokens"];
export type Product = S["Product"];
export type SearchResults = S["SearchResults"];
export type BestPrice = S["BestPrice"];
export type Deal = S["Deal"];
export type DealsNear = S["DealsNear"];
export type List = S["List"];
export type ListItem = S["ListItem"];
export type PricedList = S["PricedList"];
export type PricedListItem = S["PricedListItem"];
export type Gamification = S["Gamification"];
export type Leaderboard = S["Leaderboard"];
export type CartPlan = S["CartPlan"];
export type Contribution = S["Contribution"];
export type StoreNear = S["StoreNear"];

export type LeaderWindow = "weekly" | "monthly" | "alltime";
export type OptimizeMode = "chill" | "balanced" | "max";
export type ContributionKind = "price" | "receipt" | "shelf" | "clearance" | "oos" | "aisle" | "coupon";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export type ApiClientOptions = { baseUrl: string; deviceId: string; getToken?: () => string | null };
type Query = Record<string, string | number | undefined>;

export class ApiClient {
  constructor(private readonly opts: ApiClientOptions) {}

  private async request<T>(method: string, path: string, init: { query?: Query; body?: unknown } = {}): Promise<T> {
    const url = new URL(path, this.opts.baseUrl);
    for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { "x-device-id": this.opts.deviceId };
    const token = this.opts.getToken?.();
    if (token != null && token.length > 0) headers["authorization"] = `Bearer ${token}`;
    if (init.body !== undefined) headers["content-type"] = "application/json";

    const res = await fetch(url.toString(), { method, headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
    const text = await res.text();
    const data = text.length > 0 ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const msg = data != null && typeof data === "object" && "message" in data ? String((data as Record<string, unknown>).message) : res.statusText;
      throw new ApiError(res.status, msg);
    }
    return data as T;
  }

  // Auth
  startAnonymousSession(metro?: string) { return this.request<Tokens>("POST", "/auth/anonymous", { body: metro != null ? { metro } : {} }); }
  linkIdentity(userId: string, provider: string, token: string) {
    return this.request<Tokens & { upgraded: boolean; signedInToExisting: boolean }>("POST", "/auth/link", { body: { userId, provider, token } });
  }

  // Discovery
  search(q: string) { return this.request<SearchResults>("GET", "/search", { query: { q } }); }
  resolve(input: { barcode?: string; text?: string }) {
    return this.request<{ productId: string | null; matchScore: number; method: "barcode" | "text" | "none" }>("GET", "/catalog/resolve", { query: input });
  }
  bestPrice(productId: string, lat: number, lng: number, radius?: number) {
    return this.request<BestPrice>("GET", "/prices/best", { query: { productId, lat, lng, radius } });
  }
  dealsNear(lat: number, lng: number, radius?: number) { return this.request<DealsNear>("GET", "/deals/near", { query: { lat, lng, radius } }); }
  storesNear(lat: number, lng: number, radius?: number) { return this.request<{ stores: StoreNear[] }>("GET", "/stores/near", { query: { lat, lng, radius } }); }

  // Lists
  createList(ownerId: string, name?: string) { return this.request<List>("POST", "/lists", { body: { ownerId, name } }); }
  pricedList(listId: string, lat: number, lng: number, radius?: number) {
    return this.request<PricedList>("GET", `/lists/${listId}/priced`, { query: { lat, lng, radius } });
  }
  addListItem(listId: string, ownerId: string, productId: string, qty = 1) {
    return this.request<ListItem>("POST", `/lists/${listId}/items`, { body: { ownerId, productId, qty } });
  }
  optimize(input: { userId: string; items: { productId: string; qty?: number }[]; lat: number; lng: number; mode?: OptimizeMode }) {
    return this.request<CartPlan>("POST", "/optimize", { body: input });
  }

  // Engagement
  gamification(userId: string) { return this.request<Gamification>("GET", `/users/${userId}/gamification`, {}); }
  leaderboard(window: LeaderWindow = "weekly", metro = "slc") { return this.request<Leaderboard>("GET", "/leaderboard", { query: { window, metro } }); }
  addWatch(userId: string, productId: string, lat: number, lng: number, radius?: number) {
    return this.request<{ id: string }>("POST", "/watches", { body: { userId, productId, lat, lng, radius } });
  }

  // Contribute (crowdsource a price/scan)
  contribute(input: {
    idempotencyKey: string; userId: string; storeId: string; kind: ContributionKind;
    productId?: string | null; reportedPrice?: number | null; barcode?: string | null; text?: string | null;
    image?: { base64?: string; url?: string; mediaType?: string } | null; lat: number; lng: number;
  }) {
    return this.request<Contribution>("POST", "/contributions", { body: input });
  }
}
