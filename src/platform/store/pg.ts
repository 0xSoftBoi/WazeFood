// Postgres persistor — the durable system of record (docs/research/realtime-geospatial.md).
// A generic JSONB document backing (doc_rows) so every module's Table<T> persists without
// per-entity SQL; the relational schema in db/migrations is the target once modules grow
// dedicated repositories. Writes are batched (write-behind) and flushed transactionally.
//
// `pg` is loaded dynamically so the default (memory) build stays dependency-free.

import type { Persistor } from "./persistence.ts";
import type { Row } from "./store.ts";

type QueuedWrite = { table: string; op: "upsert" | "delete"; row: Row };

export class PgPersistor implements Persistor {
  private pool: import("pg").Pool | undefined;
  private queue: QueuedWrite[] = [];
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  async init(): Promise<void> {
    if (this.pool !== undefined) return; // idempotent: hydrate() and early repo wiring both call init()
    const { Pool } = await import("pg");
    this.pool = new Pool({ connectionString: this.url, max: 4 });
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS doc_rows (
        table_name TEXT NOT NULL,
        id         TEXT NOT NULL,
        data       JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (table_name, id)
      );
    `);
  }

  // The connection pool, for dedicated relational repositories (pg-repositories.ts). Available
  // after init().
  getPool(): import("pg").Pool {
    return this.must();
  }

  async loadAll(table: string): Promise<Row[]> {
    const pool = this.must();
    const res = await pool.query<{ data: Row }>("SELECT data FROM doc_rows WHERE table_name = $1", [table]);
    return res.rows.map((r) => r.data);
  }

  write(table: string, op: "upsert" | "delete", row: Row): void {
    this.queue.push({ table, op, row });
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    const pool = this.must();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const w of batch) {
        if (w.op === "delete") {
          await client.query("DELETE FROM doc_rows WHERE table_name = $1 AND id = $2", [w.table, w.row.id]);
        } else {
          await client.query(
            `INSERT INTO doc_rows (table_name, id, data) VALUES ($1, $2, $3)
             ON CONFLICT (table_name, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
            [w.table, w.row.id, JSON.stringify(w.row)],
          );
        }
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      // Re-queue the failed batch so a later flush retries (at-least-once durability).
      this.queue = batch.concat(this.queue);
      throw e;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.flush().catch(() => {});
    await this.pool?.end();
  }

  private must(): import("pg").Pool {
    if (this.pool === undefined) throw new Error("PgPersistor not initialized — call init()/hydrate() first");
    return this.pool;
  }
}
