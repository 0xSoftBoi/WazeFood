// Identity & Accounts (docs/ARCHITECTURE.md §4.1). Anonymous-first: a device can act before
// signup; auth is attached later when the user saves a list. Owns users + devices.

import { newId } from "../../platform/id.ts";
import type { Table, TableFactory } from "../../platform/store/store.ts";

export type Plan = "free" | "premium";
export type RoutingMode = "chill" | "balanced" | "max";

export type User = {
  id: string;
  createdAt: string;
  authProvider: string | null;
  phoneVerified: boolean;
  homeZip: string | null;
  defaultRoutingMode: RoutingMode;
  metro: string;
};

export type Device = {
  id: string;
  userId: string;
  platform: string;
  firstSeen: string;
};

export class IdentityService {
  private readonly users: Table<User>;
  private readonly devices: Table<Device>;

  constructor(deps: { tables: TableFactory }) {
    this.users = deps.tables<User>("users");
    this.devices = deps.tables<Device>("devices");
  }

  createAnonymousUser(input: { metro?: string; platform?: string; deviceId?: string }): User {
    const now = new Date().toISOString();
    const user = this.users.insert({
      id: newId("usr"),
      createdAt: now,
      authProvider: null,
      phoneVerified: false,
      homeZip: null,
      defaultRoutingMode: "balanced",
      metro: input.metro ?? "unknown",
    });
    this.devices.insert({
      id: input.deviceId ?? newId("dev"),
      userId: user.id,
      platform: input.platform ?? "unknown",
      firstSeen: now,
    });
    return user;
  }

  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  attachAuth(userId: string, provider: string): User | undefined {
    return this.users.update(userId, { authProvider: provider });
  }

  setPhoneVerified(userId: string, verified: boolean): User | undefined {
    return this.users.update(userId, { phoneVerified: verified });
  }

  setLocation(userId: string, zip: string, metro: string): User | undefined {
    return this.users.update(userId, { homeZip: zip, metro });
  }

  setRoutingMode(userId: string, mode: RoutingMode): User | undefined {
    return this.users.update(userId, { defaultRoutingMode: mode });
  }
}
