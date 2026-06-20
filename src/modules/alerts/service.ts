// Alerts & Watchlist (docs/ARCHITECTURE.md §4.6). Watchlists ("a stock tracker for grocery
// prices") + price-drop fan-out. Consumes price.dropped / deal.reported and matches against
// an inverted watcher index queried by H3 kRing, so we never scan all users per event.

import { cellOf, kRing, ringForMeters, type LatLng } from "../../platform/geo/h3.ts";
import { newId } from "../../platform/id.ts";
import { err, ok, type Result } from "../../platform/result.ts";
import { MemoryTable } from "../../platform/store/store.ts";

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

export class AlertsService {
  private readonly watches = new MemoryTable<Watch>();
  private readonly notifications = new MemoryTable<Notification>();

  private readonly deps: { entitlements: EntitlementsPort; h3Resolution: number };
  constructor(deps: { entitlements: EntitlementsPort; h3Resolution: number }) {
    this.deps = deps;
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

  onDealReported(e: { storeId: string; productId: string | null; cell: string }): number {
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
