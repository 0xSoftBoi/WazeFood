# SmartCart

> "Waze for grocery prices" — a consumer-powered grocery price intelligence network
> that helps shoppers stop overpaying, and gets more valuable in every city as more
> people contribute price, deal, and receipt data.

This repository holds the **scalable architecture plan** derived from the product brain dump
**and a runnable modular-monolith backend scaffold that implements it**. It is designed to be
**pragmatic at MVP scale** (first 50 users + Atozy soft launch) while keeping **clean seams to
scale to millions of shoppers across many metros** without a rewrite.

## Run the scaffold

A working backend with **zero runtime dependencies** (Node 22 native TypeScript + in-memory
adapters) — the whole value loop executes today; the module seams swap to managed cloud later.

```bash
npm test          # 18 tests: geo/confidence/entitlements units + e2e value loop + referral
npm run typecheck # tsc --noEmit  (run `npm install` first for the one devDep)
npm start         # BFF on :3000, seeded with the Salt Lake City demo metro
npm run smoke     # programmatic walk through the value loop
```

See [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md) for the code → architecture map.

## Start here

| Doc | What it covers |
|---|---|
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
matching + cheap→expensive perception routing with cost accounting + media-hash dedup) — with 33
passing tests and a clean typecheck. Storage/cache/bus run on
in-memory adapters today and swap to Postgres+PostGIS / Redis / Kafka via the documented seams
(`db/migrations/`, `docker-compose.yml`). Next: persistence adapters, mobile client, and the
service extractions in [`docs/scaling-playbook.md`](docs/scaling-playbook.md).
