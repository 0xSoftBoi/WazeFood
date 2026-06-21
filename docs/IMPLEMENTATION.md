# SmartCart — Implementation (the runnable scaffold)

A working **modular-monolith backend** that embodies the architecture. It runs and tests with
**minimal dependencies** (Node 22's native TypeScript + in-memory adapters; `h3-js` for geo), so the whole
value loop is executable today; the same module seams swap to managed cloud infra later.

## Run it

```bash
npm test          # 18 tests: unit (geo/confidence/entitlements) + e2e value loop + referral
npm run typecheck # tsc --noEmit (needs the one devDep: npm install first)
npm start         # boots the BFF on :3000, seeded with the Salt Lake City demo metro
npm run smoke     # programmatic walk through the value loop, prints the optimized cart
```

Example (server running):
```bash
curl "localhost:3000/prices/best?productId=prd_eggs&lat=40.7608&lng=-111.891"
# → cheapest eggs nearby: $4.99 @ Walmart, with confidence + as_of

curl -X POST localhost:3000/optimize -H 'content-type: application/json' \
  -d '{"userId":"u1","lat":40.7608,"lng":-111.891,"mode":"balanced",
       "items":[{"productId":"prd_eggs","qty":1},{"productId":"prd_cereal","qty":1}]}'
# → explainable plan: baseline → optimized, breakdown {productSwaps, storeDifferences, gas}
```

## How the code maps to the architecture

```
src/
  config.ts                 env → Config (store/cache drivers, H3 resolution)
  app.ts                    composition root: builds modules, wires PORTS + event subscriptions
  main.ts                   gateway middleware (identity + edge rate limit) + routes + listen
  routes.ts                 BFF endpoints (see openapi/openapi.yaml)
  seed.ts                   Salt Lake City demo metro (Phase-0 launch locale)

  platform/                 shared kernel (the seams)
    events/events.ts        domain event contract  (docs/data-model.md)
    events/bus.ts           in-process bus → becomes Kafka on extraction
    geo/h3.ts               H3-style geo-cells (cellOf/parent/kRing) — Uber H3 stand-in
    cache/cache.ts          KV+TTL counters+sorted sets → Redis (TAO follower, metering, leaderboards)
    store/store.ts          Table<T> repository → Postgres
    http/                   tiny router + identity/rate-limit middleware

  modules/                  one folder per bounded context (docs/ARCHITECTURE.md §4)
    identity/               anonymous-first users & devices
    catalog/                products, stores, swaps, aisle locations, UPC lookup
    matching/               entity resolution: barcode→exact, cryptic text→normalized fuzzy
    pricing/                TAO projection + H3 follower cache + drop detection
    ingestion/              idempotent capture + media-hash dedup + geofence + perception
                            routing (cheap→expensive, cost-accounted) + confidence engine
    arscene/                AR/glasses scene assembly (price cards, deal pins, route), per-tier
    optimization/           tiered, token-gated optimizer + explainable breakdown (Meituan-style)
    alerts/                 watchlist + kRing watcher fan-out
    entitlements/           freemium plan + token metering (checked once, reused everywhere)
    gamification/           karma, badges, leaderboards, reputation (feeds confidence)
    referral/               activation state machine + anti-fraud (PDF predicate)
    lists/                  grocery lists, items, store grouping
```

## The seam that makes it scalable

Modules never touch each other's storage. They interact two ways only:

1. **Ports** — a consumer declares a narrow interface (e.g. `PricingPort`, `ReputationPort`)
   and `app.ts` wires the concrete service in. Extraction to a microservice = make the port a
   network client; callers don't change.
2. **Events** — modules publish/subscribe domain events on the bus. Extraction = the bus
   becomes a Kafka topic; the event payloads are unchanged.

The end-to-end test (`test/e2e.test.ts`) proves the whole loop through these seams:
contribute (idempotent) → `price.updated` → projection → `price.dropped` → alert fan-out →
karma/leaderboard → token-gated, explainable optimization.

## Durable mode (Postgres + Redis)

The in-memory adapters are the default; durable drivers are wired and integration-tested:

```bash
docker compose up -d            # or run Postgres + Redis locally
STORE_DRIVER=postgres CACHE_DRIVER=redis \
  DATABASE_URL=postgres://smartcart:smartcart@localhost:5432/smartcart \
  REDIS_URL=redis://localhost:6379 npm start
IT_DURABLE=1 npm run test:it    # proves restart durability against live PG + Redis
```

How it works without making domain logic async:
- **`src/bootstrap.ts`** selects drivers from config, hydrates from storage, returns `flush`/`close`.
- **Store** → `PgPersistor` (`platform/store/pg.ts`): a generic JSONB `doc_rows` backing. Every
  `Table<T>` mutation is **mirrored write-behind**; `hydrate()` reloads rows at startup. Reads
  stay synchronous and in-memory, so no service changed shape — they just take a `TableFactory`.
- **Cache** → `RedisCache` (`platform/cache/redis.ts`): a synchronous local mirror with
  write-behind to Redis; `init()` hydrates counters/leaderboards. (Multi-node async reads are the
  next step.)
- **`main.ts`** flushes on a 2s loop and on SIGINT/SIGTERM, and only seeds when the catalog is empty.

Verified: data written by one process (a crowdsourced $4.42 price, a contribution, karma) hydrates
into a fresh process from Postgres + Redis — `test/persistence.it.test.ts`.

## What's a stand-in (and the production swap)

| Scaffold | Production |
|---|---|
| `platform/geo/h3.ts` | ✅ now real `h3-js` (true hexagons) — the one-file swap, done |
| `MemoryTable` default | `STORE_DRIVER=postgres` → JSONB `doc_rows`; dedicated relational repos per `db/migrations/0001_init.sql` later |
| `MemoryCache` default | `CACHE_DRIVER=redis` → `RedisCache` (mirror+write-behind today; async distributed next) |
| in-process `EventBus` | Kafka / Pub-Sub, with the transactional `outbox` table |
| inline confidence scoring | async queue workers + replay (re-score on model change) |
| `Bearer user:<id>` auth | ✅ now access JWT + rotating refresh (`auth` module); `devVerifier` → Apple/Google JWKS is the drop-in |
| heuristic optimizer | OR/ILP planning tier behind the cache |
| `matching` token-similarity | embeddings + ANN blocking over `products.embedding` (pgvector) |
| `RoutingPerception` stub extractor | real barcode (on-device) + cheap VLM + escalation, same routing/cost model |
