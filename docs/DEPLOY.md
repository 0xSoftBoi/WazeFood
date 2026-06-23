# Deploying WazeFood

The backend is a single stateless Node service (TypeScript run directly on Node 22 — no build step)
that needs **Postgres** and **Redis**. State lives in those two; scale the API horizontally behind a
load balancer. Pick one of the paths below.

---

## Option A — One VM, one command (Docker Compose)

Everything (API + Postgres-with-extensions + Redis) on a single host. Good for a soft launch.

```bash
git clone https://github.com/0xSoftBoi/WazeFood && cd WazeFood
cp .env.production.example .env.production
#   edit .env.production:  AUTH_SECRET (openssl rand -base64 48), POSTGRES_PASSWORD, CORS_ORIGIN
docker compose -f docker-compose.prod.yml up -d --build
curl localhost:3000/health     # {"status":"ok"}   ·   /ready gates on DB+Redis
```

The API listens on `:3000`. **Put TLS in front** (Caddy/nginx/your cloud LB) — e.g. a 10-line Caddy
file reverse-proxying `api.yourdomain.com → :3000` gives automatic HTTPS.

Data persists in the `pgdata` / `redisdata` volumes. `docker compose -f docker-compose.prod.yml pull
&& … up -d` to update.

## Option B — Managed, one click (Render)

`render.yaml` is a Blueprint: in Render, **New → Blueprint → this repo**. It provisions the API (from
the `Dockerfile`), a managed Postgres, and a managed Redis, and wires `DATABASE_URL` / `REDIS_URL` /
a generated `AUTH_SECRET` automatically. Set `CORS_ORIGIN` (and any optional keys) in the dashboard.
The same pattern works on **Fly.io / Railway / Heroku** — point them at the `Dockerfile` and set the
env below.

## Option C — Your own Kubernetes / cloud

Build and push the image (`docker build -t <registry>/wazefood-api .`), run ≥2 replicas, point
`DATABASE_URL` / `REDIS_URL` at managed Postgres + Redis (e.g. RDS + ElastiCache, Cloud SQL +
Memorystore, Supabase + Upstash). Liveness `GET /health`, readiness `GET /ready`.

---

## Configuration

| Env | Required | Notes |
|---|---|---|
| `AUTH_SECRET` | **yes** | Signs access JWTs. `openssl rand -base64 48`. Never the dev default. |
| `DATABASE_URL` | yes (durable) | `postgres://…`. Set `STORE_DRIVER=postgres`. |
| `REDIS_URL` | yes (durable) | `redis://…`. Set `CACHE_DRIVER=redis`. |
| `CORS_ORIGIN` | recommended | The app's web origin (e.g. `https://app.wazefood.com`); avoid `*` in prod. |
| `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS` | optional | Accept these audiences for social sign-in (match the app's `EXPO_PUBLIC_*`). |
| `ANTHROPIC_API_KEY` | optional | Real receipt OCR/VLM. Unset → deterministic stub. |
| `VOYAGE_API_KEY` | optional | Real matching embeddings. Unset → local hashing embedder. |
| `OUTBOX_SINK` / `KAFKA_BROKERS` | optional | Fan the event log to Kafka instead of console. |

Full list: [`.env.production.example`](../.env.production.example).

## Database extensions

The relational repositories use **pgvector** (matching), **PostGIS** (geo), and a Timescale-ready
`price_points` table. The bundled DB image (`db/Dockerfile`) ships pgvector + PostGIS, and the app
**applies its own migration on boot** (`db/migrations/0002_relational.sql`) — no manual migration
step. On a managed Postgres, enable the `vector` and `postgis` extensions; if they're unavailable the
app **degrades gracefully** to in-memory indexes (rebuilt from the durable doc-store on restart), so
it still runs.

## Point the app at it

In [`mobile/eas.json`](../mobile/eas.json), set `EXPO_PUBLIC_API_URL` per build profile to your
deployed URL (e.g. `https://api.wazefood.com`), then `eas build`. For local dev the app defaults to
`http://localhost:3000` (Android emulator: `10.0.2.2`).

## Operations

- **Health**: `/health` (liveness), `/ready` (readiness — checks drivers), `/metrics` (events,
  perception spend, abuse stats), `/admin/outbox`, `/admin/abuse`.
- **Scaling**: the API is stateless — add replicas. Postgres is the system of record; Redis backs
  counters/leaderboards (writes are multi-node-correct via server-side `INCRBY`/`ZINCRBY`).
- **Durability**: proven by the gated integration test — `IT_DURABLE=1 npm run test:it` against a
  live Postgres + Redis (see [`docs/STATUS.md`](STATUS.md)).
