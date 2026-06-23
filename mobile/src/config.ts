import { Platform } from "react-native";

// Where the SmartCart backend lives. Override with EXPO_PUBLIC_API_URL. Note the host differs per
// target: iOS simulator + web reach the host as localhost; the Android emulator uses 10.0.2.2; a
// physical device needs your machine's LAN IP.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000");

// The launch metro's center (NYC — Union Square) — the fallback "current location" for best-price
// lookups when device geolocation is denied/unavailable. Matches the backend's SEED_CITY=nyc seed.
export const DEMO_LOCATION = { lat: 40.7359, lng: -73.9911 };
export const DEMO_METRO = "nyc";

// Social sign-in feature flag. The buttons only appear when the corresponding OAuth client IDs are
// configured via EXPO_PUBLIC_* env vars (inlined at build time) — so the UI ships dark until you
// drop in real credentials, with nothing broken in the meantime.
const googleWeb = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
const googleIos = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const googleAndroid = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

export const social = {
  google: {
    web: googleWeb,
    ios: googleIos,
    android: googleAndroid,
    enabled: Boolean(googleWeb ?? googleIos ?? googleAndroid),
  },
  apple: {
    enabled: process.env.EXPO_PUBLIC_APPLE_SIGNIN === "1",
  },
};

export const socialEnabled = social.google.enabled || social.apple.enabled;
