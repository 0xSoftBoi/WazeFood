// Confidence Engine (docs/proven-patterns.md §6 Waze, proven-patterns-east.md §7 Truth
// Discovery). Confidence is reputation-weighted and cross-verified against the existing
// trusted price — not source-weighted alone. A reliable contributor whose report agrees
// with the current projection earns high confidence; a wild outlier from a new account is
// damped. This is the single most important algorithm in the company; it lives behind one
// pure function so it can be iterated and back-tested by replaying contributions.

export type ConfidenceInput = {
  source: "receipt" | "shelf" | "manual" | "crawl";
  geofenceValid: boolean;
  reporterReputation: number; // 0..1 from gamification (karma/badges history)
  reportedPrice: number | null;
  // The current trusted price for this (product, store), if any, for cross-verification.
  priorPrice: number | null;
  priorConfidence: number | null;
  // Kept distinct (the memo): "product matched correctly" vs "price read correctly". Each is a
  // multiplicative clamp in [0,1]; default 1 when not applicable (e.g. human-entered productId).
  matchConfidence?: number;
  extractionConfidence?: number;
};

export type ConfidenceResult = { confidence: number; accepted: boolean };

const SOURCE_WEIGHT: Record<ConfidenceInput["source"], number> = {
  receipt: 0.9, // strongest evidence
  shelf: 0.7,
  manual: 0.45,
  crawl: 0.5,
};

const ACCEPT_THRESHOLD = 0.35;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// Agreement factor in [0.4, 1.15]: rewards reports close to the prior trusted price,
// penalizes large deviations (likely error or abuse). No prior → neutral.
function agreement(reported: number | null, prior: number | null): number {
  if (reported === null || prior === null || prior <= 0) return 1;
  const relDiff = Math.abs(reported - prior) / prior;
  if (relDiff <= 0.05) return 1.15; // corroborates the consensus
  if (relDiff <= 0.2) return 1.0;
  if (relDiff <= 0.5) return 0.7;
  return 0.4; // suspicious outlier
}

export function scoreConfidence(input: ConfidenceInput): ConfidenceResult {
  const base = SOURCE_WEIGHT[input.source];
  const geo = input.geofenceValid ? 1.0 : 0.55; // location validation (Waze cross-verify)
  // Reputation pulls the score toward the contributor's trustworthiness (0.6..1.0 band).
  const rep = 0.6 + 0.4 * clamp01(input.reporterReputation);
  const agree = agreement(input.reportedPrice, input.priorPrice);
  // Product-match and price-extraction quality (1 when not applicable).
  const match = input.matchConfidence === undefined ? 1 : clamp01(input.matchConfidence);
  const extract = input.extractionConfidence === undefined ? 1 : clamp01(input.extractionConfidence);

  const confidence = clamp01(base * geo * rep * agree * match * extract);
  return { confidence, accepted: confidence >= ACCEPT_THRESHOLD };
}
