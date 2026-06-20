# SmartCart — AR & Smart-Glasses

> The "Waze for the real world" surface: point your phone (or look through glasses) and see
> the cheapest nearby price floating over the shelf, the aisle a product is in, the clearance a
> neighbor just reported, and a route line to the store that saves you the most — like the
> reference mock (a world-anchored info card + a green route line over the street).

This is a **presentation surface over the existing backend**, not a new system. The AR/glasses
clients are thin renderers; the server assembles a device-tailored **AR scene** from the modules
we already built (pricing, catalog, alerts, optimization), and POV capture feeds the **same
crowdsource ingestion pipeline**. It directly realizes the brain dump's "POV glasses for ads /
capture" and in-store mode ideas.

## Two AR contexts

| Context | What floats in view | Anchoring | Built from |
|---|---|---|---|
| **Outdoor / street** | Store pins, local **deal pins** (a neighbor's clearance report), and a **multi-store route line** to the cheapest plan | Geo-anchored (GPS + VPS) | `catalog.nearbyStores`, `alerts.dealsNear`, `optimization` route |
| **In-store** | **Price cards** over products: price here, the **aisle** it's in, and a **"cheaper at Walmart, save $0.50"** badge / **"buy here"** | World-anchored to shelves | `pricing` projection + `bestNearbyPrice`, `catalog.getAisle` |

Both come from one endpoint, `POST /ar/scene`, which returns world-anchored `anchors`
(`price_card` / `store_pin` / `deal_pin` / `route_waypoint`), an optional `route` polyline, and
`audioCues` — **tailored to the device tier** and kept deliberately small (the response for the
glasses tier above was ~300 bytes; "frugal with mobile data" is a hard requirement).

## Platform support (current, June 2026)

We support a **tiered** set of surfaces so the same scene data renders everywhere, degrading
gracefully from a LiDAR phone down to audio-only glasses.

| Tier (`deviceTier`) | Devices | SDK / runtime | What it renders |
|---|---|---|---|
| `phone_ar` | iPhone / Android | **ARKit** (`ARGeoAnchor`, World Anchors, LiDAR scene reconstruction + people/object **occlusion**, RealityKit) · **ARCore Geospatial** (VPS + WGS84/Terrain/Rooftop anchors) | Full world+geo overlays, route line, occlusion |
| `web_ar` | Any modern phone browser | **WebXR** (the shareable, install-free path — the `specs.com` reference is web AR) | Geo-anchored cards + route, no occlusion |
| `glasses_display` | **Meta Ray-Ban Display**, **Snap Spectacles** | **Meta Wearables Device Access Toolkit** (camera/audio/**display**/EMG Neural Band) · **Snap Spectacles** (Lens Studio v5, World Query, Navigation Kit, SnapML) | A few glanceable **HUD cards** + hands-free capture |
| `glasses_audio` | **Ray-Ban Meta** (no display) | Meta Device Access Toolkit (camera + **open-ear audio** + voice) | **Spoken cues** ("eggs are $0.50 cheaper nearby") + POV capture |

Notes that shaped the design:
- **Meta's** developer path is the **Wearables Device Access Toolkit** (mobile-app integration) +
  a **Web Apps Starter Kit**, exposing **camera (POV), audio, display, and EMG gesture** input —
  currently **early access**. So at launch, Meta glasses are primarily a **capture + audio + HUD-
  card** surface that extends our phone app, not a full SLAM AR canvas. We design for that.
- **Snap Spectacles** is the richest glasses AR canvas today (SLAM World Query, hand gestures,
  SnapML on-device, Navigation Kit, Connected Lenses) — best for a flagship in-store Lens.
- **Phone AR is the workhorse** (largest install base, occlusion, Geospatial VPS for street
  anchoring); **web AR** is the frictionless, shareable demo (no install — ideal for the Atozy
  launch); **glasses** are the wow-factor capture/HUD layer layered on top.

## How it maps to the architecture

`src/modules/arscene/service.ts` (`ARSceneService`) is a **composition-only** module — it owns no
storage and reaches other modules only through narrow ports, exactly like every other context:

```
buildScene(pose, deviceTier, [storeId|items|listId])
  ├─ pricing.bestNearbyPrice / priceAtStore   → price + "cheaper elsewhere"
  ├─ catalog.nearbyStores / getStore / getAisle → store pins + aisle on cards
  ├─ alerts.dealsNear (H3 kRing over the deal feed) → deal pins
  └─ optimization.optimize (token-gated)      → the route line (premium)
        └─ CAPS[deviceTier] caps/strips the payload (HUD budget, audio-only, occlusion flag)
```

The loop the brain dump described closes here:
1. A shopper's **POV glasses capture** a clearance tag → `POST /ar/capture` → **the same
   `ingestion.submit`** (idempotent, geofence-validated, confidence-scored), tagged `via:"glasses"`.
2. Accepted clearance → `deal.reported` → lands in the **deals feed** and fans out to **watchers
   within N miles** (Alerts, H3 `kRing`).
3. Another shopper opens AR nearby → the deal is a **`deal_pin`** in their scene, and karma flows
   to the reporter. Crowdsource → trust → display, all reusing existing seams.

**Aisle data** is crowdsourced the same way: an `aisle` contribution (`kind:"aisle"`, with a
section string) that clears confidence calls `catalog.setAisle`, and in-store price cards then
show "Aisle 4 · Dairy". In-store observations (aisle/shelf/clearance) are now scored as
shelf-grade evidence so they actually accrue.

## Backend API

```
GET  /ar/devices            capability matrix per tier (clients self-configure)
POST /ar/scene              { userId, lat, lng, deviceTier, storeId?, items?|listId?, mode? }
                            → { context, capabilities, anchors[], route?, audioCues[], approxPayloadBytes }
POST /ar/capture            POV-glasses/web capture → ingestion (via="glasses"|"web"), incl. aisle
GET  /deals/near            local deals feed (also the source of AR deal pins)
```

## On-device AI (cost + latency + privacy)

Consistent with the engineering principles and the East cost playbook (`proven-patterns-east.md`):
keep cheap perception **on the device**, escalate to the server only when needed.
- **Barcode + product recognition** on-device (ML Kit / Vision / SnapML) to identify the product a
  card should attach to — no round trip.
- **Aisle-walk capture coaching** on-device (the brain dump's "walk slowly, capture the aisle
  sign") so only useful frames are uploaded — saves bandwidth and server vision cost.
- Server-side heavy vision (receipt/shelf OCR) stays behind the ingestion queue (see the OCR
  research doc).

## Privacy & consent (non-negotiable for glasses)

Always-on cameras are sensitive; the data graph is a promise, not a liability.
- **Capture is explicit and indicated** (hardware capture LED, in-app affordance) — never silent.
- **Geofence-validate** every capture (already enforced) so location-tagged data is trustworthy
  and not spoofable bulk.
- **On-device pre-filtering** + PII stripping before anything leaves the device; receipts retain
  no PII post-parse.
- **Opt-in, purpose-limited**: capture is for price/deal/aisle data the user benefits from, framed
  exactly as the in-store copy in the brain dump.

## Constraints that shaped the tiers

- **Glanceability / FOV** on display glasses → cap to ~3 HUD cards, prioritize "cheaper elsewhere"
  warnings (action needed) over confirmations.
- **Battery / thermals / bandwidth** → tiny payloads (`approxPayloadBytes` is computed and
  minimized; audio tier ships text cues, no geometry).
- **Audio-only glasses** → the scene degrades to spoken cues, so the cheapest-price insight still
  lands with zero display.

## Phased rollout

- **Phase A — Phone AR in-store** (highest ROI): point at a shelf → price card + aisle +
  cheaper-elsewhere. ARKit/ARCore world anchors; no new backend (uses `/ar/scene`).
- **Phase B — Web AR street demo**: WebXR, install-free, geo-anchored pins + route line — the
  shareable Atozy hook (mirrors the `specs.com` reference).
- **Phase C — Glasses capture + audio**: Meta Device Access Toolkit / Spectacles capture → `/ar/
  capture` → ingestion; audio cues for no-display Ray-Ban Meta. Turns power users into a
  walking price-data sensor network.
- **Phase D — Glasses HUD**: Ray-Ban Display / Spectacles Lens rendering the top HUD cards.

---

## Sources

- Meta — [Wearables Device Access Toolkit / Meta Wearables Developer Center](https://developers.meta.com/wearables/)
- Snap — [Spectacles developer overview (Lens Studio, World Query, SnapML, Navigation Kit)](https://developers.snap.com/spectacles/about-spectacles-features/overview)
- Google — [ARCore Geospatial API (VPS, WGS84/Terrain/Rooftop anchors)](https://developers.google.com/ar/develop/geospatial)
- Apple — [ARKit (ARGeoAnchor, World Anchors, scene reconstruction, occlusion, RealityKit)](https://developer.apple.com/augmented-reality/arkit/)
- W3C — [WebXR Device API](https://www.w3.org/TR/webxr/)
