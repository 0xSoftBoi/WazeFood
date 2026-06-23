<div align="center">

<img src="mobile/assets/icon.png" width="104" alt="WazeFood app icon" />

# WazeFood

### Waze for grocery prices

**Stop overpaying for groceries.** WazeFood is a consumer-powered price-intelligence network:
shoppers crowdsource what things actually cost at stores near them, and everyone gets the cheapest
nearby price for their list — the data graph gets more valuable in every city as more people
contribute. (The codebase ships as the `smartcart` package; WazeFood is the app.)

</div>

## What it is

Grocery prices are opaque and change constantly, and no single data source has them all. WazeFood
turns shoppers into the sensor network: scan a barcode or snap a receipt, and your report joins a
**confidence-scored, crowd-verified** price graph (the same way Waze turns drivers into traffic
sensors). In return, every shopper gets:

- the **best nearby price** for any product, with how far away and how fresh/trusted it is;
- a **shopping list that prices itself** and a one-tap **trip optimizer** that shows the savings;
- **deal alerts** and a **karma/leaderboard** loop that rewards the people who keep the data honest.

It's built to be **pragmatic at MVP scale** (first users + a soft launch) while keeping **clean seams
to scale to millions of shoppers across many metros** without a rewrite.

## The app

One **React Native (Expo) codebase → web, iOS, and Android**, anonymous-first (no signup to start),
with an iOS-grade design system. The core loop:

| Screen | What it does |
|---|---|
| **Home** | Large-title search + a live "deals near you" feed, located to where you actually are. |
| **Product** | The best nearby price (store · distance · confidence) with add-to-list, watch-for-drops, and report-a-price. |
| **List** | Every item priced with a running cart total, and a one-tap **trip optimizer** that shows "Save $X" across stores. |
| **Scan** | Camera barcode scanner → resolves the product → jumps straight to its price. |
| **Report** | Crowdsource a price: pick a nearby store, type the price or snap a receipt/shelf photo, earn karma. |
| **You** | Your karma, weekly rank, badges, and the contributor leaderboard. |

```bash
# run the app (one codebase, all three platforms)
cd mobile && npm install
npm run web        # browser   ·   npm run ios   ·   npm run android
```

The app talks to the backend through a **typed client generated from the OpenAPI spec**
(`npm run gen:api`), and ships an **EAS** build config (`mobile/eas.json`) for real store binaries.
See [`mobile/README.md`](mobile/README.md).

## Run the backend

A modular-monolith backend with **minimal dependencies** (Node 22 native TypeScript + in-memory
adapters by default) — the whole value loop executes today; each module seam swaps to managed cloud
when load triggers fire.

```bash
npm install
npm test          # 99 unit tests + 2 gated integration tests
npm run typecheck # tsc --noEmit
npm start         # API + web demo on :3000  → open http://localhost:3000/
npm run smoke     # programmatic walk through the value loop
npm run test:it   # IT_DURABLE=1 + live Postgres/Redis → proves restart durability
```

The previously-stubbed pieces are now **real implementations behind their seams** (zero-dependency
default; graduate by supplying keys/services): OIDC sign-in (Apple/Google JWKS), VLM receipt
perception, embedding-based product matching (pgvector), PostGIS/Timescale repositories, a hardened
HTTP edge, multi-node-correct Redis, a durable anti-scraping ledger, and a Kafka outbox sink.

See [`docs/STATUS.md`](docs/STATUS.md) for what's done vs deferred and
[`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md) for the code → architecture map.

## Start here

| Doc | What it covers |
|---|---|
| [`docs/STATUS.md`](docs/STATUS.md) | **Build status** — what's done vs deferred, and how to run everything (incl. durable mode) |
| [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md) | **The runnable scaffold** — how to run it and how every file maps to the architecture |
| [`docs/proven-patterns.md`](docs/proven-patterns.md) | **How Netflix, Meta, Cloudflare, Uber, Waze & AWS solve SmartCart's exact problems** — each pattern mapped onto a workload, with citations. Start here for the "why." |
| [`docs/proven-patterns-east.md`](docs/proven-patterns-east.md) | **How 阿里 / 美团 / 字节 / 微信 / DeepSeek do the same at lower cost** — co-location, elastic peak, layered OR optimizer, sharding, overload protection, AI-cost & truth-discovery. The cost-efficiency playbook, from Mandarin sources. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The full plan: workloads, principles, bounded contexts, data layer, mobile/offline, geo scaling, anti-scraping, security, tech stack, roadmap |
| [`docs/diagrams/system-context.md`](docs/diagrams/system-context.md) | C4 system + container diagrams and key request flows (Mermaid) |
| [`docs/data-model.md`](docs/data-model.md) | Core schemas, Redis/OpenSearch/warehouse usage, domain event contract |
| [`docs/scaling-playbook.md`](docs/scaling-playbook.md) | Per-component bottlenecks, in-place scaling, and extraction triggers |
| [`docs/ar-wearables.md`](docs/ar-wearables.md) | **AR + smart-glasses** surface: world-anchored price/aisle cards, deal pins, route line; phone (ARKit/ARCore) · web (WebXR) · Meta & Snap glasses tiers; POV capture into the crowdsource pipeline |
| [`docs/cloud-vs-self-managed.md`](docs/cloud-vs-self-managed.md) | Self-managed (DIY) architecture vs. AWS/Azure/GCP managed cloud — philosophy, service-equivalents map, payment & contracting (on-demand → spot → reserved → enterprise commitments → startup credits → egress/lock-in), the scale gap, and SmartCart's buy-vs-build call |
| [`docs/roadmap.md`](docs/roadmap.md) | Phased build order mapped to the product's MVP rollout |

## Grounded in how hyperscalers actually do it

This isn't an abstract design — every load-bearing decision maps to a pattern a company at
planetary scale proved in public ([full evidence + citations](docs/proven-patterns.md)):

| SmartCart problem | Proven by | Pattern adopted |
|---|---|---|
| "Best nearby price" — read-dominated graph lookups | **Meta TAO** | Read-optimized projection + two-tier follower/leader cache, write-through |
| "Stores / deals / watchers within N miles" | **Uber H3** | Hexagonal geo-cells as shard + cache + `kRing` query key |
| Stay up on bad networks; never cascade failure | **Netflix** | Circuit breakers + fallbacks, active-active, precompute, chaos |
| Protect the data graph; serve fast globally | **Cloudflare** | Edge read path + bot-score anti-scraping + edge rate limiting |
| Trust noisy crowd data without being gamed | **Waze** | Reputation-weighted confidence + cross-verification + Sybil defense |
| Contain failure to one city; scale city-by-city | **AWS / DoorDash** | The **metro = a cell**; linear scale by adding cells |
| Never lose/double-count an untrusted write | **Stripe / Kafka** | Idempotency keys + transactional outbox + idempotent consumers |

…and the **cost-efficiency** layer, from the East ([full doc + Mandarin sources](docs/proven-patterns-east.md)):

| SmartCart problem | Proven by (东) | Cost lever |
|---|---|---|
| Idle servers off-peak, heavy batch ML | **阿里 / 字节** 在离线混部 | Co-locate online + offline on one pool, tidal nightly batch → ~2× utilization |
| Spiky weekend/holiday demand | **阿里** 双11 弹性 + 限流降级 | Rent peak then release; shed low-priority work ("有损服务" > outage) |
| Real-time cart/route optimization | **美团** 运筹优化 | Layered cheap real-time tier over async OR+ML planning |
| OCR/vision/LLM on receipts | **DeepSeek** MoE + MLA + FP8 | Cheap→expensive model routing, quantize, cache/batch → ~1/10 cost |
| Trust conflicting crowd reports | **真值发现** Truth Discovery | Iterative source-reliability ⇄ value-confidence, no manual review |

## Domain & business research

Deep, independently-cited research memos that de-risk the product beyond the architecture:

| Memo | The sharpest finding |
|---|---|
| [`docs/research/price-data-and-competition.md`](docs/research/price-data-and-competition.md) | Nobody runs on one data source; cold-start across 4 metros is the top risk (≈40k SKUs/store, weekly decay) — seed via circulars + polite public scrape + a few paid power-users before crowd takes over. Use the Instacart surveillance-pricing story as the launch narrative. |
| [`docs/research/receipt-ocr-product-matching.md`](docs/research/receipt-ocr-product-matching.md) | **Buy OCR cheap, build matching.** A hosted VLM does OCR+extraction ~25–400× cheaper than Textract/Veryfi; the durable problem is cross-retailer entity resolution. Barcode-first makes ~70% of ingestion cost $0; cheap→expensive routing turns ~$1,000/mo into ~$30/mo. |
| [`docs/research/realtime-geospatial.md`](docs/research/realtime-geospatial.md) | H3 res 8 is the universal cell; the scaffold's per-`product:store` cache key is already correct (cells hold many stores). Treat the broker as at-least-once + outbox/CDC; TimescaleDB for history at MVP, Redpanda later. |
| [`docs/research/market-and-unit-economics.md`](docs/research/market-and-unit-economics.md) | A credible low-single-digit-millions-ARR niche, **not** a venture rocket. Economics only work on near-zero (Atozy/referral) CAC; k-factor ~0.4–0.7; this niche has a graveyard (Basket pulled Feb 2026). Validate 2nd-list ≥50%, savings/list ≥10%, k≥0.4 before metro #2. |
| [`docs/research/anti-scraping.md`](docs/research/anti-scraping.md) | Protecting the data graph (the moat): defense-in-depth (OWASP OAT, JA4 edge, Play Integrity/App Attest/PAT, GCRA limits, behavioral scoring, honeytokens). **Buy the edge + adopt attestation; build the domain layer** (H3 geo-coherence + canaries) — which is implemented. |
| [`docs/research/auth-and-onboarding.md`](docs/research/auth-and-onboarding.md) | Proper auth + smoothest onboarding: anonymous-first, defer signup to "save your list", social one-tap, passkeys (SMS only for referral fraud), rotating-refresh JWTs w/ reuse detection. **Buy the IdP; build the session layer + anonymous→upgrade** — which is implemented. |

## The one-paragraph version

Start as a **modular monolith** with one module per bounded context (catalog, pricing,
ingestion, optimization, alerts, entitlements, referral, gamification, lists, identity),
an **async event backbone** for the expensive/untrusted work, and **polyglot storage**
chosen per access pattern (Postgres+PostGIS+pgvector+Timescale, Redis, OpenSearch, object
storage, warehouse). Current prices are a **replayable projection** off crowdsourced
contributions, carrying **confidence + freshness** to the UI. The mobile client is
**offline-first** and acts as the first cache layer. We **build the seams early and extract
services only when real load triggers fire** — scaling by **metro/geo cell**, which matches
the product's city-by-city network-effect thesis. The grocery **data graph is the moat**,
so anti-scraping lives on the read path and bulk data is a separate B2B product.

## Status

Architecture **plan + runnable backend scaffold**. The modular monolith implements the core
value loop (anonymous onboarding, search, TAO price reads, idempotent crowdsourced ingestion +
confidence scoring, price-drop alerts, gamification, token-gated explainable optimization, and
referral activation), an **AR/smart-glasses scene layer** (price/aisle cards, deal pins, route
line, per device tier + POV-glasses capture), and **barcode-first ingestion** (entity-resolution
matching + cheap→expensive perception routing with cost accounting + media-hash dedup) — with 54
passing tests and a clean typecheck. **Persistence is wired and integration-tested**: the default
is zero-dependency in-memory, and `STORE_DRIVER=postgres` / `CACHE_DRIVER=redis` graduate to real
Postgres + Redis via write-behind + hydrate behind the same module interfaces — restart-durability
proven in `test/persistence.it.test.ts` (`IT_DURABLE=1 npm run test:it`). The **outbox relay** now
drives a real **Kafka producer sink** (`OUTBOX_SINK=kafka` + `KAFKA_BROKERS`; partitioned by
aggregate key, `seq`/`event-id` headers for idempotent consumers) alongside the console/webhook
sinks — `kafkajs` is dynamically imported so the default stays zero-dependency.

The previously-stubbed scaffolds are now **real implementations behind their seams** (zero-dep default;
graduate by supplying keys/services): provider sign-in verifies Apple/Google id_tokens for real
(**OIDC JWKS**, RS256/ES256, rotation + alg-confusion defense); receipt/shelf **perception** runs a real
VLM (Anthropic, cheap→expensive escalation); product **matching** uses real embeddings + cosine vector
search (local hashing default, **Voyage AI** optional) with a **pgvector** durable index; the HTTP edge is
hardened (body cap, timeouts, gzip, graceful drain); the **Redis** cache is multi-node-correct
(authoritative `INCRBY`/`ZINCRBY` + coherence refresh); abuse scoring has a **durable forensic ledger**
+ repeat-offender escalation; and **PostGIS**/**Timescale** repositories back geo/history. Next: the
mobile client, wiring the PostGIS/Timescale repos into catalog/pricing, and the service extractions in
[`docs/scaling-playbook.md`](docs/scaling-playbook.md).
