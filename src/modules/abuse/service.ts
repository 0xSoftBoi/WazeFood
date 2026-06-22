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
import { memoryTableFactory, type Table, type TableFactory } from "../../platform/store/store.ts";
import { newId } from "../../platform/id.ts";

export type Decision = "allow" | "throttle" | "challenge" | "block";
export type Mode = "monitor" | "enforce";

// Durable forensic record of a flagged request — survives restart for post-attack auditing.
export type AbuseEvent = {
  id: string;
  at: string;
  acct: string;
  deviceId: string;
  userId: string | null;
  route: string;
  productId: string | null;
  cell: string | null;
  score: number;
  decision: Decision; // what enforce mode would do (recorded even in monitor)
  reasons: string[];
};

// Per-account repeat-offender tally — the fast (O(1)) durable signal read on every score().
export type Offender = { id: string; acct: string; flags: number; lastFlagAt: string; lastDecision: Decision };

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
  // Durable layer: an append-only audit ledger + a per-account offender tally. In-memory by default,
  // persisted (and cross-node) when the durable TableFactory is wired in.
  private readonly ledger: Table<AbuseEvent>;
  private readonly offenders: Table<Offender>;

  constructor(deps: { cache: Cache; clock: Clock; h3Resolution: number; tables?: TableFactory; mode?: Mode; deviceSoftPerMin?: number; deviceHardPerMin?: number }) {
    this.cache = deps.cache;
    this.clock = deps.clock;
    this.h3Resolution = deps.h3Resolution;
    this.mode = deps.mode ?? "enforce";
    this.deviceSoftPerMin = deps.deviceSoftPerMin ?? TH.deviceSoftPerMin;
    this.deviceHardPerMin = deps.deviceHardPerMin ?? TH.deviceHardPerMin;
    const tables = deps.tables ?? memoryTableFactory;
    this.ledger = tables<AbuseEvent>("abuse_ledger");
    this.offenders = tables<Offender>("abuse_offenders");
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
    const cell = input.lat !== undefined && input.lng !== undefined ? cellOf({ lat: input.lat, lng: input.lng }, this.h3Resolution) : null;

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
    if (cell !== null) {
      const cells = this.trackDistinct(`abuse:cell:${acct}:${m}`, cell);
      const pts = scaled(cells, TH.cellsSoft, TH.cellsHard, 50);
      if (pts > 0) { score += pts; reasons.push(`geo_incoherence:${cells}`); }
    }

    // Repeat-offender: durable history of prior flags escalates the score, so a returning attacker
    // is caught on the FIRST request even after a restart or on a different node.
    const offender = this.offenders.get(acct);
    if (offender !== undefined && offender.flags > 0) {
      const pts = Math.min(30, offender.flags * 6);
      score += pts;
      reasons.push(`repeat_offender:${offender.flags}`);
    }

    score = Math.max(0, Math.min(100, score));
    const observed: Decision =
      score >= TH.block ? "block" : score >= TH.challenge ? "challenge" : score >= TH.throttle ? "throttle" : "allow";
    const decision: Decision = this.mode === "monitor" ? "allow" : observed;

    // Durably record anything that would be acted on (even in monitor mode → forensics + tuning).
    if (observed !== "allow") this.recordFlag({ input, acct, cell, score, observed, reasons });

    this.stats.scored++;
    this.stats[decision]++;
    return { score, decision, observed, reasons };
  }

  private recordFlag(args: { input: ScoreInput; acct: string; cell: string | null; score: number; observed: Decision; reasons: string[] }): void {
    const at = this.clock.now().toISOString();
    this.ledger.insert({
      id: newId("abz"),
      at,
      acct: args.acct,
      deviceId: args.input.deviceId,
      userId: args.input.userId,
      route: args.input.route,
      productId: args.input.productId ?? null,
      cell: args.cell,
      score: args.score,
      decision: args.observed,
      reasons: args.reasons,
    });
    const prev = this.offenders.get(args.acct);
    if (prev !== undefined) this.offenders.update(args.acct, { flags: prev.flags + 1, lastFlagAt: at, lastDecision: args.observed });
    else this.offenders.insert({ id: args.acct, acct: args.acct, flags: 1, lastFlagAt: at, lastDecision: args.observed });
  }

  // Forensics: most recent flagged requests (newest first).
  recentFlags(limit = 50): AbuseEvent[] {
    return this.ledger.all().sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
  }

  // Forensics: the worst repeat offenders by flag count.
  topOffenders(limit = 20): Offender[] {
    return this.offenders.all().sort((a, b) => b.flags - a.flags).slice(0, limit);
  }

  metrics(): { mode: Mode; canaries: number; ledgerSize: number; offenders: number } & typeof this.stats {
    return { mode: this.mode, canaries: this.canaries.size, ledgerSize: this.ledger.size(), offenders: this.offenders.size(), ...this.stats };
  }
}
