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
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The full plan: workloads, principles, bounded contexts, data layer, mobile/offline, geo scaling, anti-scraping, security, tech stack, roadmap |
| [`docs/diagrams/system-context.md`](docs/diagrams/system-context.md) | C4 system + container diagrams and key request flows (Mermaid) |
| [`docs/data-model.md`](docs/data-model.md) | Core schemas, Redis/OpenSearch/warehouse usage, domain event contract |
| [`docs/scaling-playbook.md`](docs/scaling-playbook.md) | Per-component bottlenecks, in-place scaling, and extraction triggers |
| [`docs/roadmap.md`](docs/roadmap.md) | Phased build order mapped to the product's MVP rollout |

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
