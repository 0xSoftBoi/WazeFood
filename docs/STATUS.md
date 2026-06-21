# SmartCart — Build Status

Where the project stands. SmartCart went from a product brain dump → a researched, cited
architecture → a **runnable, tested, persistent backend** with an AR/glasses layer and a web demo.

## Run everything

```bash
npm test            # 34 unit tests (in-memory, zero external deps) + 1 integration test (skipped)
npm run typecheck   # tsc --noEmit, clean
npm start           # API + web demo on :3000  (open http://localhost:3000/)
npm run smoke       # programmatic walk of the value loop

# Durable mode (Postgres + Redis), restart-durability proven:
STORE_DRIVER=postgres CACHE_DRIVER=redis \
  DATABASE_URL=postgres://smartcart:smartcart@localhost:5432/smartcart \
  REDIS_URL=redis://localhost:6379 npm start
IT_DURABLE=1 npm run test:it
```

## Done ✅

| Area | What's built |
|---|---|
| **Architecture** | Modular monolith, 12 bounded contexts, ports + domain events, cited pattern docs (West/East/cloud) |
| **Value loop** | Anonymous onboarding → list → TAO price reads → idempotent crowdsource ingestion + confidence scoring → price-drop alerts → karma/leaderboards → token-gated explainable optimization → referral activation |
| **Ingestion moat** | Barcode-first entity resolution, cheap→expensive perception routing (cost-accounted), media-hash dedup, match/extraction confidence factors |
| **AR & glasses** | `/ar/scene` world-anchored overlays (price/aisle cards, deal pins, route line) tailored per tier (phone/web/Meta/Snap), POV-glasses capture into ingestion |
| **Persistence** | Postgres (write-behind + hydrate, JSONB doc store) + Redis cache (mirror + write-behind), restart-durability integration-tested against live servers |
| **Event log + relay** | Durable outbox records every domain event; a Relay drains it to a pluggable Sink (console/HTTP-webhook) with at-least-once delivery + retry — the bus → Kafka/CDC seam |
| **Ops** | `/health`, `/ready`, `/metrics` (event + perception-cost stats), `/admin/outbox` |
| **Delivery** | Dockerfile, CI (unit + smoke + live-DB integration job), web demo, OpenAPI spec, SQL migration |
| **Research** | 4 cited memos: price-data sourcing & competition, receipt OCR & matching, real-time/geospatial, market & unit economics |

## Deferred (by design — earn the right via the scaling-playbook triggers) ⏳

- **A real Kafka/Pub-Sub producer Sink** (the Relay, Sink interface, at-least-once delivery, retry, and an HTTP-webhook sink are built — swap the sink impl; the loop is unchanged).
- **True multi-node Redis** (async distributed reads) — today's cache is single-node durable (mirror + write-behind).
- **Dedicated relational repositories** per `db/migrations/0001_init.sql` (the JSONB doc store backs all tables today); real **H3** (`h3-js`), pgvector embeddings for matching, TimescaleDB for history.
- **Service extraction** (Ingestion → Optimization → Alerts → Pricing) — only when load triggers fire.
- **Auth hardening** (OIDC/JWT vs the demo `Bearer user:<id>`), anti-scrape bot-scoring, SMS provider.
- **Mobile app** (RN/Flutter) and native **AR/glasses clients** (ARKit/ARCore, Meta/Snap SDKs) — the web demo is the reference.
- **ML in-house** (self-hosted OCR/VLM/embeddings) — managed APIs first, per the OCR memo's trigger.

## Health snapshot

- 34 unit tests passing, 1 integration test (gated, passing against live PG+Redis), typecheck clean.
- Zero runtime dependencies on the default path; `pg`/`redis` are dynamically imported only in durable mode.
- Everything in this repo is committed to `claude/scalable-architecture-plan-9276yg`.
