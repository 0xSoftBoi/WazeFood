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
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The full plan: workloads, principles, bounded contexts, data layer, mobile/offline, geo scaling, anti-scraping, security, tech stack, roadmap |
| [`docs/diagrams/system-context.md`](docs/diagrams/system-context.md) | C4 system + container diagrams and key request flows (Mermaid) |
| [`docs/data-model.md`](docs/data-model.md) | Core schemas, Redis/OpenSearch/warehouse usage, domain event contract |
| [`docs/scaling-playbook.md`](docs/scaling-playbook.md) | Per-component bottlenecks, in-place scaling, and extraction triggers |
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
