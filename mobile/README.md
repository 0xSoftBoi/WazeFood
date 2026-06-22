# SmartCart mobile (Expo)

One React Native codebase that runs on **web, iOS, and Android** (Expo + Expo Router +
`react-native-web`), built to an iOS-grade bar. It talks to the SmartCart backend through a **typed
client generated from the OpenAPI spec**.

## Run

```bash
# 1) backend (repo root, separate terminal)
npm start                       # API on http://localhost:3000

# 2) app (this dir)
npm install
npm run web                     # browser
npm run ios                     # iOS simulator (Xcode)
npm run android                 # Android emulator
npm run typecheck               # tsc --noEmit
```

Point at another backend with `EXPO_PUBLIC_API_URL`. Host defaults: web/iOS-sim use `localhost`;
the Android emulator uses `10.0.2.2`.

## What's in it

A full anonymous-first MVP:

- **Home** — large-title search, quick chips, and a live "deals near you" feed.
- **Product** — best nearby price (store, distance, confidence), add-to-list, watch-price.
- **List** — every item priced, a running cart total, and one-tap **trip optimization** (savings).
- **Scan** — `expo-camera` barcode scanner → resolves the product → jumps to its price.
- **You** — karma, rank, badges, and the weekly contributor leaderboard.

## Architecture

- `src/ui/` — the **design system**: theme tokens (light/dark, type scale, spacing, radius,
  elevation) + primitives (`Text`, `Button`, `Card`, `Screen`, `Input`, `Badge`, `PriceTag`,
  `Skeleton`, `EmptyState`). Nothing hardcodes a color.
- `app/` — Expo Router. `_layout.tsx` wires providers; `(tabs)/` is the tab bar; `product/[id].tsx`
  is the detail screen.
- `src/api/schema.ts` — **generated** from `../openapi/openapi.yaml` (`npm run gen:api` at repo root;
  do not edit). `src/api/client.ts` is the typed fetch client.
- `src/session.tsx` — anonymous-first session (token persisted via AsyncStorage), location, and the
  current list handle.

## Next

Social-login upgrade (`/auth/link`), real geolocation (`expo-location`), a map screen, receipt-photo
capture into the ingestion pipeline, and app icon/splash artwork.
