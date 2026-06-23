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

## Native store builds (EAS)

`eas.json` defines `development` / `preview` / `production` profiles. First time:

```bash
npm i -g eas-cli
eas login
eas init                 # links the project (writes extra.eas.projectId into app.json)
eas build --profile production --platform ios       # or android / all
eas submit --profile production --platform ios       # upload to App Store / Play
```

Set the production API URL in `eas.json` (`EXPO_PUBLIC_API_URL`). App icon/splash artwork
(`assets/icon.png`, `assets/splash.png`) is the one remaining asset to add before submission.

## Next

Social-login upgrade (`/auth/link`), a map screen (`react-native-maps` + a web-maps choice), and
icon/splash artwork.
