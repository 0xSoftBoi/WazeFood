-- Dedicated relational repositories (the targeted graduation off the JSONB doc-store) — backs
-- src/platform/store/pg-repositories.ts. Each table is decoupled from the doc-store: the matcher,
-- geo search, and price-history graduate to engine-native features (pgvector / PostGIS / Timescale)
-- without touching the KV-shaped data that stays in doc_rows.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
-- TimescaleDB is optional: price_points works as a plain table; create_hypertable below upgrades it
-- where the extension is available.
-- CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Product embedding index (pgvector). The column is dimension-agnostic so it works with any
-- embedder (local hashing = 256-d, voyage-3 = 1024-d) using EXACT cosine NN via `<=>`. `sig` is the
-- text identity used to detect staleness.
CREATE TABLE IF NOT EXISTS product_vectors (
  id        TEXT PRIMARY KEY,
  sig       TEXT NOT NULL,
  embedding vector NOT NULL
);
-- At scale, pin the dimension and add an ANN index (ivfflat/hnsw require a fixed dimension), e.g.:
--   ALTER TABLE product_vectors ALTER COLUMN embedding TYPE vector(1024);
--   CREATE INDEX product_vectors_embedding_idx
--     ON product_vectors USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Store geography (PostGIS radius search). geography type → ST_DWithin/ST_Distance in metres.
CREATE TABLE IF NOT EXISTS store_geo (
  id   TEXT PRIMARY KEY,
  geom geography(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS store_geo_geom_idx ON store_geo USING gist (geom);

-- Price history time series (TimescaleDB hypertable). Plain table by default; promote to a
-- hypertable when Timescale is installed.
CREATE TABLE IF NOT EXISTS price_points (
  product_id TEXT NOT NULL,
  store_id   TEXT NOT NULL,
  price      NUMERIC NOT NULL,
  confidence NUMERIC NOT NULL,
  at         TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS price_points_lookup_idx ON price_points (product_id, store_id, at DESC);
-- SELECT create_hypertable('price_points', 'at', if_not_exists => TRUE);  -- when Timescale is present
