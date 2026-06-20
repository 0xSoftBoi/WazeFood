# SmartCart — Phased Roadmap

Build order mapped to the product's own rollout: **First 50 (friends & family) →
Atozy soft launch → multi-metro growth → moat.** The architectural rule throughout:
**build the seams now, distribute the services later** (see `scaling-playbook.md`).

---

## Phase 0 — Walking skeleton · "prove the aha"
**Audience:** first ~50 friends-and-family users, **1 metro** (Salt Lake City — Jonathan is local, easy validation).
**Goal (from the doc):** can users build a list without friction, do they trust the savings number, do they come back for a 2nd list.

**Architecture:** modular monolith + managed primitives. Postgres + PostGIS + Redis + object storage + a managed queue. One region. No microservices.

**Ship:**
- Anonymous-first onboarding (search/list before signup), then Apple/Google/email on save.
- Catalog + product match (text + barcode); "add a product not in the app."
- Lists & items (qty, basic per-item prefs), store grouping, in-store checklist.
- Pricing **current-price projection** with `confidence` + `as_of` surfaced in UI.
- Crowdsource v1: manual price correction + receipt upload (OCR via managed API) +
  clearance/OOS report, all **location-validated**; karma counter.
- Single-store basic comparison + basic 30-day tracker.
- Offline-first device store for list + last-known prices.

**Explicitly deferred:** payments, referral, multi-store routing, alerts, leaderboards, B2B.

**Learning instrumentation:** event log → warehouse for 2nd-list rate, avg savings,
swap click-through, receipts uploaded, "would be disappointed if it went away."

---

## Phase 1 — Soft launch · "prove value & loops"
**Audience:** Atozy/Erling Instagram audience, expand to the 4 target metros (SLC, DMV, Nashville/Franklin, Seattle).
**Goal:** willingness to pay vs. earn, referral k-factor, which savings feature wins (full-cart vs. alerts).

**Architecture:** still mostly monolith; **Entitlements & Metering** and the **event bus + ML workers** become real. KPI warehouse pipeline stood up.

**Ship:**
- **Entitlements & metering:** Free/Premium, earned Premium, token buckets (image search,
  cart optimization, item compare) — Redis counters + durable ledger.
- **Optimization & Routing:** full-cart optimization, store split, Chill/Balanced/Max modes,
  **explainable savings breakdown** (swaps / store差 / coupons / −gas / confidence).
- **Alerts & Watchlist:** watchlists, price-drop alerts, deal pushes, geofence triggers
  (consume `price.dropped` → watcher fan-out).
- **Referral & Anti-Fraud:** slot state machine, SMS verification (referrer-to-claim,
  referred-to-activate), the exact activation predicate, **minimal** fraud controls.
- **Gamification:** weighted karma, badges, Weekly/Monthly/All-Time leaderboards (Redis ZSETs).
- **In-store mode:** store detect/confirm, list-by-store, fast checklist, contextual
  crowdsource tasks, contributor rewards, post-trip + receipt verification.
- **Confidence Engine v2:** reputation-weighted, agreement-based scoring; replayable.
- **KPIs:** referral funnel, **k-factor**, activation cohorts, **paywall cannibalization
  holdout**, SMS funnel.

---

## Phase 2 — Multi-metro scale · "extract along the seams"
**Trigger-driven, not date-driven.** Extract in load order (see playbook):
1. **Ingestion + Confidence** (ML autoscaling / trust isolation)
2. **Optimization** (CPU saturation / P95 latency)
3. **Alerts** (fan-out volume)
4. **Pricing/Search read path** (read QPS / geo-distributed caching)

**Also:** H3 geo-cell sharding of pricing/contribution data with **the metro as a cell**
(blast-radius isolation, cell-aware progressive deploys, chaos game-days), OpenSearch +
dedicated vector search at scale, multi-region read replicas + edge caches as latency
requires, hardened **anti-scraping** on the read path. Tips/payments, data export
(rate-limited), households at scale.

---

## Phase 3 — Moat & monetization
- Macro grocery price-trend analytics; category inflation; "egg prices likely to rise."
- Separate **B2B data product** (never an accidental consumer export).
- Deeper on-device AI (aisle-walk capture, in-store live swaps), advanced fraud
  (velocity, VoIP), POV-glasses capture surface.

---

## What stays constant across every phase
- **Seams before services** — modules with owned tables + event contracts from Phase 0.
- **Confidence + freshness** travel with every price, end to end, to the UI.
- **Current price is a projection** off replayable contributions.
- **Cost tied to value** via token metering; async/batch/cache the paid 3rd-party calls.
- **Protect the data graph** — anti-scrape on reads, bulk data is B2B-only.
- **Offline-first, low-end Android, data-frugal** client as the first cache layer.
