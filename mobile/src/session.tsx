// Anonymous-first session. On launch we start a guest session (POST /auth/anonymous) and hold the
// access token; every API call goes through the shared ApiClient. Token persistence across reloads
// (AsyncStorage / SecureStore) is the next step — today a reload starts a fresh guest.

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiClient } from "./api/client";
import { API_BASE_URL } from "./config";

// A stable-enough device id for the session (a real build would persist this per install).
const deviceId = `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

type SessionState = { userId: string | null; ready: boolean; error: string | null };

type SessionValue = { api: ApiClient; session: SessionState };

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionState>({ userId: null, ready: false, error: null });
  const tokenRef = useRef<string | null>(null);
  const api = useMemo(
    () => new ApiClient({ baseUrl: API_BASE_URL, deviceId, getToken: () => tokenRef.current }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    api
      .startAnonymousSession("slc")
      .then((tokens) => {
        if (cancelled) return;
        tokenRef.current = tokens.accessToken;
        setSession({ userId: tokens.userId, ready: true, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setSession({ userId: null, ready: true, error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const value = useMemo(() => ({ api, session }), [api, session]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useApi(): SessionValue {
  const ctx = useContext(SessionContext);
  if (ctx === null) throw new Error("useApi must be used within a SessionProvider");
  return ctx;
}
