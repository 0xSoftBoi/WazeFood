import { test } from "node:test";
import assert from "node:assert/strict";
import { MatchingService } from "./service.ts";

const catalog = {
  getByUpc: (upc: string) => (upc === "0003" ? { id: "prd_milk" } : undefined),
  listProducts: () => [
    { id: "prd_milk", name: "Whole Milk 1gal", brand: null },
    { id: "prd_eggs", name: "Eggland's Best Large Eggs 12ct", brand: "Eggland's Best" },
    { id: "prd_bread", name: "Wheat Bread 20oz", brand: null },
  ],
};
const svc = () => new MatchingService({ catalog });

test("barcode resolves exactly with full score", () => {
  const r = svc().resolve({ barcode: "0003" });
  assert.equal(r.productId, "prd_milk");
  assert.equal(r.matchScore, 1);
  assert.equal(r.method, "barcode");
});

test("an unknown barcode does not false-match", () => {
  const r = svc().resolve({ barcode: "9999" });
  assert.equal(r.method, "none");
  assert.equal(r.productId, null);
});

test("a cryptic line item normalizes and matches by text", () => {
  // "WHP MLK" → "whole milk" via abbreviation expansion → matches Whole Milk.
  const r = svc().resolve({ text: "WHP MLK 1GAL" });
  assert.equal(r.productId, "prd_milk");
  assert.equal(r.method, "text");
  assert.ok(r.matchScore >= 0.34);
});

test("an unrelated string falls below threshold (no false positive)", () => {
  const r = svc().resolve({ text: "motor oil 5w30" });
  assert.equal(r.method, "none");
});
