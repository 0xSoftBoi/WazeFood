// Lists & Households (docs/ARCHITECTURE.md §4.10). Grocery lists, items, per-item prefs, and
// store grouping. Stays decoupled: it reports "user added an item / searched" through an
// optional activity port (wired to Referral) and groups by store through a pricing port.

import { cellOf, type LatLng } from "../../platform/geo/h3.ts";
import { newId } from "../../platform/id.ts";
import type { Table, TableFactory } from "../../platform/store/store.ts";

export type ItemPrefs = {
  brandRequired: boolean;
  storeBrandOk: boolean;
  organicOnly: boolean;
  noSubstitutions: boolean;
  alertWhenCheaper: boolean;
};

const DEFAULT_PREFS: ItemPrefs = {
  brandRequired: false,
  storeBrandOk: true,
  organicOnly: false,
  noSubstitutions: false,
  alertWhenCheaper: false,
};

export type List = { id: string; ownerId: string; householdId: string | null; name: string; createdAt: string };
export type ListItem = {
  id: string;
  listId: string;
  productId: string;
  qty: number;
  prefs: ItemPrefs;
  boughtBy: string | null;
  boughtAt: string | null;
};

export type ActivityPort = { recordActivity: (userId: string, delta: { productsAdded?: number; searches?: number }) => void };
export type PricingPort = {
  bestNearbyPrice: (productId: string, at: LatLng, radiusMeters: number) => { storeId: string; price: number } | undefined;
};

export class ListsService {
  private readonly lists: Table<List>;
  private readonly items: Table<ListItem>;

  private readonly deps: { activity?: ActivityPort; pricing?: PricingPort; h3Resolution: number; tables: TableFactory };
  constructor(deps: { activity?: ActivityPort; pricing?: PricingPort; h3Resolution: number; tables: TableFactory }) {
    this.deps = deps;
    this.lists = deps.tables<List>("lists");
    this.items = deps.tables<ListItem>("list_items");
  }

  createList(ownerId: string, name: string): List {
    return this.lists.insert({
      id: newId("lst"),
      ownerId,
      householdId: null,
      name,
      createdAt: new Date().toISOString(),
    });
  }

  getList(listId: string): (List & { items: ListItem[] }) | undefined {
    const list = this.lists.get(listId);
    if (list === undefined) return undefined;
    return { ...list, items: this.items.find((i) => i.listId === listId) };
  }

  addItem(input: { listId: string; ownerId: string; productId: string; qty?: number; prefs?: Partial<ItemPrefs> }): ListItem {
    const item = this.items.insert({
      id: newId("itm"),
      listId: input.listId,
      productId: input.productId,
      qty: input.qty ?? 1,
      prefs: { ...DEFAULT_PREFS, ...(input.prefs ?? {}) },
      boughtBy: null,
      boughtAt: null,
    });
    // Feed referral activation signals (the referred user is "building their first list").
    this.deps.activity?.recordActivity(input.ownerId, { productsAdded: 1 });
    return item;
  }

  markBought(itemId: string, userId: string): ListItem | undefined {
    return this.items.update(itemId, { boughtBy: userId, boughtAt: new Date().toISOString() });
  }

  // Organize the list by store using cheapest-nearby (the "basic list" view; the optimized
  // plan lives in the Optimization module).
  organizeByStore(listId: string, at: LatLng): { stores: Array<{ storeId: string; items: string[] }>; cell: string } {
    const items = this.items.find((i) => i.listId === listId);
    const byStore = new Map<string, string[]>();
    for (const it of items) {
      const best = this.deps.pricing?.bestNearbyPrice(it.productId, at, 15_000);
      const storeId = best?.storeId ?? "unknown";
      const list = byStore.get(storeId) ?? [];
      list.push(it.productId);
      byStore.set(storeId, list);
    }
    return {
      stores: [...byStore.entries()].map(([storeId, items]) => ({ storeId, items })),
      cell: cellOf(at, this.deps.h3Resolution),
    };
  }
}
