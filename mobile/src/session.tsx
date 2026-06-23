// App session. On launch we restore (or start) an anonymous-first guest session and hold its access
// token; tokens persist via AsyncStorage so a reload keeps the same guest (and their list/karma).
// Also resolves the user's real location (expo-location, falling back to the demo metro) and owns
// the "current list" handle. "Nearby" queries across the app read location from here.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { ApiClient, type Tokens } from "./api/client";
import { API_BASE_URL, DEMO_LOCATION } from "./config";

const KEYS = { device: "sc.deviceId", refresh: "sc.refreshToken", list: "sc.listId" };

async function getOrCreateDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(KEYS.device);
  if (existing != null) return existing;
  const id = `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  await AsyncStorage.setItem(KEYS.device, id);
  return id;
}

export type LocationSource = "demo" | "device";
export type AppLocation = { lat: number; lng: number; metro: string; source: LocationSource };

type SessionState = { userId: string | null; ready: boolean; error: string | null };

type SessionValue = {
  api: ApiClient;
  userId: string | null;
  location: AppLocation;
  ready: boolean;
  error: string | null;
  ensureList: () => Promise<string>;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({ userId: null, ready: false, error: null });
  const [location, setLocation] = useState<AppLocation>({ ...DEMO_LOCATION, metro: "slc", source: "demo" });
  const tokenRef = useRef<string | null>(null);
  const deviceIdRef = useRef<string>("pending");
  const listIdRef = useRef<string | null>(null);

  const api = useMemo(
    () => new ApiClient({ baseUrl: API_BASE_URL, deviceId: deviceIdRef.current, getToken: () => tokenRef.current }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        deviceIdRef.current = await getOrCreateDeviceId();
        const tokens: Tokens = await api.startAnonymousSession("slc");
        if (cancelled) return;
        tokenRef.current = tokens.accessToken;
        await AsyncStorage.setItem(KEYS.refresh, tokens.refreshToken);
        listIdRef.current = await AsyncStorage.getItem(KEYS.list);
        setState({ userId: tokens.userId, ready: true, error: null });
      } catch (e) {
        if (!cancelled) setState({ userId: null, ready: true, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  // Resolve the real device location in the background; keep the demo metro if denied/unavailable.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        setLocation((prev) => ({ ...prev, lat: pos.coords.latitude, lng: pos.coords.longitude, source: "device" }));
      } catch {
        /* keep the demo location */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const ensureList = useCallback(async (): Promise<string> => {
    if (listIdRef.current != null) return listIdRef.current;
    if (state.userId == null) throw new Error("not ready");
    const list = await api.createList(state.userId, "My list");
    listIdRef.current = list.id;
    await AsyncStorage.setItem(KEYS.list, list.id);
    return list.id;
  }, [api, state.userId]);

  const value = useMemo<SessionValue>(
    () => ({ api, userId: state.userId, location, ready: state.ready, error: state.error, ensureList }),
    [api, state, location, ensureList],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (ctx === null) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
