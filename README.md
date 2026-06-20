# SmartCart

> "Waze for grocery prices" — a consumer-powered grocery price intelligence network
> that helps shoppers stop overpaying, and gets more valuable in every city as more
> people contribute price, deal, and receipt data.

This repository currently holds the **scalable architecture plan** derived from the
product brain dump. It is designed to be **pragmatic at MVP scale** (first 50 users +
Atozy soft launch) while keeping **clean seams to scale to millions of shoppers across
many metros** without a rewrite.

## Start here

| Doc | What it covers |
|---|---|
| [`docs/proven-patterns.md`](docs/proven-patterns.md) | **How Netflix, Meta, Cloudflare, Uber, Waze & AWS solve SmartCart's exact problems** — each pattern mapped onto a workload, with citations. Start here for the "why." |
| [`docs/proven-patterns-east.md`](docs/proven-patterns-east.md) | **How 阿里 / 美团 / 字节 / 微信 / DeepSeek do the same at lower cost** — co-location, elastic peak, layered OR optimizer, sharding, overload protection, AI-cost & truth-discovery. The cost-efficiency playbook, from Mandarin sources. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The full plan: workloads, principles, bounded contexts, data layer, mobile/offline, geo scaling, anti-scraping, security, tech stack, roadmap |
| [`docs/diagrams/system-context.md`](docs/diagrams/system-context.md) | C4 system + container diagrams and key request flows (Mermaid) |
| [`docs/data-model.md`](docs/data-model.md) | Core schemas, Redis/OpenSearch/warehouse usage, domain event contract |
| [`docs/scaling-playbook.md`](docs/scaling-playbook.md) | Per-component bottlenecks, in-place scaling, and extraction triggers |
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

Architecture/planning stage — no application code yet. The docs above are the deliverable.
