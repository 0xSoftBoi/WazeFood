// The extractor's parsing is pure and tested offline. The Anthropic provider is exercised with an
// injected fetch (no network): we assert the request it builds (model tier, image block, headers)
// and that it parses the model's JSON reply. The live API call is the only un-tested part (gated).

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseExtraction, anthropicExtractor, deterministicExtractor } from "./extractor.ts";

test("parseExtraction reads strict JSON", () => {
  assert.deepEqual(parseExtraction('{"price": 4.99, "text": "MILK", "confidence": 0.9}'), { price: 4.99, text: "MILK", confidence: 0.9 });
});

test("parseExtraction tolerates ```json fences and prose", () => {
  const raw = "Here you go:\n```json\n{\"price\": 2.5, \"text\": \"EGGS\", \"confidence\": 0.8}\n```";
  assert.deepEqual(parseExtraction(raw), { price: 2.5, text: "EGGS", confidence: 0.8 });
});

test("parseExtraction clamps confidence and defaults sensibly", () => {
  assert.equal(parseExtraction('{"price": 1, "confidence": 5}').confidence, 1, "clamped to 1");
  assert.equal(parseExtraction('{"price": 1}').confidence, 0.6, "price present, no confidence → 0.6");
  assert.equal(parseExtraction('{"text": "x"}').confidence, 0, "no price → 0");
});

test("parseExtraction degrades gracefully on garbage", () => {
  for (const bad of ["", "not json", "{", "null"]) {
    assert.deepEqual(parseExtraction(bad), { price: null, text: null, confidence: 0 });
  }
});

test("deterministicExtractor: expensive tier reports higher confidence than a weak cheap read", async () => {
  const ex = deterministicExtractor();
  const expensive = await ex.extract({ mediaHash: "zzz" }, "expensive");
  assert.equal(expensive.confidence, 0.92);
});

test("anthropicExtractor builds the right request and parses the reply", async () => {
  let captured: { url: string; body: any; headers: any } | null = null;
  const fakeFetch = (async (url: string, init: any) => {
    captured = { url, body: JSON.parse(init.body), headers: init.headers };
    return {
      ok: true,
      json: async () => ({ content: [{ type: "text", text: '{"price": 6.49, "text": "OJ 52OZ", "confidence": 0.93}' }] }),
    };
  }) as unknown as typeof fetch;

  const ex = anthropicExtractor({ apiKey: "sk-test", cheapModel: "haiku-x", expensiveModel: "opus-x", fetchImpl: fakeFetch });
  const out = await ex.extract({ image: { base64: "aGVsbG8=", mediaType: "image/png" }, text: "OJ" }, "cheap");

  assert.deepEqual(out, { price: 6.49, text: "OJ 52OZ", confidence: 0.93 });
  assert.equal(captured!.body.model, "haiku-x", "cheap tier uses the cheap model");
  assert.equal(captured!.headers["x-api-key"], "sk-test");
  assert.equal(captured!.headers["anthropic-version"], "2023-06-01");
  const img = captured!.body.messages[0].content.find((c: any) => c.type === "image");
  assert.equal(img.source.media_type, "image/png");
  assert.equal(img.source.data, "aGVsbG8=");
});

test("anthropicExtractor: expensive tier selects the expensive model", async () => {
  let model = "";
  const fakeFetch = (async (_url: string, init: any) => {
    model = JSON.parse(init.body).model;
    return { ok: true, json: async () => ({ content: [{ type: "text", text: "{}" }] }) };
  }) as unknown as typeof fetch;
  const ex = anthropicExtractor({ apiKey: "k", cheapModel: "h", expensiveModel: "o", fetchImpl: fakeFetch });
  await ex.extract({ image: { url: "https://x/y.jpg" } }, "expensive");
  assert.equal(model, "o");
});

test("anthropicExtractor throws on a non-OK response (so routing leaves it unscored → retry)", async () => {
  const fakeFetch = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
  const ex = anthropicExtractor({ apiKey: "k", fetchImpl: fakeFetch });
  await assert.rejects(() => ex.extract({ image: { base64: "x" } }, "cheap"), /HTTP 503/);
});
