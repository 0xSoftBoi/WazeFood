import { test } from "node:test";
import assert from "node:assert/strict";
import { cosine, hashingEmbeddings, voyageEmbeddings } from "./embeddings.ts";
import { normalizeText } from "./service.ts";

test("hashing embeddings: related text is nearer than unrelated text", async () => {
  const e = hashingEmbeddings({ normalizer: normalizeText });
  const [milkQuery, milkDoc, oil] = await e.embed(["whole milk", "whole milk 1gal", "motor oil 5w30"]);
  const near = cosine(milkQuery!, milkDoc!);
  const far = cosine(milkQuery!, oil!);
  assert.ok(near > far, `related ${near} should beat unrelated ${far}`);
  assert.ok(near > 0.5, `related cosine ${near} should be high`);
  assert.ok(far < 0.3, `unrelated cosine ${far} should be low`);
});

test("hashing embeddings are L2-normalized (self-cosine ~ 1)", async () => {
  const e = hashingEmbeddings();
  const [v] = await e.embed(["great value whole milk"]);
  assert.ok(Math.abs(cosine(v!, v!) - 1) < 1e-9);
});

test("cosine handles zero / mismatched-length vectors safely", () => {
  assert.equal(cosine([0, 0], [1, 1]), 0);
  assert.equal(cosine([], [1]), 0);
});

test("voyageEmbeddings posts inputs and returns the provider's vectors", async () => {
  let captured: any = null;
  const fakeFetch = (async (_url: string, init: any) => {
    captured = JSON.parse(init.body);
    return { ok: true, json: async () => ({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }] }) };
  }) as unknown as typeof fetch;

  const e = voyageEmbeddings({ apiKey: "k", model: "voyage-3", fetchImpl: fakeFetch });
  const out = await e.embed(["a", "b"]);
  assert.deepEqual(out, [[0.1, 0.2], [0.3, 0.4]]);
  assert.deepEqual(captured.input, ["a", "b"]);
  assert.equal(captured.model, "voyage-3");
});

test("voyageEmbeddings of an empty batch makes no request", async () => {
  let called = false;
  const fakeFetch = (async () => { called = true; return { ok: true, json: async () => ({ data: [] }) }; }) as unknown as typeof fetch;
  const e = voyageEmbeddings({ apiKey: "k", fetchImpl: fakeFetch });
  assert.deepEqual(await e.embed([]), []);
  assert.equal(called, false);
});
