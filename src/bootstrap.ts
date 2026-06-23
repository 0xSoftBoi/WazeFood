// Durable bootstrap. buildApp stays synchronous and in-memory by default; bootstrap wires the
// persistent drivers when configured (STORE_DRIVER=postgres, CACHE_DRIVER=redis), hydrates from
// storage, and returns flush/close handles. The pg/redis adapters are imported dynamically so
// the default build never loads them (zero runtime dependencies on the memory path).

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildApp, type App } from "./app.ts";
import { type Config, loadConfig } from "./config.ts";
import { systemClock, type Clock } from "./platform/clock.ts";
import { memoryTableFactory, type TableFactory } from "./platform/store/store.ts";
import type { Cache } from "./platform/cache/cache.ts";
import type { Repositories } from "./platform/store/repositories.ts";

// Apply the relational migration (pgvector / PostGIS / Timescale tables) idempotently. Read from the
// migration file so the SQL has a single source of truth.
async function applyRelationalSchema(pool: import("pg").Pool): Promise<void> {
  const path = fileURLToPath(new URL("../db/migrations/0002_relational.sql", import.meta.url));
  const sql = await readFile(path, "utf8");
  await pool.query(sql);
}

export type Durable = {
  app: App;
  flush: () => Promise<void>;
  close: () => Promise<void>;
  drivers: { store: string; cache: string };
};

export async function bootstrap(config: Config = loadConfig(), clock: Clock = systemClock): Promise<Durable> {
  let tables: TableFactory = memoryTableFactory;
  let cache: Cache | undefined;
  let repositories: Repositories | undefined;
  const flushers: Array<() => Promise<void>> = [];
  const closers: Array<() => Promise<void>> = [];
  let hydrateStore: (() => Promise<void>) | undefined;

  if (config.storeDriver === "postgres") {
    const [{ PgPersistor }, { createPersistentFactory }] = await Promise.all([
      import("./platform/store/pg.ts"),
      import("./platform/store/persistence.ts"),
    ]);
    const persistor = new PgPersistor(config.databaseUrl);
    const factory = createPersistentFactory(persistor);
    tables = factory.tables;
    hydrateStore = factory.hydrate;
    flushers.push(factory.flush);
    closers.push(factory.close);

    // Dedicated relational repositories (pgvector / PostGIS / Timescale). Init the pool early and
    // apply the relational migration so the extension-backed tables exist before the app uses them.
    // Degrade gracefully: if the extensions aren't installed on this Postgres, fall back to the
    // in-memory repositories so the core (doc-store) durability path still works.
    await persistor.init();
    try {
      await applyRelationalSchema(persistor.getPool());
      const { PgVectorIndex, PgGeoStoreIndex, PgPriceHistory } = await import("./platform/store/pg-repositories.ts");
      const pool = persistor.getPool();
      repositories = { vectors: new PgVectorIndex(pool), geo: new PgGeoStoreIndex(pool), history: new PgPriceHistory(pool) };
    } catch (e) {
      console.warn(`[bootstrap] relational repositories unavailable (missing pgvector/PostGIS/Timescale?) — using in-memory: ${(e as Error).message}`);
    }
  }

  if (config.cacheDriver === "redis") {
    const { RedisCache } = await import("./platform/cache/redis.ts");
    const redis = new RedisCache(config.redisUrl, clock, { refreshIntervalMs: config.cacheRefreshMs });
    await redis.init();
    cache = redis;
    flushers.push(() => redis.flush());
    closers.push(() => redis.close());
  }

  const app = buildApp(config, clock, { tables, cache, repositories });

  // Hydrate the store after services have registered their tables (during buildApp).
  if (hydrateStore !== undefined) await hydrateStore();

  return {
    app,
    flush: async () => { for (const f of flushers) await f(); },
    close: async () => { for (const c of closers) await c(); },
    drivers: { store: config.storeDriver, cache: config.cacheDriver },
  };
}
