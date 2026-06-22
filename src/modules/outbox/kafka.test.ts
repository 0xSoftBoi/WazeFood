// The Kafka sink's framing is pure and testable without a broker: each outbox record maps to one
// message keyed by aggregate (so per-entity updates stay ordered) carrying seq for dedupe. The
// live producer.send path needs a real broker and is exercised separately (gated, like the PG IT).

import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionKey, toKafkaMessages, type KafkaMessage } from "./kafka.ts";
import type { OutboxRecord } from "./service.ts";
import type { Cell } from "../../platform/geo/h3.ts";

const cell = "8828308281fffff" as Cell;

function rec(seq: number, payload: OutboxRecord["payload"]): OutboxRecord {
  return { id: `evt_${seq}`, seq, type: payload.type, payload, createdAt: "2026-06-20T12:00:00Z", publishedAt: null };
}

test("partitionKey keeps each aggregate's events on one partition", () => {
  // price.updated for the same product:store shares a key with price.dropped → ordered together.
  assert.equal(
    partitionKey({ type: "price.updated", productId: "p1", storeId: "s1", price: 3, confidence: 0.9, asOf: "x", source: "shelf", cell }),
    "p1:s1",
  );
  assert.equal(
    partitionKey({ type: "price.dropped", productId: "p1", storeId: "s1", oldPrice: 4, newPrice: 3, cell }),
    "p1:s1",
  );
  assert.equal(partitionKey({ type: "deal.reported", storeId: "s1", productId: null, kind: "clearance", cell }), "s1");
  assert.equal(partitionKey({ type: "karma.awarded", userId: "u1", delta: 5, reason: "r", metro: "slc" }), "u1");
  assert.equal(partitionKey({ type: "contribution.scored", contributionId: "c1", confidence: 0.8, accepted: true }), "c1");
});

test("toKafkaMessages frames records with seq headers and a JSON value", () => {
  const records = [
    rec(1, { type: "product.created", productId: "p1", source: "user" }),
    rec(2, { type: "price.updated", productId: "p1", storeId: "s1", price: 3, confidence: 0.9, asOf: "x", source: "shelf", cell }),
  ];
  const msgs: KafkaMessage[] = toKafkaMessages(records);

  assert.equal(msgs.length, 2);
  assert.equal(msgs[0]!.key, "p1");
  assert.equal(msgs[1]!.key, "p1:s1");

  // Headers carry the dedupe token + type + monotonic seq (idempotent-consumer pattern).
  assert.deepEqual(msgs[1]!.headers, { "event-id": "evt_2", "event-type": "price.updated", seq: "2" });

  // Value round-trips to the full event with its seq.
  const decoded = JSON.parse(msgs[1]!.value);
  assert.equal(decoded.seq, 2);
  assert.equal(decoded.type, "price.updated");
  assert.equal(decoded.payload.productId, "p1");
});

test("toKafkaMessages of an empty batch is empty", () => {
  assert.deepEqual(toKafkaMessages([]), []);
});
