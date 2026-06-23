// Kafka producer Sink (the bus → Kafka seam, finally swapped in). The Relay drains the durable
// outbox to this sink with at-least-once delivery; here each outbox record becomes one Kafka
// message on a single topic, partitioned by aggregate key so per-entity updates stay ordered.
// The `seq` + `event-id` headers let downstream consumers dedupe (idempotent-consumer pattern,
// Stripe/Kafka §7) — at-least-once on the wire, effectively-once at the consumer.
//
// kafkajs is imported DYNAMICALLY (like pg/redis): the default in-memory build never loads it.
// The message framing below is pure and unit-tested; only the producer connection needs a broker.

import type { OutboxRecord } from "./service.ts";
import type { DomainEvent } from "../../platform/events/events.ts";
import type { Sink } from "./relay.ts";

// Shape of a Kafka message we emit — matches kafkajs's ProducerRecord message, but defined here
// so framing is testable without importing kafkajs.
export type KafkaMessage = { key: string; value: string; headers: Record<string, string> };

// Aggregate key → Kafka partition. Same-key messages land on one partition and stay ordered,
// which is exactly the ordering each aggregate needs (e.g. all price updates for one product:store).
export function partitionKey(event: DomainEvent): string {
  switch (event.type) {
    case "contribution.received":
    case "contribution.scored":
      return event.contributionId;
    case "price.updated":
    case "price.dropped":
      return `${event.productId}:${event.storeId}`; // mirrors the TAO read-path cache key
    case "deal.reported":
      return event.storeId;
    case "product.created":
      return event.productId;
    case "referral.activated":
      return event.referrerId;
    case "reward.granted":
    case "karma.awarded":
    case "trip.completed":
      return event.userId;
  }
}

// Frame a batch of outbox records as Kafka messages. The monotonic `seq` rides along as a header
// (and inside the JSON value) so consumers get a stable total order and a natural dedupe token.
export function toKafkaMessages(records: OutboxRecord[]): KafkaMessage[] {
  return records.map((r) => ({
    key: partitionKey(r.payload),
    value: JSON.stringify({ seq: r.seq, type: r.type, payload: r.payload, createdAt: r.createdAt }),
    headers: { "event-id": r.id, "event-type": r.type, seq: String(r.seq) },
  }));
}

// Minimal structural type for the slice of kafkajs we use — avoids a hard type dependency.
type Producer = {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  send: (record: { topic: string; messages: KafkaMessage[] }) => Promise<unknown>;
};
type Kafka = new (config: { clientId: string; brokers: string[] }) => {
  producer: () => Producer;
};

export type KafkaSinkOptions = {
  brokers: string[];
  topic: string;
  clientId?: string;
};

// Build and connect a Kafka producer sink. Returns the Sink (with a close()) once connected, so
// a broker that is down fails fast at startup rather than silently dropping the event backlog.
export async function createKafkaSink(opts: KafkaSinkOptions): Promise<Sink> {
  const { Kafka } = (await import("kafkajs")) as unknown as { Kafka: Kafka };
  const kafka = new Kafka({ clientId: opts.clientId ?? "smartcart-outbox", brokers: opts.brokers });
  const producer = kafka.producer();
  await producer.connect();

  return {
    name: `kafka(${opts.topic})`,
    // Throwing here leaves the batch unpublished → the Relay retries it next drain (at-least-once).
    deliver: async (records: OutboxRecord[]) => {
      const messages = toKafkaMessages(records);
      if (messages.length === 0) return;
      await producer.send({ topic: opts.topic, messages });
    },
    close: () => producer.disconnect(),
  };
}
