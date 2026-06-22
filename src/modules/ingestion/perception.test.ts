import { test } from "node:test";
import assert from "node:assert/strict";
import { RoutingPerception } from "./perception.ts";
import type { Extractor } from "./extractor.ts";

test("barcode capture costs nothing (decoded on-device)", async () => {
  const p = new RoutingPerception();
  const r = await p.perceive({ barcode: "0003", reportedPrice: 3.19 });
  assert.deepEqual(r.routes, ["barcode"]);
  assert.equal(r.costCents, 0);
  assert.equal(r.extractionConfidence, 1);
});

test("a photo runs cheap OCR and escalates only when low-confidence", async () => {
  const p = new RoutingPerception();
  // Sweep many media hashes; some escalate, some don't — but none exceed cheap+expensive.
  let escalated = 0;
  let cheapOnly = 0;
  for (let i = 0; i < 50; i++) {
    const r = await p.perceive({ mediaHash: `photo-${i}` });
    assert.ok(r.routes[0] === "ocr_cheap");
    if (r.routes.includes("vlm_expensive")) escalated++;
    else cheapOnly++;
    assert.ok(r.extractionConfidence >= 0.7 || r.routes.includes("vlm_expensive"));
  }
  assert.ok(escalated > 0 && cheapOnly > 0, "routing should sometimes escalate and sometimes not");
});

test("routing saves money vs sending everything to the expensive model", async () => {
  const p = new RoutingPerception();
  await p.perceive({ barcode: "0001" });          // free
  await p.perceive({ text: "GV WHP MILK" });      // free (client-structured)
  for (let i = 0; i < 20; i++) await p.perceive({ mediaHash: `m-${i}` }); // cheap, some escalate
  const s = p.stats();
  assert.ok(s.spentCents < s.baselineCents, "spend should beat the naive baseline");
  assert.ok(s.savedPct > 0);
});

test("the price read by the extractor flows through (real-VLM shape)", async () => {
  // A fake extractor that "reads" $5.49 with high confidence — no escalation, that price surfaces.
  const extractor: Extractor = {
    extract: async () => ({ price: 5.49, text: "MILK 1GAL", confidence: 0.95 }),
  };
  const p = new RoutingPerception({ extractor });
  const r = await p.perceive({ mediaHash: "x", image: { url: "https://img/1.jpg" } });
  assert.deepEqual(r.routes, ["ocr_cheap"]);
  assert.equal(r.price, 5.49);
  assert.equal(r.extractionConfidence, 0.95);
});

test("a low-confidence cheap read escalates and the expensive read wins", async () => {
  let calls = 0;
  const extractor: Extractor = {
    extract: async (_c, tier) => {
      calls++;
      return tier === "cheap" ? { price: 1.0, text: null, confidence: 0.4 } : { price: 2.49, text: "EGGS", confidence: 0.97 };
    },
  };
  const p = new RoutingPerception({ extractor });
  const r = await p.perceive({ image: { base64: "abc" } });
  assert.deepEqual(r.routes, ["ocr_cheap", "vlm_expensive"]);
  assert.equal(calls, 2);
  assert.equal(r.price, 2.49, "the expensive tier's read replaces the low-confidence cheap one");
  assert.equal(r.extractionConfidence, 0.97);
});
