// Crowdsource Ingestion (docs/ARCHITECTURE.md §4.4) — the core moat and the write path.
// Pipeline: idempotent capture → geofence location-validation → confidence scoring →
// emit price.updated / deal.reported. Exactly-once via a client idempotency key
// (proven-patterns.md §7): a receipt re-uploaded on a flaky network is processed once.

import type { EventBus } from "../../platform/events/bus.ts";
import { cellOf, distanceMeters } from "../../platform/geo/h3.ts";
import { newId } from "../../platform/id.ts";
import { badRequest } from "../../platform/errors.ts";
import type { Table, TableFactory } from "../../platform/store/store.ts";
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
  matchMethod: "barcode" | "text" | "none" | "explicit";
  matchScore: number;
  mediaHash: string | null;
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
  // Raw capture signals — resolved to a product via Matching + Perception when productId is absent.
  barcode?: string | null;
  text?: string | null;       // OCR'd / typed line item, e.g. "GV WHP MILK"
  mediaHash?: string | null;  // photo identity, for cheap→expensive routing + dedup
  image?: { base64?: string; url?: string; mediaType?: string } | null; // the photo to read (real OCR/VLM)
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
export type MatchingPort = {
  resolve: (input: { barcode?: string | null; text?: string | null }) => Promise<{ productId: string | null; matchScore: number; method: "barcode" | "text" | "none" }>;
};
export type PerceptionPort = {
  perceive: (input: {
    barcode?: string | null; text?: string | null; mediaHash?: string | null; reportedPrice?: number | null;
    image?: { base64?: string; url?: string; mediaType?: string } | null;
  }) => Promise<{ extractionConfidence: number; price: number | null; routes: string[] }>;
};

const GEOFENCE_RADIUS_M = 200; // "was the user actually at the store?"

export class IngestionService {
  private readonly contributions: Table<Contribution>;

  private readonly deps: {
    bus: EventBus;
    stores: StorePort;
    reputation: ReputationPort;
    priorPrice: PriorPricePort;
    locations: LocationPort;
    matching: MatchingPort;
    perception: PerceptionPort;
    tables: TableFactory;
    h3Resolution: number;
  };
  constructor(deps: {
    bus: EventBus;
    stores: StorePort;
    reputation: ReputationPort;
    priorPrice: PriorPricePort;
    locations: LocationPort;
    matching: MatchingPort;
    perception: PerceptionPort;
    tables: TableFactory;
    h3Resolution: number;
  }) {
    this.deps = deps;
    this.contributions = deps.tables<Contribution>("contributions");
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
    // Media-hash dedup: the same photo (re-uploaded on a flaky network) is processed once.
    if (input.mediaHash != null && input.mediaHash.length > 0) {
      const sameMedia = this.contributions.findOne((c) => c.mediaHash === input.mediaHash);
      if (sameMedia !== undefined) return sameMedia;
    }

    const store = this.deps.stores.get(input.storeId);
    if (store === undefined) throw badRequest(`unknown store ${input.storeId}`);

    const at = { lat: input.lat, lng: input.lng };
    const cell = cellOf(at, this.deps.h3Resolution);
    const geofenceValid = distanceMeters(at, { lat: store.lat, lng: store.lng }) <= GEOFENCE_RADIUS_M;

    // 2a) Perception routing (barcode/client free; cheap OCR else; escalate only if low-conf).
    const percept = await this.deps.perception.perceive({
      barcode: input.barcode,
      text: input.text,
      mediaHash: input.mediaHash,
      image: input.image,
      reportedPrice: input.reportedPrice,
    });

    // 2b) Resolve to a canonical product. Explicit productId is trusted (human-specified);
    //     otherwise barcode/text are matched, contributing a separate matchScore.
    let productId = input.productId ?? null;
    let matchMethod: Contribution["matchMethod"] = input.productId != null ? "explicit" : "none";
    let matchScore = input.productId != null ? 1 : 0;
    if (productId === null && (input.barcode != null || input.text != null)) {
      const m = await this.deps.matching.resolve({ barcode: input.barcode, text: input.text });
      productId = m.productId;
      matchMethod = m.method;
      matchScore = m.matchScore;
    }
    const reportedPrice = input.reportedPrice ?? percept.price;

    // 2c) Capture (status pending). The transactional outbox would commit row + event here.
    const contribution = this.contributions.insert({
      id: newId("ctr"),
      idempotencyKey: input.idempotencyKey,
      userId: input.userId,
      storeId: input.storeId,
      kind: input.kind,
      productId,
      reportedPrice,
      matchMethod,
      matchScore,
      mediaHash: input.mediaHash ?? null,
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
      // Product-match and price-read quality as separate clamps. Only a fuzzy *text* match
      // dampens confidence; barcode/explicit are trusted (=1), and a no-product contribution
      // has nothing to doubt (=1). extractionConfidence applies only when perception ran.
      matchConfidence: contribution.matchMethod === "text" ? contribution.matchScore : 1,
      extractionConfidence: percept.extractionConfidence === 0 ? undefined : percept.extractionConfidence,
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
