# Real-Time Data + Geospatial Engineering for SmartCart

**Audience:** SmartCart backend / infra. **Date:** 2026-06-20. **Tone:** senior-infra memo.
**Scope:** turning the four in-memory production stand-ins — `EventBus`, `MemoryCache`, `MemoryTable`, and the hand-rolled `platform/geo/h3.ts` — into production components *behind the same module interfaces*. The workload is massively read-dominated, geo-bounded ("best nearby price"), with price-drop alert fan-out to watchers within N miles. We are bootstrapped, so every recommendation carries an MVP (managed, cheap) and an at-scale tier.

The scaffold already encodes the right instincts: the follower cache is keyed **per projection row** (`price:${productId}:${storeId}`), not per cell, because one coarse cell holds many stores (`src/modules/pricing/service.ts:108`); the H3 module exposes exactly `cellOf / parent / kRing / distanceMeters / ringForMeters` so the real library is a one-file swap (`src/platform/geo/h3.ts:8`); events are versioned by `type` so the in-process payloads become Kafka topic payloads unchanged (`src/platform/events/events.ts:2`). This memo's job is to make those swaps concrete and cited.

---

## 1. Geospatial: H3 vs PostGIS KNN vs Redis GEO

### 1.1 H3 resolution choice

H3 is Uber's hexagonal hierarchical index. It uses an **aperture-7** subdivision — each cell has ~7 children, edge length shrinks by ~√7 (≈2.65×) and area by ~7× per resolution step ([h3geo.org indexing](https://h3geo.org/docs/highlights/indexing/)). Hexagons are the right primitive for a "nearby" workload because there is **exactly one distance between a cell's centerpoint and each of its neighbours**, versus two for squares and three for triangles — which is precisely why Uber adopted them for demand/supply bucketing and surge pricing ([Uber H3 blog](https://www.uber.com/blog/h3/)).

The authoritative resolution table ([h3geo.org restable](https://h3geo.org/docs/core-library/restable/)):

| Res | Avg edge length | Avg area | Reading for SmartCart |
|-----|-----------------|----------|-----------------------|
| 6   | 3.72 km         | 36.1 km² | Metro / city deal feed, trend roll-ups |
| **7** | **1.41 km**   | **5.16 km²** | Coarse "neighbourhood" — too big for store-level, good as a **shard/roll-up parent** |
| **8** | **0.53 km**   | **0.74 km²** | **Default store-locator key.** A cell ≈ a few city blocks; a handful of stores per cell |
| **9** | **0.20 km**   | **0.11 km²** | Dense urban store key; fine watcher-index cell |
| 10  | 0.076 km        | 0.015 km² | Geofence-grade "are you actually in the store" check |

**Recommendation: res 8 as the primary store/price/watcher cell, res 6–7 as the roll-up parent, res 9–10 for dense metros and geofence validation.** Rationale: a "best nearby price" query at 2–5 miles needs a `kRing` whose cell count stays small. At res 8 a 5 mi (~8 km) radius is `ceil(8000/530) ≈ 16` cells of ring radius — `gridDisk(k)` returns `3k(k+1)+1` cells, so k=16 ≈ 817 cells; that is large. The scaffold's `ringForMeters` already computes this (`src/platform/geo/h3.ts:69`). The fix is the **two-resolution pattern**: index stores at res 8 but answer wide-radius queries by taking the res-7 parent and a small `kRing` there, then refine with `distanceMeters`. Most "nearby" reads are 1–3 mi, which at res 8 is k=3–9 (37–271 cells) — acceptable for a Redis `SINTER`/multi-`GET` fan-in.

### 1.2 kRing (gridDisk) vs polyfill (polygonToCells)

- **`gridDisk`/`kRing`** — all cells within grid-distance k of an origin. This is the **point-radius "nearby" primitive**: the user's location → cell → ring → candidate cells. It is an approximate disk, so you always post-filter with true `distanceMeters` (`src/platform/geo/h3.ts:56`). This is SmartCart's dominant access pattern.
- **`polygonToCells` (polyfill)** — fills a GeoJSON polygon with cells; containment is decided **by cell centroid**, so adjacent polygons partition cleanly without overlap ([h3geo.org regions](https://h3geo.org/docs/api/regions/)). Use this for *area* features: a chain's delivery zone, a "downtown" deal region, a metro boundary for the feed — not for per-request nearby reads.

This directly answers the classic LBS **GeoHash boundary problem**: with a raw geohash prefix, a closer venue across a cell edge can be missed while a farther one in-cell matches; the standard fix is to query the origin block *plus its 8 neighbours* and then compute real distance ([cnblogs LBSer GeoHash 原理](https://www.cnblogs.com/LBSer/p/3310455.html)). H3's `kRing` is the hexagonal, equidistant-neighbour generalization of exactly that 9-block search — which is why it is structurally superior to square-grid geohash for proximity.

### 1.3 H3 in Postgres (h3-pg) vs app-side

`h3-pg` (now under `postgis/h3-pg`) exposes the H3 core API as SQL — `h3_latlng_to_cell()`, `h3_cell_to_parent()`, `h3_grid_disk()`, etc., with the cell stored as a native `h3index` type you can B-tree index ([h3-pg repo](https://github.com/zachasme/h3-pg)). Two placement options:

- **App-side (recommended for MVP):** compute the cell in `platform/geo/h3.ts` (real `h3-js`), store it as a plain `text`/`bigint` column on `stores`/`current_price`, B-tree index it. "Nearby" = compute `kRing` in Node → `WHERE cell = ANY($1)` → distance filter in SQL or Node. Zero extra extension, trivial to shard by cell, works on any managed Postgres.
- **In-Postgres (`h3-pg`) at scale:** keeps cell math next to the data for analytical roll-ups (`GROUP BY h3_cell_to_parent(cell, 7)`), and lets the planner use the `h3index` B-tree. Adds an extension dependency some managed providers don't allow.

### 1.4 When PostGIS KNN, when Redis GEO, when H3

- **PostGIS KNN** — the index-aware `<->` operator with `ORDER BY geom <-> point LIMIT n` is the gold standard for *exact* k-nearest on a GiST index; the plan becomes an `Index Scan` over the GiST tree ([PostGIS KNN workshop](https://postgis.net/workshops/postgis-intro/knn.html)). Use `geography` for correct great-circle distance globally, `geometry` for cheaper planar math in a metro ([Crunchy: geography type](https://www.crunchydata.com/blog/postgis-and-the-geography-type)). Best when you need *true* nearest-N with arbitrary radius and you're already in Postgres.
- **Redis GEO** — `GEOADD`/`GEOSEARCH BYRADIUS|BYBOX` stores members in a sorted set scored by a 52-bit interleaved geohash; complexity is `O(N + log M)` over the bounding box ([Redis GEOSEARCH](https://redis.io/docs/latest/commands/geosearch/)). Fast and in-memory, but the docs themselves flag the limits: everything is in RAM, only circle/box (no polygon), and for very large/sparse sets PostGIS or a real index is better. Best as a **hot cache of store positions per metro**, not the system of record.
- **H3** — best when the cell is *also* your **shard key, cache key, join key, and roll-up key** simultaneously. That is SmartCart: the same res-8 cell shards `current_price`, keys the watcher index, and rolls up to the metro feed. PostGIS answers "nearest" beautifully but doesn't give you a stable discrete bucket to fan out alerts or pre-aggregate trends; H3 does.

**Verdict for SmartCart:** H3 cell as the universal bucket (already the design); PostGIS GiST/KNN as the authoritative `stores.nearby()` backing the `StoreLocatorPort` (`src/modules/pricing/service.ts:33`); Redis GEO optionally as a per-metro hot store-position cache.

---

## 2. The read path (TAO pattern)

SmartCart's hot read never aggregates raw reports — it serves a `current_price` projection (`src/modules/pricing/service.ts:12`), which is the Facebook **TAO** model: a read-optimized layer over a relational store-of-record, serving a billion+ reads/sec at Facebook by tiering caches and exploiting eventual consistency ([Meta TAO](https://engineering.fb.com/2013/06/25/core-infra/tao-the-power-of-the-graph/)).

- **Leader/follower tiering.** In TAO, **followers** take client requests and serve hits; on a miss they fill from a **leader**, which alone talks to MySQL — shielding the database from the read flood ([Meta TAO](https://engineering.fb.com/2013/06/25/core-infra/tao-the-power-of-the-graph/)). SmartCart's mapping: the short-TTL `cache.get` is the follower (`FOLLOWER_TTL_MS = 30_000`, `service.ts:47`), the `current_price` projection table is the leader, raw `price_history` is MySQL/Postgres. Keep this exact shape.
- **Write-through + invalidation.** TAO updates caches as writes propagate and invalidates on change. SmartCart already does this: `onPriceUpdated` upserts the projection, appends history, and **busts the follower key** (`service.ts:92`), then emits `price.dropped`. This is correct cache-aside-with-write-through; keep the bust, but make it an **invalidation message** (publish `price.updated` → all app nodes `DEL` the key) once there are multiple Redis-fronting nodes, mirroring Meta's EVCache-style invalidation already noted in the code comment.
- **Keying — the load-bearing detail.** The follower key must be **per projection row** (`price:${product}:${store}`), *never* per cell, because a res-8 cell holds several stores; the scaffold comment at `service.ts:106` says exactly this and the code honours it. Do not "optimize" this into a per-cell key — that would conflate distinct stores' prices.
- **Stampede protection.** When a hot key's TTL lapses under load, many requests recompute at once ([Wikipedia: cache stampede](https://en.wikipedia.org/wiki/Cache_stampede)). Apply all three mitigations: (a) **request coalescing / single-flight** — first miss takes a short Redis lock, others wait or serve stale; (b) **TTL jitter** — randomize the 30 s TTL ±20% so keys don't expire in lockstep; (c) **probabilistic early expiration (XFetch)** — recompute slightly before expiry with probability rising toward the TTL, with the exponential-distribution β=1 shown optimal ([Wikipedia: cache stampede](https://en.wikipedia.org/wiki/Cache_stampede)). XFetch is the cheapest high-leverage add for hot products in dense cells.

---

## 3. Event backbone

The `EventBus` (`src/platform/events/bus.ts`) already models per-consumer isolation and idempotent handlers — the contract a real broker must preserve.

### 3.1 Broker choice

| Option | Ops burden | Cost at MVP | Notes |
|--------|-----------|-------------|-------|
| **Cloud Pub/Sub (GCP) / SNS+SQS** | Lowest (fully managed) | Pay-per-message, ~free at low volume | No partitions to size; at-least-once; **ordering only via ordering keys**. Best MVP default. |
| **Redpanda (self/managed)** | Low | Few nodes | Kafka-API compatible, C++ , no JVM/ZooKeeper; benchmarked ~10× better p99.99 tail latency and up to 3× fewer nodes than Kafka ([Redpanda vs Kafka](https://www.redpanda.com/blog/redpanda-vs-kafka-performance-benchmark)). Best "Kafka without the ops". |
| **Apache Kafka (MSK/Confluent)** | High self-managed | Higher (JVM, 6–9 nodes for what Redpanda does in 3) | Ecosystem king (Debezium, Connect). Pick when you need the connector ecosystem and have ops capacity. |
| **Kinesis** | Low (AWS-managed) | Shard-hour pricing | Fine on AWS; shard management and 24h–365d retention model differ from Kafka. |
| **NATS / JetStream** | Lowest infra | Cheap | Great for low-latency RPC/fanout; weaker for log-replay/CDC analytics. |

**Recommendation:** **MVP on cloud Pub/Sub** (no cluster to babysit; ordering keys = our partition key). **Graduate to Redpanda** when we need Kafka-API tooling (Debezium, ksqlDB) and replayable logs without Kafka's JVM/ZooKeeper tax.

### 3.2 Transactional outbox + CDC

The dual-write problem is real: writing the projection to Postgres and publishing to the broker are not atomic, so a crash leaves them divergent ([microservices.io: outbox](https://microservices.io/patterns/data/transactional-outbox.html)). The fix: write the domain event into an **`outbox` table in the same DB transaction** as the projection upsert, then a **message relay** ships it. Two relay flavors: a **polling publisher**, or **transaction-log tailing / CDC** ([microservices.io: outbox](https://microservices.io/patterns/data/transactional-outbox.html)). For CDC, **Debezium** reads the Postgres WAL and its **Outbox Event Router SMT** turns outbox rows into properly-routed Kafka topics — guaranteeing the event is published **iff** the transaction commits, while the relay may still emit duplicates (hence idempotent consumers) ([Debezium outbox router](https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html)). SmartCart maps cleanly: `onPriceUpdated`'s projection upsert + an `outbox` insert in one tx; Debezium/relay replaces the in-process `bus.publish`.

### 3.3 Idempotency, exactly-once, ordering/partitioning

- **Exactly-once is qualified, not magic.** Kafka offers at-most/at-least/exactly-once; the idempotent producer dedups resends via sequence numbers, and transactions span producer+offset commits — but the docs explicitly warn that "exactly once" claims "might not be what you think" across system boundaries ([Confluent delivery semantics](https://docs.confluent.io/kafka/design/delivery-semantics.html)). Treat the broker as **at-least-once end-to-end** and make consumers idempotent — exactly what the scaffold already assumes (`bus.ts:2`).
- **Idempotent consumers.** Give each event a primary key so reprocessing is a no-op; Kafka's own guidance is "assign messages a primary key so updates are idempotent" ([Confluent](https://docs.confluent.io/kafka/design/delivery-semantics.html)). SmartCart already has natural keys: `price.updated` → `${product}|${store}|${asOf}` (the same id used for the history row at `service.ts:84`); use it as the dedup/upsert key. The `MemoryCache.incr` with a TTL key is a ready idempotency-marker primitive (`cache.ts:60`).
- **Ordering / partitioning.** Kafka guarantees order **within a partition**, and same-key messages land on the same partition ([Confluent](https://docs.confluent.io/kafka/design/delivery-semantics.html)). Partition price topics by **`(productId, cell)`** so all updates and the resulting drop for one product in one neighbourhood are strictly ordered — preventing an older price from clobbering a newer projection. On Pub/Sub the equivalent is the **ordering key** `productId|cell`.

---

## 4. Time-series price history

`price_history` (`src/modules/pricing/service.ts:23`) is append-mostly and feeds the 30-day tracker and store/category trends — a textbook TimescaleDB case.

- **Hypertables + continuous aggregates.** Make `price_history` a **hypertable** (time-partitioned chunks) and define **continuous aggregates** — materialized views that refresh **incrementally in the background**, recomputing only the changed time buckets rather than the whole view ([TigerData: continuous aggregates](https://www.tigerdata.com/blog/what-is-a-continuous-aggregate/), [Timescale docs](https://www.tigerdata.com/docs/use-timescale/latest/continuous-aggregates/about-continuous-aggregates)). The 30-day price tracker, per-store and per-category trends each become a continuous aggregate keyed by `time_bucket('1 day', ts)`. **Real-time aggregation** unions the materialized rollup with the newest raw rows so the chart is current ([Timescale docs](https://www.tigerdata.com/docs/use-timescale/latest/continuous-aggregates/about-continuous-aggregates)). Build the metro/category feed as **hierarchical aggregates** (aggregate-on-aggregate), which Timescale supports natively.
- **Compression + retention.** Convert older chunks to columnstore (cited "up to 98%" compression) and attach retention policies to drop raw rows past, say, 13 months while keeping the daily continuous aggregate forever ([Timescale docs](https://www.tigerdata.com/docs/use-timescale/latest/continuous-aggregates/about-continuous-aggregates)).
- **Alternative — ClickHouse.** Columnar storage with delta encoding hits **10–100× compression** and sub-second aggregations over billions of rows at millions of inserts/sec, and can join time-series to other datasets ([ClickHouse TSDB](https://clickhouse.com/engineering-resources/what-is-time-series-database)). The tradeoff: it sacrifices update flexibility (append-optimized) and is a *second* operational system. **Verdict:** stay on **TimescaleDB** at MVP — it's a Postgres extension, so it reuses our primary DB, ops, and the same `Table<T>` adapter; revisit ClickHouse only if analytical query volume dwarfs the transactional store.

---

## 5. Alert fan-out at scale

`price.dropped` (`src/modules/pricing/service.ts:95`, carrying `productId` + `cell`) is the fan-out trigger. The watchers-within-N-miles problem is a reverse geo-join; do it with an **inverted watcher index in Redis**:

- **Index shape.** `SADD watch:{productId}:{cell} → userId` — a Redis set per (product, res-8 cell). On a drop, compute `kRing(cell, k)` for the alert radius and `SUNION` the matching sets to get candidate watchers in O(ring) — the hexagonal analogue of the 9-block geohash neighbour search ([cnblogs LBSer](https://www.cnblogs.com/LBSer/p/3310455.html)). This is the same Redis-set primitive the cache contract already exposes; the leaderboard sorted-sets (`cache.ts:18`) show the team is comfortable with this model.
- **Batch / dedup / quiet-hours.** A user watching the same product in overlapping rings must get **one** notification: dedup by `userId` after the `SUNION`, then a per-user TTL marker (`incr` with TTL, `cache.ts:60`) suppresses repeats within a window. Respect quiet-hours by deferring to a per-user local-time send window. Coalesce multiple drops into a digest where possible.
- **Geofence trigger.** For "you're near a store with a deal," validate true presence at **res 10** (`distanceMeters` post-filter) before pushing — the cell ring is the cheap pre-filter, distance is the gate.
- **Push throughput/cost.** **APNs** is HTTP/2, **one request per device token**, multiplexed (500–1000 concurrent streams per connection) with JWT (ES256) auth and per-token `410`/`429` handling ([Apple APNs](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)). **FCM** handles Android and can also proxy APNs; both bill effectively per-message at trivial cost, so the real cost is **our** fan-out compute, not the push vendor. Keep a worker pool draining a `price.dropped` consumer, sharded by cell, with connection pooling to APNs/FCM.

---

## 6. Offline-first sync (brief)

The mobile shopping list needs to edit offline and reconcile. Two models: **CRDTs** merge concurrent edits mathematically with no central authority and no lost updates (Yjs/Automerge), at the cost of metadata overhead; **last-write-wins (LWW)** is timestamp-based, trivial to implement, but silently drops concurrent edits. For a personal shopping list (rarely truly concurrent, single-user-multi-device), **LWW per list-item keyed by `(itemId, updatedAt)` is sufficient** — promote to a CRDT only if shared/collaborative lists ship. Reuse the existing event/clock plumbing (`platform/clock.ts`) for the LWW timestamp so server and client agree on ordering. *(General CRDT-vs-LWW tradeoff per standard offline-first practice; no single citation retrieved.)*

---

## 7. Concrete migration plan

Swap each stand-in **behind its existing interface**, MVP-managed first, scale later.

| Seam (file) | Interface to preserve | MVP (managed, cheap) | At scale |
|-------------|----------------------|----------------------|----------|
| `platform/geo/h3.ts` | `cellOf / parent / kRing / distanceMeters / ringForMeters` | Drop in **`h3-js`**; store cell as `text` column, B-tree index | Add **`h3-pg`** for in-DB roll-ups; two-res query (res 8 index, res 7 parent for wide radius) |
| `MemoryTable<T>` (`store/store.ts`) | `insert/upsert/get/find/update/delete` | **Managed Postgres** (Supabase/Neon/RDS) + **PostGIS** for `stores.nearby` KNN | **TimescaleDB** hypertable for `price_history`; shard `current_price` by cell |
| `MemoryCache` (`cache/cache.ts`) | `get/set/del/incr/zincr/zrevrange/zscore` | **Managed Redis** (Upstash/Elasticache) — follower cache, token TTL counters, leaderboards as-is | TAO follower/leader tiers; Redis GEO per-metro store positions; XFetch + TTL jitter |
| `EventBus` (`events/bus.ts`) | `on / publish / publishAll`, per-consumer isolation | **Cloud Pub/Sub** with ordering key `productId\|cell`; outbox table + polling relay | **Redpanda** + **Debezium** outbox-router CDC; partition by `(productId, cell)` |

**Ordered steps:**
1. **DB first.** Move `MemoryTable` → managed Postgres+PostGIS; back `StoreLocatorPort.nearby` with `ORDER BY geom <-> point LIMIT n` on a GiST index. Add a `cell` column populated by `h3-js`. *No interface change.*
2. **Cache.** Point the `Cache` adapter at managed Redis; ship the follower cache, idempotency markers (`incr`+TTL), and leaderboard zsets unchanged. Add TTL jitter + XFetch to `bestNearbyPrice`'s fill path (`service.ts:128`).
3. **Outbox.** In `onPriceUpdated`, write the event to an `outbox` table in the **same transaction** as the projection upsert. Begin with a polling relay → Pub/Sub.
4. **Broker.** Replace `bus.publish` with a Pub/Sub publisher behind the same `EventBus` interface; set ordering key `productId|cell`. Consumers stay idempotent via the existing `${product}|${store}|${asOf}` key.
5. **Time-series.** Make `price_history` a TimescaleDB hypertable; build continuous aggregates for the 30-day tracker and store/category trends; add compression + retention.
6. **Alerts.** Stand up the Redis inverted watcher index (`watch:{product}:{cell}`); have the `price.dropped` consumer `kRing`→`SUNION`→dedup→push (FCM/APNs).
7. **Scale-out (only when metrics demand):** Redpanda+Debezium CDC; `h3-pg`; TAO follower/leader tiers; ClickHouse if analytics outgrow Timescale.

---

## What this means for SmartCart

- **`platform/geo/h3.ts`** — the stand-in's `cellOf/parent/kRing/distanceMeters/ringForMeters` are a faithful subset of `h3-js`; swap is one file. Adopt **res 8** as the store/price/watcher cell and **res 6–7** as the roll-up parent; use the existing `ringForMeters` (`h3.ts:69`) to bound `kRing`, and the **two-resolution trick** for wide-radius reads so ring cell-counts stay sane. `kRing` is the principled fix for the geohash boundary problem, so the design is already correct in shape.
- **Pricing follower cache** (`modules/pricing/service.ts`) — keep keying **per `productId:storeId`** (`service.ts:108`); this is the load-bearing correctness fact and it's right. Map the 30 s follower TTL + projection table onto TAO's follower/leader tiers; add **stampede protection** (coalescing + TTL jitter + XFetch) on the `bestNearbyPrice` miss-fill (`service.ts:134`). Keep the write-through + cache-bust on `price.updated` (`service.ts:92`) and turn the bust into a fan-out invalidation message once multi-node.
- **`EventBus`** (`platform/events/bus.ts`) — its per-consumer isolation and idempotent-handler assumption map directly to at-least-once brokers; preserve the interface and back it with **Pub/Sub (MVP) → Redpanda (scale)**. Add the **transactional outbox** in `onPriceUpdated`, partition/order by **`(productId, cell)`**, and dedup consumers on the natural `${product}|${store}|${asOf}` key (`service.ts:84`).
- **`MemoryTable`** (`platform/store/store.ts`) — split by access pattern: **Postgres+PostGIS** for `stores`/`current_price` (GiST KNN powers `StoreLocatorPort.nearby`), **TimescaleDB** hypertable + continuous aggregates for `price_history`. Same `Table<T>` shape; cell column shards the hot projection.
- **`MemoryCache`** (`platform/cache/cache.ts`) — its three feature families (KV+TTL, TTL `incr` counters, sorted sets) are exactly Redis; the **inverted watcher index** for alert fan-out reuses Redis sets, and the leaderboard zsets carry over unchanged. Optionally add **Redis GEO** as a per-metro hot store-position cache.

---

## Sources

- H3 resolution table — https://h3geo.org/docs/core-library/restable/
- H3 indexing & compaction (aperture 7, logical vs geographic containment) — https://h3geo.org/docs/highlights/indexing/
- H3 regions: polygonToCells / centroid containment — https://h3geo.org/docs/api/regions/
- Uber H3 engineering blog (why hexagons, marketplace/pricing use) — https://www.uber.com/blog/h3/
- h3-pg PostgreSQL extension — https://github.com/zachasme/h3-pg
- PostGIS KNN (`<->`, GiST, ORDER BY ... LIMIT) — https://postgis.net/workshops/postgis-intro/knn.html
- PostGIS geography vs geometry — https://www.crunchydata.com/blog/postgis-and-the-geography-type
- Redis GEOSEARCH / GEOADD (52-bit geohash sorted set, limits) — https://redis.io/docs/latest/commands/geosearch/
- Classic LBS GeoHash boundary problem & 9-block fix — https://www.cnblogs.com/LBSer/p/3310455.html
- Facebook TAO (follower/leader, write-through, read-dominated) — https://engineering.fb.com/2013/06/25/core-infra/tao-the-power-of-the-graph/
- Cache stampede: coalescing, XFetch probabilistic early expiration — https://en.wikipedia.org/wiki/Cache_stampede
- Transactional outbox (dual-write, polling vs CDC relay) — https://microservices.io/patterns/data/transactional-outbox.html
- Debezium outbox event router SMT — https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html
- Kafka delivery semantics (exactly-once caveats, idempotent consumers, partition ordering) — https://docs.confluent.io/kafka/design/delivery-semantics.html
- Redpanda vs Kafka benchmark (C++, no JVM/ZooKeeper, tail latency, fewer nodes) — https://www.redpanda.com/blog/redpanda-vs-kafka-performance-benchmark
- TimescaleDB continuous aggregates (concept) — https://www.tigerdata.com/blog/what-is-a-continuous-aggregate/
- TimescaleDB continuous aggregates / compression / retention (docs) — https://www.tigerdata.com/docs/use-timescale/latest/continuous-aggregates/about-continuous-aggregates
- ClickHouse for time-series (columnar, 10–100× compression, tradeoffs) — https://clickhouse.com/engineering-resources/what-is-time-series-database
- Apple APNs (HTTP/2, one request per token, JWT, throughput) — https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
