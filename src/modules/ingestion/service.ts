// Crowdsource Ingestion (docs/ARCHITECTURE.md §4.4) — the core moat and the write path.
// Pipeline: idempotent capture → geofence location-validation → confidence scoring →
// emit price.updated / deal.reported. Exactly-once via a client idempotency key
// (proven-patterns.md §7): a receipt re-uploaded on a flaky network is processed once.

import type { EventBus } from "../../platform/events/bus.ts";
import { cellOf, distanceMeters } from "../../platform/geo/h3.ts";
import { newId } from "../../platform/id.ts";
import { badRequest } from "../../platform/errors.ts";
import { MemoryTable } from "../../platform/store/store.ts";
import type { ContributionType } from "../../platform/events/events.ts";
import { scoreConfidence } from "./confidence.ts";

export type Contribution = {
  id: string;
  idempotencyKey: string;
  userId: string;
  storeId: string;
  kind: ContributionType;
  productId: string | null;
  reportedPrice: number | null;
  lat: number;
  lng: number;
  cell: string;
  geofenceValid: boolean;
  via: "app" | "glasses" | "web";
  confidence: number | null;
  status: "pending" | "scored" | "rejected" | "duplicate";
  createdAt: string;
};

export type SubmitInput = {
  idempotencyKey: string;
  userId: string;
  storeId: string;
  kind: ContributionType;
  productId?: string | null;
  reportedPrice?: number | null;
  aisle?: string | null; // for kind="aisle": where the product lives in the store
  via?: "app" | "glasses" | "web"; // capture channel (POV glasses feed the same pipeline)
  lat: number;
  lng: number;
};

// Map a contribution type to a confidence source weight. In-store observations
// (shelf/aisle/clearance/oos/coupon) are treated as shelf-grade evidence; receipts are
// strongest; bare manual price edits are weakest.
function sourceForKind(kind: ContributionType): "receipt" | "shelf" | "manual" {
  if (kind === "receipt") return "receipt";
  if (kind === "price") return "manual";
  return "shelf";
}

// Ports: ingestion never reaches into other modules' storage.
export type StorePort = { get: (id: string) => { lat: number; lng: number; metro: string } | undefined };
export type ReputationPort = { reputation: (userId: string) => number };
export type PriorPricePort = {
  getProjection: (productId: string, storeId: string) => { price: number; confidence: number } | undefined;
};
export type LocationPort = { setAisle: (storeId: string, productId: string, section: string) => void };

const GEOFENCE_RADIUS_M = 200; // "was the user actually at the store?"

export class IngestionService {
  private readonly contributions = new MemoryTable<Contribution>();

  private readonly deps: {
    bus: EventBus;
    stores: StorePort;
    reputation: ReputationPort;
    priorPrice: PriorPricePort;
    locations: LocationPort;
    h3Resolution: number;
  };
  constructor(deps: {
    bus: EventBus;
    stores: StorePort;
    reputation: ReputationPort;
    priorPrice: PriorPricePort;
    locations: LocationPort;
    h3Resolution: number;
  }) {
    this.deps = deps;
  }

  getContribution(id: string): Contribution | undefined {
    return this.contributions.get(id);
  }

  byUser(userId: string): Contribution[] {
    return this.contributions.find((c) => c.userId === userId);
  }

  async submit(input: SubmitInput): Promise<Contribution> {
    // 1) Idempotency: same key → return the already-processed record, do not double-count.
    const existing = this.contributions.findOne((c) => c.idempotencyKey === input.idempotencyKey);
    if (existing !== undefined) return existing;

    const store = this.deps.stores.get(input.storeId);
    if (store === undefined) throw badRequest(`unknown store ${input.storeId}`);

    const at = { lat: input.lat, lng: input.lng };
    const cell = cellOf(at, this.deps.h3Resolution);
    const geofenceValid = distanceMeters(at, { lat: store.lat, lng: store.lng }) <= GEOFENCE_RADIUS_M;

    // 2) Capture (status pending). The transactional outbox would commit row + event here.
    const contribution = this.contributions.insert({
      id: newId("ctr"),
      idempotencyKey: input.idempotencyKey,
      userId: input.userId,
      storeId: input.storeId,
      kind: input.kind,
      productId: input.productId ?? null,
      reportedPrice: input.reportedPrice ?? null,
      lat: input.lat,
      lng: input.lng,
      cell,
      geofenceValid,
      via: input.via ?? "app",
      confidence: null,
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    await this.deps.bus.publish({
      type: "contribution.received",
      contributionId: contribution.id,
      userId: contribution.userId,
      storeId: contribution.storeId,
      kind: contribution.kind,
      geofenceValid,
      cell,
    });

    // 3) Confidence scoring (async in production via the queue; inline here).
    const prior =
      contribution.productId !== null
        ? this.deps.priorPrice.getProjection(contribution.productId, contribution.storeId)
        : undefined;

    const { confidence, accepted } = scoreConfidence({
      source: sourceForKind(contribution.kind),
      geofenceValid,
      reporterReputation: this.deps.reputation.reputation(contribution.userId),
      reportedPrice: contribution.reportedPrice,
      priorPrice: prior?.price ?? null,
      priorConfidence: prior?.confidence ?? null,
    });

    const scored = this.contributions.update(contribution.id, {
      confidence,
      status: accepted ? "scored" : "rejected",
    }) as Contribution;

    await this.deps.bus.publish({
      type: "contribution.scored",
      contributionId: scored.id,
      confidence,
      accepted,
    });

    // 4) Promote to the pricing projection / deal feed when accepted.
    if (accepted && scored.productId !== null && scored.reportedPrice !== null) {
      await this.deps.bus.publish({
        type: "price.updated",
        productId: scored.productId,
        storeId: scored.storeId,
        price: scored.reportedPrice,
        confidence,
        asOf: scored.createdAt,
        source: sourceForKind(scored.kind),
        cell,
      });
    }
    if (accepted && (scored.kind === "clearance" || scored.kind === "coupon")) {
      await this.deps.bus.publish({
        type: "deal.reported",
        storeId: scored.storeId,
        productId: scored.productId,
        kind: scored.kind,
        cell,
      });
    }
    // Accepted aisle reports update the in-store product location used by AR cards.
    if (accepted && scored.kind === "aisle" && scored.productId !== null && input.aisle != null) {
      this.deps.locations.setAisle(scored.storeId, scored.productId, input.aisle);
    }

    return scored;
  }
}
