// AR & Wearables scene assembly (docs/ar-wearables.md). The AR/glasses clients are thin
// renderers; this service does the work: given a pose (and optional in-store context), it
// composes world-anchored overlays from pricing/catalog/alerts/optimization and *tailors the
// payload to the device tier* — full cards for phone/web AR, a few HUD cards for display
// glasses, spoken cues for audio-only glasses. Frugal by construction (data-light principle).

import { distanceMeters, type LatLng } from "../../platform/geo/h3.ts";

export type DeviceTier = "phone_ar" | "web_ar" | "glasses_display" | "glasses_audio";

export type Capabilities = {
  maxAnchors: number;
  route: boolean;
  occlusion: boolean;
  audioFirst: boolean;
  surface: "world+geo" | "geo" | "hud" | "audio";
};

// What each surface can usefully render. Glasses get fewer, prioritized overlays; audio-only
// glasses (e.g. non-display Ray-Ban Meta) get spoken cues instead of visuals.
const CAPS: Record<DeviceTier, Capabilities> = {
  phone_ar: { maxAnchors: 12, route: true, occlusion: true, audioFirst: false, surface: "world+geo" },
  web_ar: { maxAnchors: 8, route: true, occlusion: false, audioFirst: false, surface: "geo" },
  glasses_display: { maxAnchors: 3, route: true, occlusion: false, audioFirst: false, surface: "hud" },
  glasses_audio: { maxAnchors: 0, route: false, occlusion: false, audioFirst: true, surface: "audio" },
};

export type Geo = { lat: number; lng: number };

export type ARAnchor =
  | {
      kind: "price_card";
      productId: string;
      name: string;
      storeId: string;
      price: number | null;
      confidence: number | null;
      aisle: string | null;
      buyHere: boolean;
      cheaperElsewhere: { storeId: string; price: number; savings: number } | null;
      geo: Geo | null;
    }
  | { kind: "store_pin"; storeId: string; name: string; geo: Geo; distanceMeters: number }
  | { kind: "deal_pin"; storeId: string; productId: string | null; label: string; geo: Geo }
  | { kind: "route_waypoint"; order: number; storeId: string; name: string; geo: Geo };

export type ARScene = {
  context: "instore" | "outdoor";
  deviceTier: DeviceTier;
  capabilities: Capabilities;
  anchors: ARAnchor[];
  route: { polyline: Geo[]; estimatedSavings: number; mode: string } | null;
  audioCues: string[];
  approxPayloadBytes: number;
};

// Ports — AR composes existing modules, owns no storage of its own.
export type PricingPort = {
  priceAtStore: (productId: string, storeId: string) => number | undefined;
  bestNearbyPrice: (productId: string, at: LatLng, radiusMeters: number) => { storeId: string; price: number } | undefined;
};
export type CatalogPort = {
  nearbyStores: (at: LatLng, radiusMeters: number) => Array<{ id: string; name: string; lat: number; lng: number; distanceMeters: number }>;
  getStore: (id: string) => { name: string; lat: number; lng: number } | undefined;
  getProduct: (id: string) => { canonicalName: string } | undefined;
  getAisle: (storeId: string, productId: string) => string | undefined;
};
export type DealsPort = { dealsNear: (at: LatLng, radiusMeters: number) => Array<{ storeId: string; productId: string | null; kind: string }> };
export type OptimizePort = {
  optimize: (input: { userId: string; items: Array<{ productId: string; qty: number }>; at: LatLng; mode: "chill" | "balanced" | "max"; meter: { consume: (u: string, f: "cart_optimize") => { ok: boolean } } }) =>
    | { locked: boolean; estimatedSavings: number; stores: Array<{ storeId: string }> }
    | { error: string };
};
export type ListsPort = { getList: (id: string) => { items: Array<{ productId: string; qty: number }> } | undefined };

export type SceneInput = {
  userId: string;
  at: LatLng;
  deviceTier: DeviceTier;
  storeId?: string;
  listId?: string;
  items?: Array<{ productId: string; qty: number }>;
  mode?: "chill" | "balanced" | "max";
  radiusMeters?: number;
};

const DEFAULT_RADIUS = 16_000;

export class ARSceneService {
  private readonly deps: { pricing: PricingPort; catalog: CatalogPort; deals: DealsPort; optimize: OptimizePort; lists: ListsPort; meter: { consume: (u: string, f: "cart_optimize") => { ok: boolean } } };
  constructor(deps: { pricing: PricingPort; catalog: CatalogPort; deals: DealsPort; optimize: OptimizePort; lists: ListsPort; meter: { consume: (u: string, f: "cart_optimize") => { ok: boolean } } }) {
    this.deps = deps;
  }

  buildScene(input: SceneInput): ARScene {
    const caps = CAPS[input.deviceTier];
    const radius = input.radiusMeters ?? DEFAULT_RADIUS;
    const items = input.items ?? (input.listId !== undefined ? this.deps.lists.getList(input.listId)?.items ?? [] : []);

    const scene: ARScene =
      input.storeId !== undefined
        ? this.inStore(input, caps, radius, items)
        : this.outdoor(input, caps, radius, items);

    // Audio-first surfaces (no-display glasses): convert top overlays to spoken cues.
    if (caps.audioFirst) {
      scene.audioCues = this.toAudio(scene);
      scene.anchors = [];
      scene.route = null;
    }
    scene.approxPayloadBytes = JSON.stringify({ a: scene.anchors, r: scene.route, c: scene.audioCues }).length;
    return scene;
  }

  private inStore(input: SceneInput, caps: Capabilities, radius: number, items: Array<{ productId: string; qty: number }>): ARScene {
    const storeId = input.storeId as string;
    const here = this.deps.catalog.getStore(storeId);
    const geo: Geo | null = here === undefined ? null : { lat: here.lat, lng: here.lng };
    const cards: Extract<ARAnchor, { kind: "price_card" }>[] = [];

    for (const it of items) {
      const priceHere = this.deps.pricing.priceAtStore(it.productId, storeId) ?? null;
      const best = this.deps.pricing.bestNearbyPrice(it.productId, input.at, radius);
      const cheaper =
        best !== undefined && best.storeId !== storeId && priceHere !== null && best.price < priceHere
          ? { storeId: best.storeId, price: best.price, savings: round2(priceHere - best.price) }
          : null;
      cards.push({
        kind: "price_card",
        productId: it.productId,
        name: this.deps.catalog.getProduct(it.productId)?.canonicalName ?? it.productId,
        storeId,
        price: priceHere,
        confidence: null,
        aisle: this.deps.catalog.getAisle(storeId, it.productId) ?? null,
        buyHere: cheaper === null,
        cheaperElsewhere: cheaper,
        geo,
      });
    }
    // Prioritize "cheaper elsewhere" warnings (biggest savings first), then buy-here items.
    cards.sort((a, b) => (b.cheaperElsewhere?.savings ?? -1) - (a.cheaperElsewhere?.savings ?? -1));

    return {
      context: "instore",
      deviceTier: input.deviceTier,
      capabilities: caps,
      anchors: cards.slice(0, Math.max(caps.maxAnchors, caps.audioFirst ? cards.length : 0)),
      route: null,
      audioCues: [],
      approxPayloadBytes: 0,
    };
  }

  private outdoor(input: SceneInput, caps: Capabilities, radius: number, items: Array<{ productId: string; qty: number }>): ARScene {
    const anchors: ARAnchor[] = [];

    // Local deals as world-anchored pins.
    for (const d of this.deps.deals.dealsNear(input.at, radius)) {
      const s = this.deps.catalog.getStore(d.storeId);
      if (s === undefined) continue;
      anchors.push({ kind: "deal_pin", storeId: d.storeId, productId: d.productId, label: d.kind === "clearance" ? "Clearance reported" : "Deal reported", geo: { lat: s.lat, lng: s.lng } });
    }

    // Nearby stores as pins.
    for (const s of this.deps.catalog.nearbyStores(input.at, radius)) {
      anchors.push({ kind: "store_pin", storeId: s.id, name: s.name, geo: { lat: s.lat, lng: s.lng }, distanceMeters: Math.round(s.distanceMeters) });
    }

    // The "green line" route overlay — a multi-store plan, if requested and the user can route.
    let route: ARScene["route"] = null;
    if (caps.route && items.length > 0) {
      const plan = this.deps.optimize.optimize({ userId: input.userId, items, at: input.at, mode: input.mode ?? "balanced", meter: this.deps.meter });
      if (!("error" in plan) && !plan.locked) {
        const waypoints: Geo[] = [input.at];
        let order = 1;
        for (const ps of plan.stores) {
          const s = this.deps.catalog.getStore(ps.storeId);
          if (s === undefined) continue;
          anchors.push({ kind: "route_waypoint", order, storeId: ps.storeId, name: s.name, geo: { lat: s.lat, lng: s.lng } });
          waypoints.push({ lat: s.lat, lng: s.lng });
          order++;
        }
        route = { polyline: waypoints, estimatedSavings: plan.estimatedSavings, mode: input.mode ?? "balanced" };
      }
    }

    // Nearest-first, capped to the tier (route waypoints kept regardless of cap).
    const waypointAnchors = anchors.filter((a) => a.kind === "route_waypoint");
    const others = anchors
      .filter((a) => a.kind !== "route_waypoint")
      .sort((a, b) => distFromInput(a, input.at) - distFromInput(b, input.at))
      .slice(0, caps.maxAnchors);

    return {
      context: "outdoor",
      deviceTier: input.deviceTier,
      capabilities: caps,
      anchors: [...waypointAnchors, ...others],
      route,
      audioCues: [],
      approxPayloadBytes: 0,
    };
  }

  private toAudio(scene: ARScene): string[] {
    const cues: string[] = [];
    for (const a of scene.anchors.slice(0, 3)) {
      if (a.kind === "price_card" && a.cheaperElsewhere !== null) {
        cues.push(`${a.name} is $${a.cheaperElsewhere.savings.toFixed(2)} cheaper nearby — consider waiting.`);
      } else if (a.kind === "price_card") {
        cues.push(`${a.name}${a.aisle !== null ? `, ${a.aisle}` : ""}: buy here${a.price !== null ? ` for $${a.price.toFixed(2)}` : ""}.`);
      } else if (a.kind === "deal_pin") {
        cues.push(`${a.label} at a store nearby.`);
      } else if (a.kind === "store_pin") {
        cues.push(`${a.name} is ${Math.round(a.distanceMeters)} meters away.`);
      }
    }
    return cues;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function distFromInput(a: ARAnchor, at: LatLng): number {
  if (a.kind === "store_pin" || a.kind === "deal_pin" || a.kind === "route_waypoint") return distanceMeters(at, a.geo);
  return a.geo === null ? Number.MAX_SAFE_INTEGER : distanceMeters(at, a.geo);
}
