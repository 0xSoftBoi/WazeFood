// Thin typed client over the OpenAPI-generated types in ./schema.ts (regenerate with
// `npm run gen:api` from the repo root). One small fetch wrapper, no extra runtime dependency —
// every request carries x-device-id and (when signed in) the bearer access token.

import type { components } from "./schema";

export type Tokens = components["schemas"]["Tokens"];
export type Product = components["schemas"]["Product"];
export type SearchResults = components["schemas"]["SearchResults"];
export type BestPrice = components["schemas"]["BestPrice"];

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export type ApiClientOptions = {
  baseUrl: string;
  deviceId: string;
  getToken?: () => string | null;
};

type Query = Record<string, string | number | undefined>;

export class ApiClient {
  constructor(private readonly opts: ApiClientOptions) {}

  private async request<T>(method: string, path: string, init: { query?: Query; body?: unknown } = {}): Promise<T> {
    const url = new URL(path, this.opts.baseUrl);
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { "x-device-id": this.opts.deviceId };
    const token = this.opts.getToken?.();
    if (token != null && token.length > 0) headers["authorization"] = `Bearer ${token}`;
    if (init.body !== undefined) headers["content-type"] = "application/json";

    const res = await fetch(url.toString(), {
      method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    const data = text.length > 0 ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const message = data != null && typeof data === "object" && "message" in data ? String((data as Record<string, unknown>).message) : res.statusText;
      throw new ApiError(res.status, message);
    }
    return data as T;
  }

  // --- Endpoints used by the vertical slice ---
  startAnonymousSession(metro?: string): Promise<Tokens> {
    return this.request<Tokens>("POST", "/auth/anonymous", { body: metro != null ? { metro } : {} });
  }

  search(query: string): Promise<SearchResults> {
    return this.request<SearchResults>("GET", "/search", { query: { q: query } });
  }

  bestPrice(productId: string, lat: number, lng: number, radius?: number): Promise<BestPrice> {
    return this.request<BestPrice>("GET", "/prices/best", { query: { productId, lat, lng, radius } });
  }
}
