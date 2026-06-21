// Alerts & Watchlist (docs/ARCHITECTURE.md §4.6). Watchlists ("a stock tracker for grocery
// prices") + price-drop fan-out. Consumes price.dropped / deal.reported and matches against
// an inverted watcher index queried by H3 kRing, so we never scan all users per event.

import { cellOf, kRing, ringForMeters, type LatLng } from "../../platform/geo/h3.ts";
import { newId } from "../../platform/id.ts";
import { err, ok, type Result } from "../../platform/result.ts";
import type { Table, TableFactory } from "../../platform/store/store.ts";
import type { ContributionType } from "../../platform/events/events.ts";

export type Watch = {
  id: string;
  userId: string;
  productId: string;
  cell: string;
  ringK: number; // kRing radius covering the user's chosen distance
  createdAt: string;
};

export type Notification = {
  id: string;
  userId: string;
  kind: "price_drop" | "deal";
  productId: string | null;
  storeId: string;
  message: string;
  createdAt: string;
  read: boolean;
};

const FREE_WATCH_LIMIT = 3;

export type EntitlementsPort = { isPremium: (userId: string) => boolean };

export type Deal = {
  id: string;
  storeId: string;
  productId: string | null;
  kind: ContributionType;
  cell: string;
  createdAt: string;
};

export class AlertsService {
  private readonly watches: Table<Watch>;
  private readonly notifications: Table<Notification>;
  // Local daily deals feed (PDF "Local Daily Deals"); also drives AR deal pins.
  private readonly deals: Table<Deal>;

  private readonly deps: { entitlements: EntitlementsPort; h3Resolution: number; tables: TableFactory };
  constructor(deps: { entitlements: EntitlementsPort; h3Resolution: number; tables: TableFactory }) {
    this.deps = deps;
    this.watches = deps.tables<Watch>("watches");
    this.notifications = deps.tables<Notification>("notifications");
    this.deals = deps.tables<Deal>("deals");
  }

  addWatch(
    userId: string,
    productId: string,
    at: LatLng,
    radiusMeters: number,
  ): Result<Watch, "watch_limit_reached"> {
    if (!this.deps.entitlements.isPremium(userId)) {
      const count = this.watches.find((w) => w.userId === userId).length;
      if (count >= FREE_WATCH_LIMIT) return err("watch_limit_reached");
    }
    const cell = cellOf(at, this.deps.h3Resolution);
    const ringK = ringForMeters(at, radiusMeters, this.deps.h3Resolution);
    const watch = this.watches.insert({
      id: newId("wch"),
      userId,
      productId,
      cell,
      ringK,
      createdAt: new Date().toISOString(),
    });
    return ok(watch);
  }

  watchesOf(userId: string): Watch[] {
    return this.watches.find((w) => w.userId === userId);
  }

  listNotifications(userId: string): Notification[] {
    return this.notifications
      .find((n) => n.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // Does a watch cover the event's cell? True if the event cell is within the watch's kRing.
  private covers(watch: Watch, eventCell: string): boolean {
    return kRing(watch.cell, watch.ringK).includes(eventCell);
  }

  private notify(n: Omit<Notification, "id" | "createdAt" | "read">): Notification {
    return this.notifications.insert({
      ...n,
      id: newId("ntf"),
      createdAt: new Date().toISOString(),
      read: false,
    });
  }

  // Fan-out: only watchers of this product whose ring covers the drop cell are notified.
  onPriceDropped(e: { productId: string; storeId: string; oldPrice: number; newPrice: number; cell: string }): number {
    const watchers = this.watches.find((w) => w.productId === e.productId && this.covers(w, e.cell));
    for (const w of watchers) {
      this.notify({
        userId: w.userId,
        kind: "price_drop",
        productId: e.productId,
        storeId: e.storeId,
        message: `Price dropped from $${e.oldPrice.toFixed(2)} to $${e.newPrice.toFixed(2)} nearby.`,
      });
    }
    return watchers.length;
  }

  // Stores within radius keyed by cell+kRing, for the local deal feed / AR deal pins.
  dealsNear(at: LatLng, radiusMeters: number): Deal[] {
    const origin = cellOf(at, this.deps.h3Resolution);
    const ring = new Set(kRing(origin, ringForMeters(at, radiusMeters, this.deps.h3Resolution)));
    return this.deals
      .find((d) => ring.has(d.cell))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  onDealReported(e: { storeId: string; productId: string | null; kind: ContributionType; cell: string }): number {
    this.deals.insert({
      id: newId("dl"),
      storeId: e.storeId,
      productId: e.productId,
      kind: e.kind,
      cell: e.cell,
      createdAt: new Date().toISOString(),
    });
    if (e.productId === null) return 0;
    const watchers = this.watches.find((w) => w.productId === e.productId && this.covers(w, e.cell));
    for (const w of watchers) {
      this.notify({
        userId: w.userId,
        kind: "deal",
        productId: e.productId,
        storeId: e.storeId,
        message: `A community member reported a deal on your watched item nearby.`,
      });
    }
    return watchers.length;
  }
}
