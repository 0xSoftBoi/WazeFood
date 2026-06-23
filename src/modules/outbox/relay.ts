// Outbox Relay (the bus → Kafka/webhook seam). Drains undelivered events from the outbox to an
// external Sink with at-least-once delivery: a batch that fails to deliver is left unpublished
// and retried on the next drain. In-process consumers already ran synchronously at publish time;
// this relay is purely for fanning the durable event log out to OTHER services/systems.
//
// Sinks are pluggable: consoleSink (default), httpSink(url) for a webhook/collector, and a
// collecting sink for tests. A real deployment swaps in a Kafka/Pub-Sub producer — same Sink
// interface, the relay loop is unchanged.

import type { OutboxRecord, OutboxService } from "./service.ts";

export type Sink = {
  name: string;
  deliver: (records: OutboxRecord[]) => Promise<void>; // throws on failure → events stay unpublished
  close?: () => Promise<void>; // release a real producer connection (Kafka/Pub-Sub) on shutdown
};

export const consoleSink: Sink = {
  name: "console",
  deliver: async (records) => {
    for (const r of records) console.log(`[outbox→console] ${r.seq} ${r.type}`);
  },
};

// POSTs each batch as JSON to a webhook/collector (e.g. a Pub/Sub push endpoint or a connector).
export function httpSink(url: string): Sink {
  return {
    name: `http(${url})`,
    deliver: async (records) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: records.map((r) => ({ seq: r.seq, type: r.type, payload: r.payload })) }),
      });
      if (!res.ok) throw new Error(`sink HTTP ${res.status}`);
    },
  };
}

// Test/inspection sink that records everything it receives (and can be made to fail N times).
export function collectingSink(opts: { failTimes?: number } = {}): Sink & { delivered: OutboxRecord[] } {
  let fails = opts.failTimes ?? 0;
  const delivered: OutboxRecord[] = [];
  return {
    name: "collecting",
    delivered,
    deliver: async (records) => {
      if (fails > 0) { fails--; throw new Error("sink temporarily unavailable"); }
      delivered.push(...records);
    },
  };
}

export class Relay {
  private readonly outbox: OutboxService;
  private readonly sink: Sink;
  private readonly batchSize: number;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(deps: { outbox: OutboxService; sink: Sink; batchSize?: number }) {
    this.outbox = deps.outbox;
    this.sink = deps.sink;
    this.batchSize = deps.batchSize ?? 100;
  }

  // Deliver one batch of pending events; returns how many were published. On sink failure the
  // batch is NOT marked, so the next drain retries it (at-least-once).
  async drainOnce(): Promise<number> {
    const batch = this.outbox.unpublished(this.batchSize);
    if (batch.length === 0) return 0;
    await this.sink.deliver(batch);
    this.outbox.markPublished(batch.map((r) => r.id));
    return batch.length;
  }

  // Drain repeatedly until the backlog is empty (bounded to avoid runaway loops).
  async drainAll(maxBatches = 1000): Promise<number> {
    let total = 0;
    for (let i = 0; i < maxBatches; i++) {
      const n = await this.drainOnce();
      if (n === 0) break;
      total += n;
    }
    return total;
  }

  start(intervalMs = 1000): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      void this.drainAll().catch((e) => console.error(`[relay:${this.sink.name}] drain error:`, (e as Error).message));
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined; }
  }
}
