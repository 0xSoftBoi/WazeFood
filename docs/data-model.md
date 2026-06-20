# SmartCart — Core Data Model

Illustrative schemas for the load-bearing tables/stores. Types are indicative
(Postgres-flavored). The point is the **shape and access pattern**, not the DDL.

## Principle: current price is a projection

Raw contributions are append-only and immutable. `current_price` is derived by the
Confidence Engine from contributions and is what the read path serves. Replaying
contributions can fully rebuild it when the scoring model changes.

```
contributions (immutable, append-only)  ──confidence engine──►  current_price (projection)
        │                                                              │
        └──────────────► price_history (time-series) ◄─────────────────┘
```

---

## OLTP (PostgreSQL + PostGIS + pgvector)

```sql
-- Identity ---------------------------------------------------------------
users(id, created_at, auth_provider, email_hash, phone_e164_hash,
      phone_verified bool, home_zip, default_routing_mode,    -- chill|balanced|max
      plan,                                                   -- free|premium
      premium_until timestamptz, karma int, reputation numeric);

devices(id, user_id, platform, push_token, attestation_state, first_seen, last_seen);

-- Catalog ----------------------------------------------------------------
products(id, canonical_name, brand, size_value, size_unit, category,
         is_store_brand bool, embedding vector(768));         -- pgvector for image/text match
product_upcs(upc PRIMARY KEY, product_id);
product_swaps(product_id, swap_product_id, kind,              -- exact|store_brand|size|unit
              avg_savings numeric, support_count int);        -- "others swap X for Y"

-- Stores (PostGIS) -------------------------------------------------------
stores(id, retailer_id, name, geom geography(Point),          -- GiST index for radius/geofence
       address, metro_id, geohash);                           -- geohash = shard/cache key

-- Pricing projection -----------------------------------------------------
current_price(product_id, store_id,
              price numeric, unit_price numeric,
              confidence numeric,                             -- 0..1, surfaced in UI
              as_of timestamptz, source,                      -- receipt|shelf|manual|crawl
              PRIMARY KEY(product_id, store_id));
-- index: (product_id, metro_id) and a Redis hot-cache keyed by geo cell

-- Crowdsourced contributions (immutable) --------------------------------
contributions(id, user_id, device_id, store_id, type,        -- price|receipt|shelf|clearance|oos|aisle|coupon
              product_id NULL, reported_price numeric NULL,
              media_uri NULL,                                 -- object store
              location geography(Point), geofence_valid bool, -- "was the user at the store?"
              raw_payload jsonb, created_at,
              confidence numeric NULL, status);               -- pending|scored|rejected|duplicate

-- Lists & households -----------------------------------------------------
lists(id, owner_id, household_id NULL, name, routing_mode, created_at, updated_at);
list_items(id, list_id, product_id, qty,
           prefs jsonb,                                       -- brand_required, store_brand_ok, organic, no_sub, alert_me
           assigned_to NULL, bought_by NULL, bought_at NULL,
           crdt_version, updated_at);                         -- offline/multi-user merge
households(id, name, created_by); household_members(household_id, user_id, role);

-- Entitlements & metering -----------------------------------------------
entitlements(user_id, feature, plan_source,                  -- subscription|referral|contributor|tip
             granted_at, expires_at);
token_ledger(id, user_id, bucket,                            -- image_search|cart_optimize|item_compare
             delta int, reason, created_at);                 -- durable audit; Redis holds live counters

-- Referral ---------------------------------------------------------------
referrals(id, referrer_id, slot int, referred_user_id NULL,
          status,                                             -- empty|invited|joined|activated|ineligible
          token, ineligible_reason NULL, activated_at NULL);
```

## Time-series (Timescale / managed)

```sql
price_history(product_id, store_id, ts, price, unit_price, source, confidence);
-- hypertable partitioned by ts; continuous aggregates for 30-day tracker,
-- store/category/macro trends; retention + rollup policies for cost.
```

## Redis (hot, ephemeral)

```
price:{geohash}:{product_id}        -> {price, confidence, as_of, store}   # hot read cache, short TTL
meter:{user_id}:{bucket}:{period}   -> counter (TTL to period end)          # freemium tokens
lb:weekly:{metro}                   -> ZSET(user_id -> karma)               # leaderboards
lb:monthly:{metro} / lb:alltime:{metro}
watchers:{product_id}:{geohash}     -> SET(user_id)                         # alert fan-out index
ratelimit:{device_id}:{route}       -> sliding-window counter               # anti-scrape
```

## OpenSearch

- `products` index: ranked search "by usefulness not exact match," typo tolerance,
  brand/size/category facets, geo filter to nearby availability.
- `deals` index: local daily deals / clearance feed, filterable & personalizable.

## Object storage (S3/GCS)

- `receipts/`, `shelf-photos/`, `aisle-videos/` — write-once, CDN-fronted via signed URLs,
  lifecycle to cold storage, PII stripped from receipts after parse.

## Warehouse (BigQuery/Snowflake)

Event-sourced from the bus. Powers the brain dump's KPI lists: referral funnel,
**k-factor**, activation quality cohorts, paywall **cannibalization holdout**, SMS funnel,
early success metrics (2nd-list rate, avg savings, receipts uploaded, referrals/user).

## Core domain events (the integration contract)

```
contribution.received     {contribution_id, user_id, store_id, type, geofence_valid}
contribution.scored       {contribution_id, confidence, accepted}
price.updated             {product_id, store_id, price, confidence, as_of, source}
price.dropped             {product_id, store_id, old, new, geohash}      → Alerts
deal.reported             {store_id, product_id?, kind, geohash}         → Alerts/feed
product.created           {product_id, source:"user"}                    → Catalog/Search index
referral.activated        {referrer_id, referred_user_id}                → Entitlements
reward.granted            {user_id, feature, source, expires_at}
karma.awarded             {user_id, delta, reason, metro}                → Gamification
trip.completed            {user_id, store_id, spent, est_savings}        → analytics
```

Events are versioned and replayable; consumers are idempotent. When a module is
extracted to its own service, these events become a topic contract unchanged.
