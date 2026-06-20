# SmartCart — Proven Scale Patterns (Netflix · Meta · Cloudflare · Uber · AWS)

The first draft asserted a sensible architecture. This document grounds it in **how the
companies that operate at planetary scale actually solve the same problems SmartCart has**,
and maps each battle-tested pattern onto a specific SmartCart workload. The point isn't to
cargo-cult FAANG complexity onto a 50-user MVP — it's to make sure the *seams we draw now*
are the seams these companies proved scale later.

SmartCart's workloads rhyme with problems already solved in public:

| SmartCart problem | Who solved this shape at scale | Pattern we adopt |
|---|---|---|
| "Best nearby price" — massively read-dominated lookups over a price/product graph | **Meta TAO** (the social graph) | Read-optimized graph cache + write-through, two-tier regional cache |
| "Stores / deals / watchers within N miles" | **Uber H3** | Hexagonal hierarchical geo-cells as shard + cache + query key |
| Stay up on bad networks; never cascade a failure | **Netflix** (Hystrix, chaos, active-active) | Circuit breakers, graceful degradation, multi-region, precompute |
| Protect the data graph from scrapers; serve fast globally | **Cloudflare** (anycast edge, bot score) | Edge read path + bot-score anti-scraping + edge rate limiting |
| Contain failure to one city; scale city-by-city | **AWS / DoorDash** cell-based architecture | The **metro = a cell**; linear scale by adding cells |
| Turn noisy crowd reports into trusted data without getting gamed | **Waze** (the literal analogue) | Reputation-weighted trust + ML cross-verification + Sybil defense |
| Never lose, never double-count an untrusted write | **Stripe / Kafka** outbox + idempotency | Idempotency keys, transactional outbox, idempotent consumers |

---

## 1. Pricing read path → **Meta's TAO** (read-optimized graph cache)

**What Meta does.** Facebook's social graph is **~99.8% reads** — over a *billion* reads/sec
vs. millions of writes/sec. They do **not** serve that by querying MySQL with a lookaside
memcache; they built **TAO**, a read-optimized, graph-aware cache in front of MySQL with
**two tiers per region**: clients hit **followers** (tier 1); a follower miss fills from a
**leader** (tier 2); leaders talk to MySQL and keep the region consistent. **All writes are
write-through** (follower → leader → DB), and caches update as the write's reply propagates
back. A key insight: Facebook's hot data follows **creation-time locality** (recent items are
hottest), not spatial/relational locality — so the cache is organized around that.
([TAO blog](https://engineering.fb.com/2013/06/25/core-infra/tao-the-power-of-the-graph/),
[TAO paper](https://www.usenix.org/system/files/conference/atc13/atc13-bronson.pdf))

**Why SmartCart is the same shape.** "What's the best nearby price for this product?" is the
dominant query, it's overwhelmingly **read**, and it's a lookup over a **graph** (product →
store → price, plus swaps and store-brand equivalences). Computing it live from raw
crowdsourced reports on every read would be TAO's anti-pattern.

**What we adopt (already in the plan, now with provenance):**
- **`current_price` is the TAO-style read projection**, not a live aggregation. Raw
  contributions are the "DB of record"; the projection is the graph cache.
- **Two-tier cache:** Redis **follower** cache per metro → regional **leader**/read-replica →
  Postgres. A follower miss fills from the leader, exactly like TAO.
- **Write-through on ingestion:** a scored contribution updates the projection and busts the
  cache as it propagates — so a contributor sees their own correction immediately
  (read-after-write), while everyone else is eventually consistent.
- **"Creation-time locality" → "freshness locality":** recent prices/deals are the hottest
  and most valuable (and the product literally surfaces `as_of`), so cache TTLs and
  precompute prioritize fresh items. This is the same locality insight, reused.

> Takeaway: make writes do the work so reads are trivial — TAO's central trade. SmartCart's
> ingestion pipeline is "slow" (async scoring) precisely so the read path is O(1) cache hits.

---

## 2. Geospatial → **Uber's H3** (hexagonal hierarchical index)

**What Uber does.** Uber finds nearby drivers at ~**1M requests/sec** using **H3**: the globe
is tiled into **hexagonal cells across 16 resolutions**; each cell is a **64-bit ID**. Nearby
search = `kRing(origin, k)` (all cells within grid-distance k ≈ a circle). The **cell ID is
the shard/index key**, and because child IDs **truncate to their parent**, you aggregate to
coarser resolutions with bit ops (California = 10,633 cells at res 6, but only 901 in
*compact* hierarchical form). Hexagons are used because every neighbor is **equidistant** from
a cell's center, which squares/triangles can't offer.
([H3 blog](https://www.uber.com/us/en/blog/h3/), [h3geo.org](https://h3geo.org/),
[uber/h3](https://github.com/uber/h3))

**Why SmartCart is the same shape.** Every core query is geo-bounded: "stores within N miles,"
"is this deal within 10 miles of my ZIP," "who watches product X near here," geofence
validation of a contribution. My first draft hand-waved this as "geohash." **H3 is the
correct, proven tool** and upgrades several parts of the design:
- **Shard & cache key:** the H3 cell ID (at a chosen resolution, e.g. res 7–8 ≈ neighborhood)
  becomes the partition key for `current_price`, the Redis hot-cell key, and the alert
  **watcher index** (`watchers:{product}:{h3}`). Equidistant neighbors make radius math clean.
- **Radius queries via `kRing`:** "nearby price / nearby deal" = union over `kRing` cells —
  bounded, index-friendly, no expensive distance scans.
- **Hierarchical roll-ups for free:** truncate child→parent to power the **deal feed**,
  **metro/category price trends**, and the "10 users reported clearance near you" aggregate —
  no separate rollup pipeline, just coarser cells. (PostGIS still handles exact point geometry
  and geofencing; H3 handles bucketing/sharding/caching/aggregation.)

> This replaces "geohash" everywhere in `data-model.md` and `scaling-playbook.md` with H3 cells.

---

## 3. Resilience & global serving → **Netflix**

Netflix is the canonical answer to "stay available on flaky conditions and never let one
failure cascade." Four patterns map straight onto SmartCart:

**(a) Circuit breakers + bulkheads + graceful degradation (Hystrix).** Netflix wraps every
remote dependency so a slow/failed one trips a breaker and returns a **fallback** instead of
cascading. ([Netflix on microservices/Hystrix](https://cloudexpert.network/mastering-chaos-a-netflix-guide-to-microservices/))
→ **SmartCart:** the optimizer, maps/gas API, and OCR are all behind breakers. If the
optimizer is down, **fall back to last-known cached cart plan**; if pricing is degraded,
**serve the on-device last-known price with its `as_of` label**. This is the same instinct as
our "offline-friendly" principle — server-side bulkheading is just offline-first pushed up the
stack.

**(b) Chaos engineering.** Netflix injects failure (the Simian Army) to *prove* resilience
rather than assume it. ([Coralogix on Netflix fault injection](https://coralogix.com/blog/how-netflix-uses-fault-injection-to-truly-understand-their-resilience/))
→ **SmartCart (Phase 2):** game-day the ingestion queue backing up, a metro-cell's cache
dying, the OCR provider timing out — verify reads still serve and alerts still drain.

**(c) Multi-region active-active + global cache invalidation (EVCache).** Netflix runs
**active-active across 3 AWS regions** (any 2 can fail, 1 serves all traffic). EVCache moves
**~400M ops/sec over ~2 trillion items**, and on a write in one region it sends an
**SQS message to invalidate** that key in other regions.
([Active-active](https://netflixtechblog.com/active-active-for-multi-regional-resiliency-c47719f6685b),
[Global caching](https://netflixtechblog.com/caching-for-a-global-netflix-7bcc457012f1))
→ **SmartCart:** start single-region (50 users don't need 3 regions — Netflix didn't either at
first). But adopt the **invalidation mechanism now**: a `price.updated` event is exactly
EVCache's cross-region invalidation message — it busts the affected H3 cell in every cache
tier/region. The pattern is wired in from day one; the extra regions get switched on when
latency/availability demand it.

**(d) Precompute offline, serve online.** Netflix precomputes heavy work (recommendations)
in batch and serves it from cache for instant reads.
→ **SmartCart:** precompute full-cart optimization for **popular staple baskets per metro-cell**
offline and serve from cache; live optimization only for novel carts. This is what makes the
CPU-heavy optimizer cheap at scale and is already the cache-key strategy in the playbook.

---

## 4. Edge, anti-scraping & rate limiting → **Cloudflare**

**What Cloudflare does.** Code runs on an **anycast edge across 330+ cities**, auto-routed to
the nearest PoP (within ~50ms of 95% of users), scaling to **millions of req/sec with no
capacity planning**. **Bot Management** assigns every request a **bot score (1–99)** from
layered detectors and then blocks / challenges / rate-limits accordingly; **rate limiting**
runs at the edge using **Workers KV / Durable Objects**; volumetric attacks are absorbed
before reaching origin.
([Cloudflare reference architectures](https://developers.cloudflare.com/reference-architecture/architectures/security/),
[Bot management](https://developers.cloudflare.com/reference-architecture/diagrams/bots/bot-management/))

**Why this is critical for SmartCart.** "**Protect the data graph**" is a stated product
principle — the crowdsourced price graph *is* the moat, and competitors will try to scrape it.
Cloudflare's model is the proven blueprint:
- **Anti-scraping as a bot-score system, not a flag.** Score read requests from layered signals
  (device attestation, per-account/device velocity, **geo-coherence via H3** — one account
  "shopping" across 20 distant cells is extraction, not shopping) and block/challenge/rate-limit
  on the score. This is §8 of the architecture doc, now with a concrete model behind it.
- **Rate limiting + the read path at the edge.** Put the CDN/edge in front, rate-limit per
  device/account at the edge (Workers-KV style), and serve cached "best nearby price" for hot
  H3 cells from the edge — which *also* directly serves "fast on bad networks / frugal with
  mobile data." Bulk price export stays impossible through consumer APIs; bulk data is the
  separate B2B product.
- **Edge-first, origin-light.** The more we answer at the edge (static, images, hot cells), the
  less origin we run — the same economics that let Cloudflare/Netflix scale cheaply.

---

## 5. Blast-radius isolation & city-by-city scale → **Cell-based architecture (AWS / DoorDash)**

**What it is.** Inspired by ship **bulkheads**: split the system into **isolated cells**, each a
self-contained replica with its **own DB, cache, and capacity**. A failure floods only its cell;
you **scale linearly by adding cells**, and deploys are **cell-aware** (progressive, with bake
time and auto-rollback — never push to all cells at once). DoorDash re-platformed onto this
("Project SuperCell") for exactly hyperscale failure-isolation reasons.
([AWS bulkhead/cell guidance](https://github.com/aws-solutions-library-samples/guidance-for-cell-based-architecture-on-aws),
[Cell-based architecture overview](https://dzone.com/articles/grokking-cell-based-architecture))

**Why this is *the* unlock for SmartCart.** SmartCart's data is intrinsically **local**, and
the product thesis is literally **city-by-city network effects**. So **the metro is the natural
cell**:
- Each **metro-cell** = its own DB partition (H3-keyed), cache tier, and capacity. A bad
  ingestion spike or cache failure in Seattle **cannot** affect Nashville.
- **Linear scale = launch a new city = add a cell.** Adding Phoenix is "stand up a cell + seed
  stores," not a schema migration or a re-shard — matching the rollout in `roadmap.md`.
- **Cell-aware progressive rollout:** ship a risky optimizer/confidence-model change to **one
  metro-cell first**, bake, watch its KPIs, auto-rollback on alarm, then progress. The first 50
  users (SLC) are literally cell #1.

> Cells turn "scale to millions across many metros" into a repeatable, low-blast-radius
> operation instead of a heroic re-architecture — and they map 1:1 onto the business plan.

---

## 6. Crowdsourced trust → **Waze** (the literal analogue)

SmartCart *is* "Waze for groceries," so Waze's own answer to "how do you trust data from
strangers, at scale, without getting gamed" is the most directly relevant case study of all.

**What Waze does.** Real-time data from millions of phones is served from **Memorystore
(Redis) at >1M MGET/sec, ~1ms latency**. Trust is a **layered reputation system**: contributors
earn points/ranks ("Baby Wazer" → "Royalty Wazer"), and trusted veterans become Area
Managers/Regional Coordinators with elevated edit rights and dispute resolution. Reports are
**cross-verified with rule-based + ML checks against anonymized GPS/speed data** to flag
anomalies, and automated routines validate edits for geometry/duplicates/conflicts. Academic
work on Waze specifically studies **Sybil attacks** (fake devices fabricating reports) and the
defenses against them.
([Waze on Memorystore](https://cloud.google.com/blog/products/databases/how-waze-keeps-traffic-flowing-with-memorystore),
[Sybil attacks on Waze (UChicago)](https://people.cs.uchicago.edu/~ravenben/publications/pdf/waze-ton18.pdf),
[Establishing trust in crowdsourced data](https://arxiv.org/pdf/2511.03016))

**What we adopt — this *is* SmartCart's Confidence Engine, validated:**
- **Confidence = reputation-weighted, not source-weighted alone.** A "Royalty Wazer" maps to
  SmartCart's **karma/badge reputation** (Verified Price Hunter, Receipt Verifier). High-rep
  contributors' reports get higher prior confidence; new accounts must be corroborated. This is
  exactly the doc's "weighted karma" / "higher-confidence data gets higher rewards."
- **Cross-verification against independent signal.** Waze checks reports against GPS/speed;
  SmartCart cross-checks a reported price against **other recent reports, receipt OCR, and
  location-validation (geofence: was the device actually at the store?)** before promoting it
  to `current_price`. Agreement raises confidence; disagreement opens a dispute/low-confidence
  state — never silently overwrite verified data with one unverified report.
- **Sybil/fraud defense is a first-class threat, not an afterthought.** The referral SMS
  verification, device/phone dedup, and velocity checks already in the plan are precisely the
  anti-Sybil controls the Waze literature prescribes — and they protect *contribution* quality,
  not just referral payouts. Tie contribution weight to the same identity-trust signals.
- **Hot serving on Redis.** Waze proves Redis is the right tier for the geo-keyed hot read path
  at 7-figure ops/sec — reinforcing the H3-keyed Redis follower cache in §1–2.

> Waze closes the loop: reputation feeds confidence, confidence feeds which data is shown,
> good data earns reputation/Premium. That virtuous cycle is the moat the brain dump describes —
> and it has a proven reference implementation.

## 7. Ingestion integrity → **Outbox + idempotency** (Stripe / Kafka)

**What the pattern is.** To never lose and never double-process an event: assign each logical
operation a **client-generated idempotency key**, dedupe on it (Redis/state store with TTL) so
retries are safe; and use the **transactional outbox** — write the domain change *and* its event
in one DB transaction, then a relay drains the outbox to the stream with an idempotent producer
and deterministic keys. Consumers are **idempotent**, so a redelivered batch is rejected in
milliseconds by event ID; a **dead-letter queue** catches poison messages.
([Outbox + exactly-once](https://www.javacodegeeks.com/2025/09/understanding-event-driven-architectures-kafka-outbox-pattern-and-exactly-once-guarantees.html),
[Idempotent consumer pattern](https://medium.com/@zdb.dashti/exactly-once-semantics-using-the-idempotent-consumer-pattern-927b2595f231))

**Why SmartCart needs it.** Contributions arrive from phones **on bad in-store networks that
retry** — the exact recipe for duplicates (a receipt uploaded twice must not award karma twice
or double-count a price). And the whole pricing model depends on **replayable, idempotent
ingestion** (re-score history when the confidence model improves) — which only works if events
are exactly-once and ordered per key.
- **Idempotency key per contribution** (client-generated UUID), deduped at the gateway → safe
  retries from flaky networks, no double karma/tokens.
- **Transactional outbox** so `contribution.received` / `price.updated` are never lost even if
  the broker is momentarily down — the event and the row commit together.
- **Idempotent, replayable consumers** keyed by `(product, store, H3 cell)` → re-scoring and
  cache rebuilds are deterministic; **DLQ + manual review** for unparseable receipts/abuse,
  matching the "flag suspicious spikes for manual review" line in the brain dump.

## How this changes the plan (deltas from the first draft)

1. **Pricing read path is explicitly TAO-shaped:** two-tier follower/leader cache + write-through
   projection + read-after-write for the contributor. (was: generic "cache + projection")
2. **Geo is H3, not geohash:** cell ID as shard/cache/watcher key; `kRing` radius queries;
   hierarchical roll-ups for trends/feed. (upgrades `data-model.md`, `scaling-playbook.md`)
3. **Cross-region cache invalidation is wired from day one** via `price.updated` (EVCache/SQS
   pattern), even while single-region — so going multi-region later is a config change.
4. **Anti-scraping is a Cloudflare-style edge bot-score system** with H3 geo-coherence, not a
   rate-limit afterthought — because the data graph is the moat.
5. **The metro is a cell:** isolation + linear, cell-aware, progressively-deployed city rollout
   becomes the core scaling primitive, matching the city-by-city business model.
6. **Resilience is Netflix-explicit:** circuit breakers + fallbacks to last-known/offline data,
   precompute-popular-baskets, and chaos game-days in Phase 2.
7. **The Confidence Engine is Waze-shaped:** reputation-weighted confidence + cross-verification
   against independent signal (receipts, agreement, geofence) + Sybil/fraud defense as a
   first-class input, not a bolt-on.
8. **Ingestion is exactly-once:** idempotency keys + transactional outbox + idempotent replayable
   consumers + DLQ — so flaky-network retries never double-count and re-scoring is deterministic.

None of this adds Phase-0 cost: at 50 users it's one cell, one region, breakers + an H3 column +
a projection. It's the same MVP — but every seam is now the one a hyperscaler proved holds.

---

## Sources

- Meta — [TAO: The power of the graph](https://engineering.fb.com/2013/06/25/core-infra/tao-the-power-of-the-graph/) ·
  [TAO paper (USENIX ATC '13)](https://www.usenix.org/system/files/conference/atc13/atc13-bronson.pdf)
- Uber — [H3: Hexagonal Hierarchical Spatial Index](https://www.uber.com/us/en/blog/h3/) ·
  [h3geo.org](https://h3geo.org/) · [uber/h3 (GitHub)](https://github.com/uber/h3)
- Netflix — [Active-Active for Multi-Regional Resiliency](https://netflixtechblog.com/active-active-for-multi-regional-resiliency-c47719f6685b) ·
  [Caching for a Global Netflix (EVCache)](https://netflixtechblog.com/caching-for-a-global-netflix-7bcc457012f1) ·
  [Mastering Chaos — microservices/Hystrix](https://cloudexpert.network/mastering-chaos-a-netflix-guide-to-microservices/) ·
  [Netflix fault injection](https://coralogix.com/blog/how-netflix-uses-fault-injection-to-truly-understand-their-resilience/)
- Cloudflare — [Security reference architecture](https://developers.cloudflare.com/reference-architecture/architectures/security/) ·
  [Bot management](https://developers.cloudflare.com/reference-architecture/diagrams/bots/bot-management/) ·
  [Architecture center](https://www.cloudflare.com/architecture/)
- Cell-based — [AWS cell-based architecture guidance](https://github.com/aws-solutions-library-samples/guidance-for-cell-based-architecture-on-aws) ·
  [Cell-based architecture overview](https://dzone.com/articles/grokking-cell-based-architecture)
- Waze — [How Waze keeps traffic flowing with Memorystore](https://cloud.google.com/blog/products/databases/how-waze-keeps-traffic-flowing-with-memorystore) ·
  [Sybil attacks on crowdsourced mapping (UChicago)](https://people.cs.uchicago.edu/~ravenben/publications/pdf/waze-ton18.pdf) ·
  [Establishing trust in crowdsourced data](https://arxiv.org/pdf/2511.03016)
- Ingestion integrity — [Outbox pattern & exactly-once with Kafka](https://www.javacodegeeks.com/2025/09/understanding-event-driven-architectures-kafka-outbox-pattern-and-exactly-once-guarantees.html) ·
  [Idempotent consumer pattern](https://medium.com/@zdb.dashti/exactly-once-semantics-using-the-idempotent-consumer-pattern-927b2595f231)
