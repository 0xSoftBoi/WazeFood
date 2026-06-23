// Postgres-backed relational repositories (the extension-powered graduation of repositories.ts).
//   - PgVectorIndex   → pgvector: ANN over product_vectors.embedding via the cosine operator `<=>`
//   - PgGeoStoreIndex → PostGIS: radius search over store_geo.geom via ST_DWithin (geography = metres)
//   - PgPriceHistory  → TimescaleDB: append-only price_points hypertable, time-bounded reads
// Schema lives in db/migrations/0002_relational.sql. These are imported only in relational mode and
// exercised by the gated integration test (no live Postgres in CI by default).

import type { GeoStore, GeoStoreIndex, PriceHistory, PricePoint, VectorIndex } from "./repositories.ts";

type Pool = import("pg").Pool;

const toVector = (vec: number[]): string => `[${vec.join(",")}]`;

export class PgVectorIndex implements VectorIndex {
  constructor(private readonly pool: Pool) {}

  async loadSignatures(): Promise<Array<{ id: string; sig: string }>> {
    const res = await this.pool.query<{ id: string; sig: string }>("SELECT id, sig FROM product_vectors");
    return res.rows;
  }

  async upsertMany(rows: Array<{ id: string; sig: string; vec: number[] }>): Promise<void> {
    if (rows.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const r of rows) {
        await client.query(
          `INSERT INTO product_vectors (id, sig, embedding) VALUES ($1, $2, $3::vector)
           ON CONFLICT (id) DO UPDATE SET sig = EXCLUDED.sig, embedding = EXCLUDED.embedding`,
          [r.id, r.sig, toVector(r.vec)],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async removeMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.pool.query("DELETE FROM product_vectors WHERE id = ANY($1)", [ids]);
  }

  async nearest(query: number[], k: number): Promise<Array<{ id: string; score: number }>> {
    // `<=>` is cosine distance (vector_cosine_ops); cosine similarity = 1 - distance.
    const res = await this.pool.query<{ id: string; score: string }>(
      `SELECT id, 1 - (embedding <=> $1::vector) AS score
       FROM product_vectors ORDER BY embedding <=> $1::vector LIMIT $2`,
      [toVector(query), k],
    );
    return res.rows.map((r) => ({ id: r.id, score: Number(r.score) }));
  }
}

export class PgGeoStoreIndex implements GeoStoreIndex {
  constructor(private readonly pool: Pool) {}

  async upsert(store: GeoStore): Promise<void> {
    await this.pool.query(
      `INSERT INTO store_geo (id, geom) VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)
       ON CONFLICT (id) DO UPDATE SET geom = EXCLUDED.geom`,
      [store.id, store.lng, store.lat],
    );
  }

  async remove(id: string): Promise<void> {
    await this.pool.query("DELETE FROM store_geo WHERE id = $1", [id]);
  }

  async nearby(lat: number, lng: number, radiusMeters: number): Promise<Array<{ id: string; meters: number }>> {
    const here = "ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography";
    const res = await this.pool.query<{ id: string; meters: string }>(
      `SELECT id, ST_Distance(geom, ${here}) AS meters
       FROM store_geo WHERE ST_DWithin(geom, ${here}, $3)
       ORDER BY meters`,
      [lat, lng, radiusMeters],
    );
    return res.rows.map((r) => ({ id: r.id, meters: Number(r.meters) }));
  }
}

export class PgPriceHistory implements PriceHistory {
  constructor(private readonly pool: Pool) {}

  async append(p: PricePoint): Promise<void> {
    await this.pool.query(
      "INSERT INTO price_points (product_id, store_id, price, confidence, at) VALUES ($1, $2, $3, $4, $5)",
      [p.productId, p.storeId, p.price, p.confidence, p.at],
    );
  }

  async range(productId: string, storeId: string, fromISO: string, toISO: string): Promise<PricePoint[]> {
    const res = await this.pool.query<{ product_id: string; store_id: string; price: string; confidence: string; at: Date }>(
      `SELECT product_id, store_id, price, confidence, at FROM price_points
       WHERE product_id = $1 AND store_id = $2 AND at BETWEEN $3 AND $4 ORDER BY at ASC`,
      [productId, storeId, fromISO, toISO],
    );
    return res.rows.map(rowToPoint);
  }

  async latest(productId: string, storeId: string): Promise<PricePoint | undefined> {
    const res = await this.pool.query<{ product_id: string; store_id: string; price: string; confidence: string; at: Date }>(
      `SELECT product_id, store_id, price, confidence, at FROM price_points
       WHERE product_id = $1 AND store_id = $2 ORDER BY at DESC LIMIT 1`,
      [productId, storeId],
    );
    const row = res.rows[0];
    return row === undefined ? undefined : rowToPoint(row);
  }
}

function rowToPoint(r: { product_id: string; store_id: string; price: string; confidence: string; at: Date }): PricePoint {
  return { productId: r.product_id, storeId: r.store_id, price: Number(r.price), confidence: Number(r.confidence), at: new Date(r.at).toISOString() };
}
