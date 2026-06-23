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
- **Nearby** — a map of stores around you (Apple Maps on iOS, Google Maps on Android) with a store list; web shows the list with a map placeholder.
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

Set the production API URL in `eas.json` (`EXPO_PUBLIC_API_URL`). Icon/splash artwork is generated
(`assets/`, regenerate with `node scripts/gen-icons.mjs` + sharp).

**Maps:** iOS uses Apple Maps (no key). For the Android map, add a Google Maps key to `app.json`:

```json
"android": { "config": { "googleMaps": { "apiKey": "YOUR_ANDROID_MAPS_KEY" } } }
```

**Social sign-in (feature-flagged):** the "Continue with Google / Apple" buttons on the **You** tab
are hidden until you supply OAuth client IDs — the app ships dark with nothing broken. Enable by
setting the relevant `EXPO_PUBLIC_*` env vars (e.g. in `eas.json` per profile, or a local `.env`):

```bash
EXPO_PUBLIC_GOOGLE_CLIENT_ID=...apps.googleusercontent.com          # web
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=...apps.googleusercontent.com      # iOS
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=...apps.googleusercontent.com  # Android
EXPO_PUBLIC_APPLE_SIGNIN=1                                          # show Apple button (iOS)
```

Sign-in obtains a provider **id_token** and calls `POST /auth/link`, which verifies it against the
provider's **JWKS** and upgrades the anonymous guest in place (same user, data preserved). Set the
matching `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS` on the **backend** so it accepts those audiences.
For native Google on iOS, also add the reversed-client-id URL scheme to `app.json`.

## Next

Social-login upgrade (`/auth/link`), a map screen (`react-native-maps` + a web-maps choice), and
icon/splash artwork.
