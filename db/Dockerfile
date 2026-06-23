# Postgres for WazeFood: PostGIS + pgvector on the standard postgres entrypoint, so the relational
# repositories (store_geo / product_vectors / price_points) all light up. The app self-migrates on
# boot (creates doc_rows and applies db/migrations/0002_relational.sql), so no init scripts are
# needed here. pgvector comes from the PGDG apt repo the postgis image already has configured.
FROM postgis/postgis:16-3.4

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-16-pgvector \
  && rm -rf /var/lib/apt/lists/*
