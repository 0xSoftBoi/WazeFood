# SmartCart — System & Container Diagrams

C4-style views. Render the Mermaid blocks in any Mermaid-capable viewer
(GitHub renders them natively).

## C1 — System context

```mermaid
flowchart TB
  shopper([Price-Aware Household Shopper])
  hunter([Local Deal Hunter / Contributor])
  b2b([Future B2B data buyer])

  SC[[SmartCart<br/>grocery price intelligence network]]

  shopper -->|builds lists, sees savings,<br/>shops in-store| SC
  hunter -->|reports prices, deals, receipts,<br/>earns karma/Premium| SC
  b2b -.->|licensed bulk data<br/>separate product| SC

  SC -->|SMS codes| SMS[SMS provider]
  SC -->|push| PUSH[APNs / FCM]
  SC -->|routes, distance,<br/>gas prices| MAPS[Maps & gas data]
  SC -->|receipt/shelf OCR,<br/>vision, embeddings| AI[OCR / Vision / ML APIs]
  SC -->|sign-in| IDP[Apple / Google]
  SC -->|store locations,<br/>seed prices| RET[Retailer data / web]
```

## C2 — Containers (Phase 1; modules become services in Phase 2)

```mermaid
flowchart TB
  APP[Mobile app<br/>RN/Flutter · offline-first SQLite]

  CDN[CDN + image transforms]
  GW[API Gateway / BFF<br/>auth · rate-limit · anti-scrape · screen-shaped responses]

  APP --> CDN
  APP --> GW

  subgraph API[SmartCart API · modular monolith]
    USR[Identity]
    CAT[Catalog & Match]
    PRC[Pricing & Geo]
    ING[Ingestion & Confidence]
    OPT[Optimization & Routing]
    ALR[Alerts & Watchlist]
    SRCH[Search]
    ENT[Entitlements & Metering]
    REF[Referral & Anti-Fraud]
    GAM[Gamification]
    LST[Lists & Households]
  end

  GW --> API

  Q[(Job queue)]
  BUS[(Event stream)]
  ML[ML workers<br/>OCR · vision · fraud · embeddings]

  ING --> Q --> ML --> BUS
  PRC --> BUS
  BUS --> ALR & GAM & OPT & DW

  PG[(Postgres + PostGIS + pgvector + Timescale)]
  RD[(Redis)]
  OS[(OpenSearch)]
  OBJ[(Object store)]
  DW[(Warehouse)]

  USR & CAT & LST & REF & ENT --> PG
  PRC --> PG & RD
  ING --> PG & OBJ
  SRCH --> OS
  GAM & ENT --> RD
```

## Key request flows

**Build list → see savings (read-hot path)**
```
App → GW(authz, rate-limit) → Lists(add item)
   → Catalog(resolve product) → Pricing(best nearby price = cached projection, w/ confidence)
   → Entitlements(token check for optimization) → Optimization(cached cart plan + breakdown)
   → screen-shaped response back to App
```

**Contribute a price/receipt (write path, async)**
```
App → GW → Ingestion(capture + geofence location-validate) → Object store(photo)
   → Queue → ML worker(OCR/vision, product match) → Confidence Engine(score)
   → emit price.updated → Pricing projection update + Redis cache bust
   → emit contribution.received → Gamification(karma/leaderboard) + Entitlements(token reward)
   → if crosses threshold: emit price.dropped → Alerts(watcher fan-out → push)
```

**Referral activation**
```
Friend opens referral link → Identity(attribute) → enters ZIP + searches/adds 3
   → SMS verify → Referral evaluates activation predicate
   → on 3 activated + referrer verified: Entitlements grants 1 month Premium
```
