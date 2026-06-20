# SmartCart — Scaling Playbook

How to scale each component, and the **trigger** that says "extract this module into
its own service now." We build seams early and distribute late: a module earns the
right to become a service by hitting its trigger — never on aesthetics.

## Read the triggers, not the calendar

For each load-bearing context: the bottleneck it hits first, how to scale it in place,
and the signal to extract + scale it independently.

### Crowdsource Ingestion & Confidence — *usually first to hurt*
- **Bottleneck:** ML cost/latency (OCR, vision), bursty uploads, scoring throughput.
- **In place:** already async behind the queue from day one; scale ML workers
  horizontally; batch OCR; cache vision results by media hash; backpressure via queue.
- **Extract when:** ML worker fleet needs independent autoscaling/GPU, or ingestion
  spikes threaten API latency, or you need an isolated trust boundary for receipts.
- **Then:** dedicated Ingestion service + worker pool; tune confidence model on its own
  release cadence (replayable, so re-score historical data freely).

### Optimization & Routing — *spiky CPU*
- **Bottleneck:** combinatorial cart/route compute under concurrent users.
- **In place:** cache plans by `(normalized cart, geo cell, store set, price-data version)`
  — carts in a metro overlap heavily, so hit rate climbs with users; precompute popular
  staple baskets; cap free runs via Entitlements tokens.
- **Extract when:** CPU saturates the monolith or P95 optimize latency breaches budget.
- **Then:** stateless Optimization service behind a queue + warm cache; scale replicas to
  load; route/gas calls cached per cell.

### Pricing & Geo read path — *highest QPS*
- **Bottleneck:** read QPS on "best nearby price," cache stampedes on popular cells.
- **In place:** Redis hot cache keyed by geohash; current-price as projection (never
  aggregate raw reports live); Postgres read replicas; request coalescing.
- **Extract when:** read QPS dominates the box or you need geo-distributed read caches.
- **Then:** Pricing read service + per-metro cache tier; multi-region read replicas;
  edge cache for the hottest cells.

### Alerts & Watchlist — *fan-out spikes*
- **Bottleneck:** one popular price drop → fan-out to many watchers.
- **In place:** inverted watcher index (`watchers:{product}:{geohash}`), batch+dedup,
  quiet hours, per-user rate caps; consume `price.dropped` off the bus.
- **Extract when:** push volume or fan-out latency needs isolation.
- **Then:** dedicated Alerts service + notification workers; sharded watcher index.

### Search — *index growth*
- **Bottleneck:** product/deal corpus growth, vector NN cost.
- **In place:** OpenSearch cluster sizing, pgvector → dedicated vector store as it grows.
- **Extract when:** index ops/relevance tuning need an independent lifecycle.

### Gamification / Entitlements — *cheap, scale in place a long time*
- Redis sorted sets (leaderboards) and TTL counters (metering) scale far before needing
  extraction. Snapshot leaderboards to Postgres for history. Extract only if they become
  an operational concern in their own right (rarely first).

---

## Data scaling order

1. **Postgres vertical + read replicas** — covers MVP and well beyond.
2. **Split Timescale/time-series out** of the primary when history writes/reads compete
   with OLTP.
3. **Geo/metro partitioning & sharding** of pricing/contribution data — the natural shard
   key is metro/geohash; data is intrinsically local, so this scales near-linearly per city.
4. **Dedicated vector store** when pgvector outgrows the primary.
5. **Multi-region** read replicas + edge caches when latency/availability require it —
   single region until then.

## Cache strategy (defense in depth)

```
on-device last-known prices  →  CDN (images, static)  →  Redis hot cells
   →  Postgres read replica  →  primary
```
Every layer that hits reduces load on the next; the offline-first client is the first and
cheapest cache. Caches carry `as_of`/`confidence` so staleness is always visible.

## Cost-control levers (tie cost to value)

- **Freemium metering** (tokens) directly caps the expensive operations (optimization,
  image search) — cost scales with monetizable usage, not free usage.
- **Async + batch** the paid 3rd-party calls (OCR, vision, maps); cache aggressively by
  content hash and geo cell.
- **Tiered storage** for media (hot → cold), retention/rollups for time-series.
- **On-device AI** (barcode, capture coaching, pre-filtering) offloads server cost.

## Capacity signals to watch (wired to the warehouse / APM)

- Queue depth & age (ingestion backpressure) · ML worker utilization & cost/contribution
- Optimize cache hit rate & P95 latency · Pricing read QPS & Redis hit rate
- Alert fan-out latency & push volume · Postgres replication lag & connection saturation
- Per-device read velocity & geo-coherence (anti-scrape) · Token-bucket exhaustion rates

Each crossing its threshold is the cue to apply the matching lever above — and, when in
place tuning is exhausted, to extract the service.
