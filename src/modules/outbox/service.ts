// Outbox / durable event log (docs/data-model.md, proven-patterns.md §7). Every domain event
// published on the bus is appended here through the same Table<T> write-behind machinery, so in
// durable mode the full event history persists and survives restart. This is the source a future
// CDC relay publishes from when modules are extracted to their own services (the bus → Kafka
// seam). Delivery to in-process handlers already mutates persisted state, so records are marked
// published immediately; an external sink that fails would leave them unpublished for retry.

import { newId } from "../../platform/id.ts";
import type { Table, TableFactory } from "../../platform/store/store.ts";
import type { DomainEvent, EventType } from "../../platform/events/events.ts";

export type OutboxRecord = {
  id: string;
  seq: number;
  type: EventType;
  payload: DomainEvent;
  createdAt: string;
  publishedAt: string | null;
};

export class OutboxService {
  private readonly outbox: Table<OutboxRecord>;
  private lastSeq = -1;

  constructor(deps: { tables: TableFactory }) {
    this.outbox = deps.tables<OutboxRecord>("outbox");
  }

  record(event: DomainEvent): OutboxRecord {
    const now = new Date();
    // Monotonic sequence; seeded once from hydrated rows, then incremented (stable total order).
    if (this.lastSeq < 0) {
      this.lastSeq = this.outbox.all().reduce((m, r) => Math.max(m, r.seq), 0);
    }
    const seq = ++this.lastSeq;
    return this.outbox.insert({
      id: newId("evt"),
      seq,
      type: event.type,
      payload: event,
      createdAt: now.toISOString(),
      publishedAt: now.toISOString(),
    });
  }

  recent(limit = 50): OutboxRecord[] {
    return this.outbox.all().sort((a, b) => b.seq - a.seq).slice(0, limit);
  }

  count(): number {
    return this.outbox.size();
  }

  countByType(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.outbox.all()) out[r.type] = (out[r.type] ?? 0) + 1;
    return out;
  }

  // Events not yet delivered to an external sink (always 0 today; the relay seam).
  unpublishedCount(): number {
    return this.outbox.find((r) => r.publishedAt === null).length;
  }
}
