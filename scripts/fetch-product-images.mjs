// Backfill real product photos + UPCs from Open Food Facts into db/product-images.json, keyed by
// product id. Run once (network): `node scripts/fetch-product-images.mjs`. Products with q:null get
// no photo (the app renders a designed tile). The output JSON is committed so builds need no network.

import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const catalog = JSON.parse(await readFile(new URL("db/catalog.json", root), "utf8")).products;

const SEARCH = "https://world.openfoodfacts.org/cgi/search.pl";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findOne(q) {
  const url = `${SEARCH}?search_terms=${encodeURIComponent(q)}&fields=code,product_name,brands,image_front_url&page_size=6&json=1`;
  // OFF's search endpoint is flaky (frequent 503s) — retry with backoff.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "WazeFood/0.1 (catalog seed; contact dev)" } });
      if (res.status === 503 || res.status === 429) { await sleep(1000 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error(`OFF ${res.status}`);
      const body = await res.json();
      for (const p of body.products ?? []) {
        if (typeof p.image_front_url === "string" && p.image_front_url.length > 0 && typeof p.code === "string" && p.code.length >= 8) {
          return { imageUrl: p.image_front_url, upc: p.code, offName: p.product_name ?? null };
        }
      }
      return null;
    } catch (e) {
      if (attempt === 4) throw e;
      await sleep(1000 * (attempt + 1));
    }
  }
  return null;
}

const out = {};
let hits = 0;
for (const item of catalog) {
  if (item.q == null) { console.log(`·  ${item.id} — tile (no photo)`); continue; }
  try {
    const found = await findOne(item.q);
    if (found != null) {
      out[item.id] = found;
      hits++;
      console.log(`✓  ${item.id} — ${found.upc}`);
    } else {
      console.log(`✗  ${item.id} — no OFF hit for "${item.q}"`);
    }
  } catch (e) {
    console.log(`!  ${item.id} — ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 250)); // be polite to OFF
}

await writeFile(new URL("db/product-images.json", root), JSON.stringify(out, null, 2) + "\n");
console.log(`\nWrote db/product-images.json — ${hits}/${catalog.length} with real photos.`);
