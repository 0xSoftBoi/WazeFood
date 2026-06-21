// Referral & Anti-Fraud (docs/ARCHITECTURE.md §4.8). Slot state machine
// (empty → invited → joined → activated / ineligible) and the exact activation predicate
// from the PDF. Anti-fraud starts minimal (self-referral + duplicate guards) but is isolated
// so controls can grow without touching the happy path.

import type { EventBus } from "../../platform/events/bus.ts";
import { newId } from "../../platform/id.ts";
import type { Table, TableFactory } from "../../platform/store/store.ts";

export type ReferralStatus = "invited" | "joined" | "activated" | "ineligible";

export type Referral = {
  id: string;
  referrerId: string;
  token: string;
  referredUserId: string | null;
  status: ReferralStatus;
  ineligibleReason: string | null;
  activatedAt: string | null;
};

// Activation signals tracked per referred user (the PDF's activation requirements).
export type Signals = {
  id: string; // referred userId
  openedFromReferral: boolean;
  referrerId: string | null;
  productsAdded: number;
  searches: number;
};

const REQUIRED_ACTIVATIONS = 3;
const REWARD_DAYS = 30;

export type IdentityPort = { getUser: (id: string) => { phoneVerified: boolean; homeZip: string | null } | undefined };
export type RewardPort = { grantPremiumDays: (userId: string, days: number, source: string) => void };

export class ReferralService {
  private readonly referrals: Table<Referral>;
  private readonly signals: Table<Signals>;

  private readonly deps: { bus: EventBus; identity: IdentityPort; rewards: RewardPort; tables: TableFactory };
  constructor(deps: { bus: EventBus; identity: IdentityPort; rewards: RewardPort; tables: TableFactory }) {
    this.deps = deps;
    this.referrals = deps.tables<Referral>("referrals");
    this.signals = deps.tables<Signals>("referral_signals");
  }

  createInvite(referrerId: string): Referral {
    return this.referrals.insert({
      id: newId("ref"),
      referrerId,
      token: newId("rtok"),
      referredUserId: null,
      status: "invited",
      ineligibleReason: null,
      activatedAt: null,
    });
  }

  // Friend opens the app via the link → Joined.
  recordOpen(token: string, referredUserId: string): Referral | undefined {
    const ref = this.referrals.findOne((r) => r.token === token);
    if (ref === undefined) return undefined;

    // Anti-fraud: self-referral.
    if (ref.referrerId === referredUserId) {
      return this.referrals.update(ref.id, { status: "ineligible", ineligibleReason: "self_referral" });
    }
    // Anti-fraud: this person already counted for another slot.
    const dup = this.referrals.findOne(
      (r) => r.referredUserId === referredUserId && (r.status === "joined" || r.status === "activated"),
    );
    if (dup !== undefined) {
      return this.referrals.update(ref.id, { status: "ineligible", ineligibleReason: "duplicate_user" });
    }

    this.signals.upsert({
      id: referredUserId,
      openedFromReferral: true,
      referrerId: ref.referrerId,
      productsAdded: this.signals.get(referredUserId)?.productsAdded ?? 0,
      searches: this.signals.get(referredUserId)?.searches ?? 0,
    });
    return this.referrals.update(ref.id, { referredUserId, status: "joined" });
  }

  recordActivity(referredUserId: string, delta: { productsAdded?: number; searches?: number }): void {
    const s = this.signals.get(referredUserId);
    if (s === undefined) return; // not a referred user
    this.signals.update(referredUserId, {
      productsAdded: s.productsAdded + (delta.productsAdded ?? 0),
      searches: s.searches + (delta.searches ?? 0),
    });
  }

  // The PDF's predicate, verbatim in spirit.
  private meetsActivation(referredUserId: string): boolean {
    const s = this.signals.get(referredUserId);
    const u = this.deps.identity.getUser(referredUserId);
    if (s === undefined || u === undefined) return false;
    return (
      s.openedFromReferral &&
      u.phoneVerified &&
      u.homeZip !== null &&
      (s.productsAdded >= 3 || s.searches >= 3)
    );
  }

  // Evaluate a referred user; on activation, check the referrer's reward unlock.
  async evaluate(referredUserId: string): Promise<ReferralStatus> {
    const ref = this.referrals.findOne((r) => r.referredUserId === referredUserId && r.status === "joined");
    if (ref === undefined) return "ineligible";
    if (!this.meetsActivation(referredUserId)) return "joined";

    this.referrals.update(ref.id, { status: "activated", activatedAt: new Date().toISOString() });
    await this.deps.bus.publish({ type: "referral.activated", referrerId: ref.referrerId, referredUserId });

    // Reward unlock: >=3 activated AND referrer phone-verified.
    const activatedCount = this.referrals.find((r) => r.referrerId === ref.referrerId && r.status === "activated").length;
    const referrer = this.deps.identity.getUser(ref.referrerId);
    if (activatedCount >= REQUIRED_ACTIVATIONS && referrer?.phoneVerified === true) {
      this.deps.rewards.grantPremiumDays(ref.referrerId, REWARD_DAYS, "referral");
      await this.deps.bus.publish({
        type: "reward.granted",
        userId: ref.referrerId,
        feature: "premium",
        source: "referral",
        expiresAt: null,
      });
    }
    return "activated";
  }

  progress(referrerId: string): { activated: number; required: number; slots: Referral[] } {
    const slots = this.referrals.find((r) => r.referrerId === referrerId);
    return {
      activated: slots.filter((r) => r.status === "activated").length,
      required: REQUIRED_ACTIVATIONS,
      slots,
    };
  }
}
