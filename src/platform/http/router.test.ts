// Router hardening, exercised over a real socket on an ephemeral port: body-size cap (413),
// invalid-JSON handling (400), gzip negotiation, and normal dispatch. Uses global fetch.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Router } from "./router.ts";

let base = "";
let server: ReturnType<Router["listen"]>;

before(async () => {
  const router = new Router({ maxBodyBytes: 1024, gzip: true });
  router.post("/echo", (ctx) => ({ status: 200, body: { got: ctx.body } }));
  router.get("/big", () => ({ status: 200, body: { blob: "x".repeat(5000) } }));
  router.get("/hello", () => ({ status: 200, body: { hi: true } }));
  await new Promise<void>((resolve) => {
    server = router.listen(0, resolve);
  });
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

after(() => { server.close(); server.closeAllConnections?.(); });

test("normal JSON request dispatches", async () => {
  const res = await fetch(`${base}/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: 1 }) });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { got: { a: 1 } });
});

test("a body over the limit is rejected with 413", async () => {
  const res = await fetch(`${base}/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ big: "y".repeat(4000) }) });
  assert.equal(res.status, 413);
  assert.equal(((await res.json()) as { error: string }).error, "payload_too_large");
});

test("invalid JSON is rejected with 400", async () => {
  const res = await fetch(`${base}/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, "bad_request");
});

test("large responses are gzipped when the client accepts it", async () => {
  const res = await fetch(`${base}/big`, { headers: { "accept-encoding": "gzip" } });
  assert.equal(res.status, 200);
  // fetch transparently decodes; assert the body is intact and the server advertised encoding.
  assert.equal(res.headers.get("content-encoding"), "gzip");
  assert.equal(((await res.json()) as { blob: string }).blob.length, 5000);
});

test("small responses are not gzipped", async () => {
  const res = await fetch(`${base}/hello`, { headers: { "accept-encoding": "gzip" } });
  assert.equal(res.headers.get("content-encoding"), null);
  assert.deepEqual(await res.json(), { hi: true });
});
