import { test } from "node:test";
import assert from "node:assert/strict";
import { MatchingService, normalizeText } from "./service.ts";

const catalog = {
  getByUpc: (upc: string) => (upc === "0003" ? { id: "prd_milk" } : undefined),
  listProducts: () => [
    { id: "prd_milk", name: "Whole Milk 1gal", brand: null },
    { id: "prd_eggs", name: "Eggland's Best Large Eggs 12ct", brand: "Eggland's Best" },
    { id: "prd_bread", name: "Wheat Bread 20oz", brand: null },
  ],
};
const svc = () => new MatchingService({ catalog });

test("barcode resolves exactly with full score", async () => {
  const r = await svc().resolve({ barcode: "0003" });
  assert.equal(r.productId, "prd_milk");
  assert.equal(r.matchScore, 1);
  assert.equal(r.method, "barcode");
});

test("an unknown barcode does not false-match", async () => {
  const r = await svc().resolve({ barcode: "9999" });
  assert.equal(r.method, "none");
  assert.equal(r.productId, null);
});

test("a cryptic line item normalizes and matches by embedding similarity", async () => {
  // "WHP MLK" → "whole milk" via abbreviation expansion → nearest vector is Whole Milk.
  const r = await svc().resolve({ text: "WHP MLK 1GAL" });
  assert.equal(r.productId, "prd_milk");
  assert.equal(r.method, "text");
  assert.ok(r.matchScore >= 0.5, `score ${r.matchScore}`);
});

test("a different cryptic item resolves to the right product", async () => {
  const r = await svc().resolve({ text: "WHT BRD" }); // wheat bread
  assert.equal(r.productId, "prd_bread");
  assert.equal(r.method, "text");
});

test("an unrelated string falls below threshold (no false positive)", async () => {
  const r = await svc().resolve({ text: "motor oil 5w30" });
  assert.equal(r.method, "none");
});

test("the index tracks catalog changes (new products become matchable)", async () => {
  let products: Array<{ id: string; name: string; brand: string | null }> = [{ id: "prd_milk", name: "Whole Milk 1gal", brand: null }];
  const dynamic = new MatchingService({
    catalog: { getByUpc: () => undefined, listProducts: () => products },
  });
  assert.equal((await dynamic.resolve({ text: "organic banana" })).method, "none");
  products = [...products, { id: "prd_ban", name: "Organic Bananas", brand: null }];
  const r = await dynamic.resolve({ text: "ORG BANANA" });
  assert.equal(r.productId, "prd_ban");
});

test("normalizeText expands abbreviations and drops stopwords", () => {
  assert.equal(normalizeText("GV WHP MLK 1GAL"), "great value whole milk 1gal");
  assert.equal(normalizeText("Wheat Bread 20oz"), "wheat bread 20oz");
});
