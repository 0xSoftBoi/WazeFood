import { Platform } from "react-native";

// Where the SmartCart backend lives. Override with EXPO_PUBLIC_API_URL. Note the host differs per
// target: iOS simulator + web reach the host as localhost; the Android emulator uses 10.0.2.2; a
// physical device needs your machine's LAN IP.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000");

// The seeded demo metro (Salt Lake City) — used as the "current location" for best-price lookups
// until we wire real geolocation.
export const DEMO_LOCATION = { lat: 40.7608, lng: -111.891 };
