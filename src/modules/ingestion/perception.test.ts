import { test } from "node:test";
import assert from "node:assert/strict";
import { RoutingPerception } from "./perception.ts";

test("barcode capture costs nothing (decoded on-device)", () => {
  const p = new RoutingPerception();
  const r = p.perceive({ barcode: "0003", reportedPrice: 3.19 });
  assert.deepEqual(r.routes, ["barcode"]);
  assert.equal(r.costCents, 0);
  assert.equal(r.extractionConfidence, 1);
});

test("a photo runs cheap OCR and escalates only when low-confidence", () => {
  const p = new RoutingPerception();
  // Sweep many media hashes; some escalate, some don't — but none exceed cheap+expensive.
  let escalated = 0;
  let cheapOnly = 0;
  for (let i = 0; i < 50; i++) {
    const r = p.perceive({ mediaHash: `photo-${i}` });
    assert.ok(r.routes[0] === "ocr_cheap");
    if (r.routes.includes("vlm_expensive")) escalated++;
    else cheapOnly++;
    assert.ok(r.extractionConfidence >= 0.7 || r.routes.includes("vlm_expensive"));
  }
  assert.ok(escalated > 0 && cheapOnly > 0, "routing should sometimes escalate and sometimes not");
});

test("routing saves money vs sending everything to the expensive model", () => {
  const p = new RoutingPerception();
  p.perceive({ barcode: "0001" });          // free
  p.perceive({ text: "GV WHP MILK" });      // free (client-structured)
  for (let i = 0; i < 20; i++) p.perceive({ mediaHash: `m-${i}` }); // cheap, some escalate
  const s = p.stats();
  assert.ok(s.spentCents < s.baselineCents, "spend should beat the naive baseline");
  assert.ok(s.savedPct > 0);
});
