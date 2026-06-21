// Abuse scoring — the domain-specific anti-scraping layer SmartCart builds itself
// (docs/research/anti-scraping.md §4). The edge (JA4, WAF, DDoS, attestation) is bought; this is
// the part no vendor can do: score read requests on signals unique to our data graph and decide
// allow / throttle / challenge / block. Signals:
//   - multi-dimensional velocity (per device, per account) — sliding per-minute counters
//   - H3 geo-coherence — a real shopper stays near one area; many distinct/scattered cells = scraping
//   - breadth-vs-depth — enumerating many distinct products (vs revisiting a few) = scraping
//   - honeytoken canaries — touching a seeded fake product is an instant high-confidence flag
// Phased rollout: "monitor" scores+logs without blocking; "enforce" acts on the score.

import type { Cache } from "../../platform/cache/cache.ts";
import type { Clock } from "../../platform/clock.ts";
import { cellOf } from "../../platform/geo/h3.ts";

export type Decision = "allow" | "throttle" | "challenge" | "block";
export type Mode = "monitor" | "enforce";

export type ScoreInput = {
  deviceId: string;
  userId: string | null;
  route: string;
  productId?: string | null;
  lat?: number;
  lng?: number;
};

export type ScoreResult = {
  score: number; // 0..100
  decision: Decision; // effective (always "allow" in monitor mode)
  observed: Decision; // what enforce mode would do
  reasons: string[];
};

// Thresholds (tunable; would live in config/feature-flags in production).
const TH = {
  deviceSoftPerMin: 60,
  deviceHardPerMin: 200,
  breadthSoft: 15, // distinct products / min / account
  breadthHard: 40,
  cellsSoft: 4, // distinct H3 cells / min / account
  cellsHard: 10,
  block: 80,
  challenge: 50,
  throttle: 30,
};

function scaled(value: number, soft: number, hard: number, maxPoints: number): number {
  if (value <= soft) return 0;
  if (value >= hard) return maxPoints;
  return Math.round((maxPoints * (value - soft)) / (hard - soft));
}

export class AbuseScoreService {
  private readonly cache: Cache;
  private readonly clock: Clock;
  private readonly h3Resolution: number;
  private readonly canaries = new Set<string>();
  private mode: Mode;
  private readonly deviceSoftPerMin: number;
  private readonly deviceHardPerMin: number;
  private readonly stats = { scored: 0, allow: 0, throttle: 0, challenge: 0, block: 0, canaryHits: 0 };

  constructor(deps: { cache: Cache; clock: Clock; h3Resolution: number; mode?: Mode; deviceSoftPerMin?: number; deviceHardPerMin?: number }) {
    this.cache = deps.cache;
    this.clock = deps.clock;
    this.h3Resolution = deps.h3Resolution;
    this.mode = deps.mode ?? "enforce";
    this.deviceSoftPerMin = deps.deviceSoftPerMin ?? TH.deviceSoftPerMin;
    this.deviceHardPerMin = deps.deviceHardPerMin ?? TH.deviceHardPerMin;
  }

  setMode(mode: Mode): void { this.mode = mode; }

  // Seed a honeytoken: a fake product id only an enumerator would ever touch.
  addCanary(productId: string): void { this.canaries.add(productId); }
  isCanary(productId: string): boolean { return this.canaries.has(productId); }

  private minute(): number { return Math.floor(this.clock.now().getTime() / 60_000); }

  // Track a distinct value in a per-minute window; returns the distinct count.
  private trackDistinct(key: string, value: string): number {
    const arr = this.cache.get<string[]>(key) ?? [];
    if (!arr.includes(value)) arr.push(value);
    this.cache.set(key, arr, 65_000);
    return arr.length;
  }

  score(input: ScoreInput): ScoreResult {
    const m = this.minute();
    const acct = input.userId ?? input.deviceId;
    const reasons: string[] = [];
    let score = 0;

    // Honeytoken — instant, high-confidence flag.
    if (input.productId != null && this.canaries.has(input.productId)) {
      score = 100;
      reasons.push("honeytoken_canary");
      this.stats.canaryHits++;
    }

    // Device velocity (sliding per-minute counter).
    const devCount = this.cache.incr(`abuse:dev:${input.deviceId}:${m}`, 1, 65_000);
    const devPts = scaled(devCount, this.deviceSoftPerMin, this.deviceHardPerMin, 60);
    if (devPts > 0) { score += devPts; reasons.push(`device_velocity:${devCount}`); }

    // Breadth: distinct products enumerated per account.
    if (input.productId != null && !this.canaries.has(input.productId)) {
      const breadth = this.trackDistinct(`abuse:prod:${acct}:${m}`, input.productId);
      const pts = scaled(breadth, TH.breadthSoft, TH.breadthHard, 40);
      if (pts > 0) { score += pts; reasons.push(`product_breadth:${breadth}`); }
    }

    // Geo-coherence: distinct H3 cells per account (impossible-travel / scattered enumeration).
    if (input.lat !== undefined && input.lng !== undefined) {
      const cell = cellOf({ lat: input.lat, lng: input.lng }, this.h3Resolution);
      const cells = this.trackDistinct(`abuse:cell:${acct}:${m}`, cell);
      const pts = scaled(cells, TH.cellsSoft, TH.cellsHard, 50);
      if (pts > 0) { score += pts; reasons.push(`geo_incoherence:${cells}`); }
    }

    score = Math.max(0, Math.min(100, score));
    const observed: Decision =
      score >= TH.block ? "block" : score >= TH.challenge ? "challenge" : score >= TH.throttle ? "throttle" : "allow";
    const decision: Decision = this.mode === "monitor" ? "allow" : observed;

    this.stats.scored++;
    this.stats[decision]++;
    return { score, decision, observed, reasons };
  }

  metrics(): { mode: Mode; canaries: number } & typeof this.stats {
    return { mode: this.mode, canaries: this.canaries.size, ...this.stats };
  }
}
