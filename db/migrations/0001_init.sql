-- SmartCart initial schema (Postgres + PostGIS + pgvector), reflecting docs/data-model.md.
-- This is the production target for the in-memory tables the scaffold runs on today; the
-- module repositories swap to these when STORE_DRIVER=postgres. Sharded by (metro, H3 cell).

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;

-- Identity -------------------------------------------------------------------
CREATE TABLE users (
  id                   TEXT PRIMARY KEY,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  auth_provider        TEXT,
  email_hash           TEXT,
  phone_e164_hash      TEXT,
  phone_verified       BOOLEAN NOT NULL DEFAULT false,
  home_zip             TEXT,
  default_routing_mode TEXT NOT NULL DEFAULT 'balanced',
  plan                 TEXT NOT NULL DEFAULT 'free',
  premium_until        TIMESTAMPTZ,
  karma                INTEGER NOT NULL DEFAULT 0,
  reputation           NUMERIC NOT NULL DEFAULT 0,
  metro                TEXT NOT NULL DEFAULT 'unknown'
);

CREATE TABLE devices (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  platform    TEXT,
  push_token  TEXT,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ
);

-- Catalog --------------------------------------------------------------------
CREATE TABLE products (
  id            TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  brand         TEXT,
  size_value    NUMERIC,
  size_unit     TEXT,
  category      TEXT NOT NULL,
  is_store_brand BOOLEAN NOT NULL DEFAULT false,
  embedding     vector(768)               -- pgvector: image/text product match
);
CREATE TABLE product_upcs (upc TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id));
CREATE TABLE product_swaps (
  product_id      TEXT NOT NULL REFERENCES products(id),
  swap_product_id TEXT NOT NULL REFERENCES products(id),
  kind            TEXT NOT NULL,            -- exact|store_brand|size|unit
  avg_savings     NUMERIC NOT NULL DEFAULT 0,
  support_count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, swap_product_id)
);

CREATE TABLE stores (
  id        TEXT PRIMARY KEY,
  retailer  TEXT NOT NULL,
  name      TEXT NOT NULL,
  geom      geography(Point) NOT NULL,      -- GiST: exact radius/geofence
  address   TEXT,
  metro_id  TEXT NOT NULL,
  h3_r8     BIGINT NOT NULL                 -- Uber H3 cell = shard/cache/query key
);
CREATE INDEX stores_geom_gix ON stores USING GIST (geom);
CREATE INDEX stores_h3_ix ON stores (h3_r8);

-- Pricing projection (TAO-style read model) ----------------------------------
CREATE TABLE current_price (
  product_id  TEXT NOT NULL REFERENCES products(id),
  store_id    TEXT NOT NULL REFERENCES stores(id),
  price       NUMERIC NOT NULL,
  unit_price  NUMERIC,
  confidence  NUMERIC NOT NULL,             -- 0..1, surfaced in the UI
  as_of       TIMESTAMPTZ NOT NULL,
  source      TEXT NOT NULL,                -- receipt|shelf|manual|crawl
  h3_r8       BIGINT NOT NULL,
  PRIMARY KEY (product_id, store_id)
);
CREATE INDEX current_price_h3_ix ON current_price (product_id, h3_r8);

-- Time-series history (hypertable in TimescaleDB) ----------------------------
CREATE TABLE price_history (
  product_id TEXT NOT NULL,
  store_id   TEXT NOT NULL,
  ts         TIMESTAMPTZ NOT NULL,
  price      NUMERIC NOT NULL,
  confidence NUMERIC NOT NULL,
  source     TEXT NOT NULL,
  PRIMARY KEY (product_id, store_id, ts)
);

-- Crowdsourced contributions (immutable, append-only) ------------------------
CREATE TABLE contributions (
  id              TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,     -- exactly-once on flaky networks
  user_id         TEXT NOT NULL REFERENCES users(id),
  device_id       TEXT,
  store_id        TEXT NOT NULL REFERENCES stores(id),
  type            TEXT NOT NULL,            -- price|receipt|shelf|clearance|oos|aisle|coupon
  product_id      TEXT,
  reported_price  NUMERIC,
  match_method    TEXT NOT NULL DEFAULT 'explicit', -- barcode|text|none|explicit (entity resolution)
  match_score     NUMERIC NOT NULL DEFAULT 1,
  media_uri       TEXT,
  media_hash      TEXT,                     -- dedup re-uploaded photos + cache perception results
  location        geography(Point),
  geofence_valid  BOOLEAN NOT NULL DEFAULT false,
  h3_r8           BIGINT NOT NULL,
  raw_payload     JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence      NUMERIC,
  status          TEXT NOT NULL DEFAULT 'pending'  -- pending|scored|rejected|duplicate|disputed
);
CREATE UNIQUE INDEX contributions_media_hash_uix ON contributions (media_hash) WHERE media_hash IS NOT NULL;

-- Transactional outbox (domain row + event committed together) ---------------
CREATE TABLE outbox (
  id           BIGSERIAL PRIMARY KEY,
  aggregate    TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
CREATE INDEX outbox_unpublished_ix ON outbox (id) WHERE published_at IS NULL;

-- Lists & households ---------------------------------------------------------
CREATE TABLE households (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id));
CREATE TABLE household_members (household_id TEXT NOT NULL REFERENCES households(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL, PRIMARY KEY (household_id, user_id));
CREATE TABLE lists (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES users(id),
  household_id TEXT REFERENCES households(id),
  name         TEXT NOT NULL,
  routing_mode TEXT NOT NULL DEFAULT 'balanced',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE list_items (
  id            TEXT PRIMARY KEY,
  list_id       TEXT NOT NULL REFERENCES lists(id),
  product_id    TEXT NOT NULL REFERENCES products(id),
  qty           INTEGER NOT NULL DEFAULT 1,
  prefs         JSONB NOT NULL DEFAULT '{}',
  assigned_to   TEXT,
  bought_by     TEXT,
  bought_at     TIMESTAMPTZ,
  crdt_version  BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Entitlements & metering ----------------------------------------------------
CREATE TABLE entitlements (
  user_id    TEXT NOT NULL REFERENCES users(id),
  feature    TEXT NOT NULL,
  plan_source TEXT NOT NULL,                -- subscription|referral|contributor|tip
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, feature, granted_at)
);
CREATE TABLE token_ledger (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  bucket     TEXT NOT NULL,                 -- image_search|cart_optimize|item_compare
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Referral -------------------------------------------------------------------
CREATE TABLE referrals (
  id                TEXT PRIMARY KEY,
  referrer_id       TEXT NOT NULL REFERENCES users(id),
  slot              INTEGER,
  referred_user_id  TEXT REFERENCES users(id),
  status            TEXT NOT NULL DEFAULT 'invited',  -- invited|joined|activated|ineligible
  token             TEXT NOT NULL UNIQUE,
  ineligible_reason TEXT,
  activated_at      TIMESTAMPTZ
);
