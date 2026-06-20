// Domain events — the integration contract between bounded contexts (docs/data-model.md).
// Today they flow through an in-process bus; when a module is extracted to its own service
// these same payloads become a Kafka topic, unchanged. Events are versioned via `type`.

import type { Cell } from "../geo/h3.ts";

export type ContributionType =
  | "price"
  | "receipt"
  | "shelf"
  | "clearance"
  | "oos"
  | "aisle"
  | "coupon";

export type PriceSource = "receipt" | "shelf" | "manual" | "crawl";

export type DomainEvent =
  | {
      type: "contribution.received";
      contributionId: string;
      userId: string;
      storeId: string;
      kind: ContributionType;
      geofenceValid: boolean;
      cell: Cell;
    }
  | {
      type: "contribution.scored";
      contributionId: string;
      confidence: number;
      accepted: boolean;
    }
  | {
      type: "price.updated";
      productId: string;
      storeId: string;
      price: number;
      confidence: number;
      asOf: string;
      source: PriceSource;
      cell: Cell;
    }
  | {
      type: "price.dropped";
      productId: string;
      storeId: string;
      oldPrice: number;
      newPrice: number;
      cell: Cell;
    }
  | {
      type: "deal.reported";
      storeId: string;
      productId: string | null;
      kind: ContributionType;
      cell: Cell;
    }
  | { type: "product.created"; productId: string; source: "user" | "crawl" }
  | { type: "referral.activated"; referrerId: string; referredUserId: string }
  | {
      type: "reward.granted";
      userId: string;
      feature: string;
      source: string;
      expiresAt: string | null;
    }
  | { type: "karma.awarded"; userId: string; delta: number; reason: string; metro: string }
  | {
      type: "trip.completed";
      userId: string;
      storeId: string;
      spent: number;
      estSavings: number;
    };

export type EventType = DomainEvent["type"];

// Narrow a DomainEvent to a specific variant by its `type`.
export type EventOf<T extends EventType> = Extract<DomainEvent, { type: T }>;
