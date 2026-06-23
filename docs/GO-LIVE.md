# WazeFood — Go-Live Checklist

Everything in code is done. What remains is **external accounts + dropping the resulting keys into
the right place**. This sequences those steps from nothing → live in the app stores. Work top to
bottom; each phase is usable on its own.

Legend: 🟢 critical path · 🔵 optional (app degrades gracefully without it) · ⏱ rough time · 💲 cost.

---

## Phase 0 — Decisions (15 min) 🟢

- [ ] **Launch city.** Recommended: **NYC** (densest walkable store competition + highest grocery
      pain — the Uber "tight dense core" playbook applied to groceries); **Seattle** is a strong
      second. Both are seeded with real stores + prices (`SEED_CITY`, Phase 2). Pick by where your
      first users cluster (e.g. an influencer/referral audience).
- [ ] **Domain** (optional but recommended), e.g. `wazefood.com` → API at `api.wazefood.com`,
      web at `app.wazefood.com`. 💲 ~$12/yr.

## Phase 1 — Backend live 🟢 ⏱ 30–60 min

Goal: a public HTTPS API URL. Two paths (see [`DEPLOY.md`](DEPLOY.md) for detail):

- [ ] **Pick a host.** Fastest = **Render** (the repo's `render.yaml` provisions API + Postgres +
      Redis in one click). Or any VM with `docker compose -f docker-compose.prod.yml up -d --build`.
      💲 ~$0–20/mo to start.
- [ ] **Set required env** on the host:
  - `AUTH_SECRET` = `openssl rand -base64 48`  *(never the dev default)*
  - `CORS_ORIGIN` = your app's web origin (e.g. `https://app.wazefood.com`), not `*`
  - `DATABASE_URL`, `REDIS_URL`, `STORE_DRIVER=postgres`, `CACHE_DRIVER=redis`
      *(Render/compose wire the DB + Redis ones for you)*
- [ ] **Enable Postgres extensions** `vector` + `postgis` (managed hosts: one click; the bundled
      `db/Dockerfile` already has them). Without them the app still runs (in-memory fallback).
- [ ] **Verify:** `curl https://api.…/health` → `{"status":"ok"}`, and `/ready` → 200.
- [ ] **TLS** in front (Render/Fly do this automatically; on a bare VM use Caddy/nginx).
- [ ] **Backups** on the managed Postgres (enable point-in-time / daily snapshots).

## Phase 2 — Point the app + seed data 🟢 ⏱ 30 min

- [ ] Set **`EXPO_PUBLIC_API_URL`** to your API URL in [`mobile/eas.json`](../mobile/eas.json)
      (per build profile).
- [ ] **Seed the launch metro.** Built in: set `SEED_CITY=nyc` (default) or `sea` — the app seeds
      that metro's real stores + an initial price set on first boot (`src/seed-cities.ts`). Add more
      cities there, or grow the data via the `/contributions` API. (NYC is the recommended launch:
      densest walkable store competition + highest grocery-price pain.)
- [ ] Smoke-test against prod: `cd mobile && EXPO_PUBLIC_API_URL=https://api.… npm run web`.

## Phase 3 — Optional integrations 🔵 (each independent)

**Google sign-in + Maps** — Google Cloud project (💲 free):
- [ ] OAuth consent screen + **OAuth client IDs** (Web, iOS, Android).
- [ ] **Maps SDK for Android** API key.
- [ ] App: set `EXPO_PUBLIC_GOOGLE_CLIENT_ID` / `_IOS_CLIENT_ID` / `_ANDROID_CLIENT_ID` (in
      `eas.json`); add the **Android Maps key** + the iOS reversed-client-id URL scheme to
      `mobile/app.json`.
- [ ] Backend: set `GOOGLE_CLIENT_IDS` to those client IDs (so it accepts the audiences).

**Apple sign-in** — Apple Developer account (💲 $99/yr, also needed for iOS builds):
- [ ] App ID with "Sign in with Apple" + a Service ID.
- [ ] App: set `EXPO_PUBLIC_APPLE_SIGNIN=1`. Backend: set `APPLE_CLIENT_IDS`.

**Real AI services** — 🔵 usage-priced, optional:
- [ ] `ANTHROPIC_API_KEY` → real receipt OCR/VLM (else deterministic stub).
- [ ] `VOYAGE_API_KEY` → real matching embeddings (else local hashing embedder).

> The Google/Apple buttons stay hidden until their client IDs are set — nothing breaks while these
> are unconfigured.

## Phase 4 — Ship to the stores 🟢 ⏱ a few hrs + review wait

- [ ] **Apple Developer Program** (💲 $99/yr) and **Google Play Console** (💲 $25 once).
- [ ] App **icon/splash** are already generated — confirm you're happy with `mobile/assets/`.
- [ ] Build: `cd mobile && eas build --profile production --platform all`.
- [ ] Store listings: screenshots, description, privacy policy URL, data-safety form
      (the app collects location + crowdsourced prices; anonymous-first).
- [ ] Submit: `eas submit --profile production --platform ios` (and `android`).
- [ ] **TestFlight / internal testing** first, then submit for review.

## Phase 5 — Pre-launch hardening ✅

- [ ] `AUTH_SECRET` is strong and unique; `CORS_ORIGIN` is a concrete origin.
- [ ] Rate limits sane (`RATELIMIT_PER_MIN`), body cap set (`MAX_BODY_BYTES`).
- [ ] Abuse scoring in **enforce** mode; watch `/admin/abuse` after launch.
- [ ] Monitoring/alerts on `/health`, `/ready`, `/metrics`; log aggregation on.
- [ ] DB backups verified; a restore tested once.
- [ ] (When extracting services later) flip the outbox to Kafka via `OUTBOX_SINK=kafka`.

---

### Fastest path to "real users using it"
**Phase 1 (Render blueprint) → Phase 2 (set `EXPO_PUBLIC_API_URL` + seed your city) → Phase 4
(EAS build + TestFlight).** Social login, maps, and the AI tier can all be switched on after launch
with zero code changes — just keys.

I can do any of the code-side steps for you (seeder for your city, EAS submit workflow, a Caddy TLS
config, adding the Google URL scheme). The account creation and keys are the parts only you can do.
