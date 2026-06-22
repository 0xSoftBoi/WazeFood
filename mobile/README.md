# SmartCart mobile (Expo)

One React Native codebase that runs on **web, iOS, and Android** (Expo + Expo Router +
`react-native-web`). This is the first **vertical slice**: anonymous session → product search →
best nearby price, talking to the SmartCart backend through a typed client generated from the
OpenAPI spec.

## Run

```bash
# 1) start the backend (from the repo root, in another terminal)
npm start                       # API on http://localhost:3000

# 2) install + run the app (from this mobile/ dir)
npm install
npm run web                     # opens in the browser
npm run ios                     # iOS simulator (Xcode)
npm run android                 # Android emulator
npm run typecheck               # tsc --noEmit
```

Point the app at a different backend with `EXPO_PUBLIC_API_URL` (e.g. your LAN IP for a physical
device). Host defaults: web/iOS-sim use `localhost`; the Android emulator uses `10.0.2.2`.

## Layout

- `app/` — Expo Router screens (`_layout.tsx`, `index.tsx` = the slice).
- `src/api/schema.ts` — **generated** from `../openapi/openapi.yaml` (run `npm run gen:api` at the
  repo root to regenerate); do not edit by hand.
- `src/api/client.ts` — thin typed fetch client over the generated types (x-device-id + bearer).
- `src/session.tsx` — anonymous-first session provider; holds the access token.
- `src/config.ts` — API base URL + demo location.

## Next

Persist the session (AsyncStorage / SecureStore), add the list / scan (expo-camera) / map screens,
and the social sign-in upgrade (`/auth/link`).
