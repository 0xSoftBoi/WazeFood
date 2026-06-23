# SmartCart — Build Status

Where the project stands. SmartCart went from a product brain dump → a researched, cited
architecture → a **runnable, tested, persistent backend** with an AR/glasses layer and a web demo.

## Run everything

```bash
npm test            # 54 unit tests + 1 integration test (skipped offline); run `npm install` first
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
| **Ingestion moat** | Barcode-first entity resolution, cheap→expensive perception routing (cost-accounted), media-hash dedup, match/extraction confidence factors. **Real VLM extraction** is wired (`ingestion/extractor.ts`: Anthropic Messages API, cheap Haiku tier → escalate to Opus only when low-confidence, gated by `ANTHROPIC_API_KEY`; deterministic stub is the default) — the routing/cost model is unchanged, the reads are now real |
| **AR & glasses** | `/ar/scene` world-anchored overlays (price/aisle cards, deal pins, route line) tailored per tier (phone/web/Meta/Snap), POV-glasses capture into ingestion |
| **Persistence** | Postgres (write-behind + hydrate, JSONB doc store) + Redis cache (mirror + write-behind), restart-durability integration-tested against live servers. **Dedicated relational repositories** graduate the extension-backed concerns off the doc-store: **pgvector** product-vector index (the matcher's ANN backend, wired live), **PostGIS** store radius search (ST_DWithin), **TimescaleDB** price-history — in-memory by default, Postgres-backed in durable mode (`platform/store/repositories.ts` + `pg-repositories.ts`, `db/migrations/0002_relational.sql`), all gated-IT covered |
| **Event log + relay** | Durable outbox records every domain event; a Relay drains it to a pluggable Sink (console/HTTP-webhook/**Kafka**) with at-least-once delivery + retry. The **Kafka producer sink** is built (`OUTBOX_SINK=kafka` + `KAFKA_BROKERS`): one topic, partitioned by aggregate key so per-entity updates stay ordered, `seq`/`event-id` headers for idempotent consumers; `kafkajs` is dynamically imported (zero-dep default) — the bus → Kafka/CDC seam |
| **Anti-scraping** | Domain-specific abuse scoring (multi-dim velocity + H3 geo-coherence + honeytoken canaries) → allow/throttle/challenge/block, phased monitor/enforce, backed by a **durable ledger** (append-only flag audit + persisted per-account repeat-offender tally → a returning attacker is escalated on its first request after a restart/on another node) with `/admin/abuse` forensics — the data-graph moat layer (researched: `docs/research/anti-scraping.md`) |
| **Auth & onboarding** | Anonymous-first sessions, short-lived access JWT + rotating refresh w/ reuse-detection + per-device revocation, and anonymous→identity **upgrade in place** (data preserved). Provider id_tokens are verified for **real** (`platform/auth/oidc.ts`: Apple/Google **RS256/ES256** against live JWKS, kid-rotation refresh, `iss`/`aud`/`exp` validation, alg-confusion rejection) — enabled by setting `GOOGLE_CLIENT_IDS`/`APPLE_CLIENT_IDS` (researched: `docs/research/auth-and-onboarding.md`) |
| **Ops** | `/health`, `/ready`, `/metrics` (events, perception cost, abuse stats), `/admin/outbox` |
| **HTTP edge** | Hardened router: body-size cap → 413, request/header/keep-alive timeouts (slowloris defense), gzip negotiation, graceful connection-draining shutdown (`platform/http/router.ts`) |
| **Delivery** | Dockerfile, CI (backend unit + smoke + live-DB integration job, **plus a mobile job**: typecheck + web build + an OpenAPI-client drift gate), web demo, OpenAPI spec (+ CORS for the web app), SQL migrations. The Postgres bootstrap **degrades gracefully** when pgvector/PostGIS/Timescale aren't installed (falls back to in-memory repositories) |
| **Mobile app** | `mobile/` — one **Expo** (React Native + Expo Router) codebase for **web + iOS + Android**, with an iOS-grade **design system** (`src/ui`: theme tokens light/dark + primitives) and a **typed client generated from the OpenAPI spec** (`npm run gen:api`). Full anonymous-first MVP: **Home** (search + nearby deals), **Nearby** (store map — Apple/Google Maps native, web fallback), **Product** (best price + add-to-list + watch + report), **List** (priced items + cart total + trip optimization), **Scan** (`expo-camera` barcode → price), **Report** (crowdsource a price/receipt), **You** (karma/rank/badges/leaderboard + **referral invite** — share link, progress to 3 friends → 30-day Premium, with a deep-link attribution route), real geolocation + branded icon/splash. App typechecks, web bundle compiles, all flows verified against the running API |
| **Research** | 4 cited memos: price-data sourcing & competition, receipt OCR & matching, real-time/geospatial, market & unit economics |

## Deferred (by design — earn the right via the scaling-playbook triggers) ⏳

- **A real Pub/Sub producer Sink** (the Kafka producer sink is now built; the same `Sink` interface drops in a GCP Pub/Sub / SNS producer when needed — the relay loop is unchanged). A live-broker integration test (gated, like the Postgres IT) and consumer-side schema registry remain.
- **Fully async distributed reads** — counter/leaderboard *writes* are now authoritative & cross-node-correct (server-side `INCRBY`/`ZINCRBY`) and the L1 mirror reconciles via a `refresh()` poll, so reads are eventually-consistent across nodes. A production deployment would replace polling with Redis keyspace-notification invalidation; the sync read interface is preserved by design.
- **Full relational repositories for the remaining KV-shaped tables** per `db/migrations/0001_init.sql` (users/lists/entitlements/etc. still use the JSONB doc store — fine for their access pattern). The three extension-backed concerns (**pgvector** matching index, **PostGIS** geo, **Timescale** history) have now graduated to dedicated relational repositories; wiring the PostGIS/Timescale repos into the catalog/pricing read paths (they currently run their in-module H3/projection logic) is the remaining localized connection.
- **Service extraction** (Ingestion → Optimization → Alerts → Pricing) — only when load triggers fire.
- **Edge bot-management** (Cloudflare/Fastly JA4/WAF/DDoS) + **mobile attestation** (Play Integrity, App Attest, Private Access Tokens) — *buy/adopt at deployment*; the domain-specific scoring layer + durable forensic ledger are already built (`docs/research/anti-scraping.md`).
- **Real OAuth client IDs to switch social sign-in on.** End-to-end is built: real Apple/Google id_token JWKS verification in-house (`platform/auth/oidc.ts`) **and** the app-side UI (feature-flagged Google/Apple buttons on the You tab → `/auth/link` → anonymous-upgrade), dark until `EXPO_PUBLIC_*` client IDs are set. A hosted IdP (Firebase/Stytch) is optional, not required. SMS provider for referral anti-fraud.
- **Mobile app polish for store submission** — the Expo app ships the full MVP loop (home/product/list/scan/profile) with session persistence and a design system; remaining: social-login upgrade (`/auth/link`), real geolocation (`expo-location`) + map screen, receipt-photo capture into ingestion, app icon/splash artwork, and native **AR/glasses clients** (ARKit/ARCore, Meta/Snap SDKs).
- **ML in-house** (self-hosted OCR/VLM/embeddings) — managed APIs first, per the OCR memo's trigger.

## Health snapshot

- 98 unit tests passing, 2 integration tests (gated, passing against live PG+Redis), typecheck clean.
- Minimal dependencies: `h3-js` for geo; `pg`/`redis`/`kafkajs` are dynamically imported only when their driver is enabled. Real OIDC (JWKS), VLM perception (Anthropic), and embeddings (Voyage) call out over `fetch` with no SDK dependency, gated by API keys.
- Everything in this repo is committed to `claude/scalable-architecture-plan-9276yg`.
