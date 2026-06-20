import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreConfidence } from "./confidence.ts";

test("a receipt at the store that agrees with the prior price is accepted with high confidence", () => {
  const r = scoreConfidence({
    source: "receipt",
    geofenceValid: true,
    reporterReputation: 0.8,
    reportedPrice: 4.5,
    priorPrice: 4.6,
    priorConfidence: 0.8,
  });
  assert.ok(r.accepted);
  assert.ok(r.confidence > 0.7, `expected high confidence, got ${r.confidence}`);
});

test("a manual report from a brand-new account off-site is damped", () => {
  const r = scoreConfidence({
    source: "manual",
    geofenceValid: false,
    reporterReputation: 0,
    reportedPrice: 4.5,
    priorPrice: 4.6,
    priorConfidence: 0.8,
  });
  assert.ok(r.confidence < 0.35, `expected low confidence, got ${r.confidence}`);
  assert.equal(r.accepted, false);
});

test("a wild outlier is penalized vs an agreeing report", () => {
  const base = { source: "shelf", geofenceValid: true, reporterReputation: 0.5, priorPrice: 5, priorConfidence: 0.7 } as const;
  const agree = scoreConfidence({ ...base, reportedPrice: 5.05 });
  const outlier = scoreConfidence({ ...base, reportedPrice: 1.0 });
  assert.ok(outlier.confidence < agree.confidence);
});

test("reputation lifts confidence, all else equal", () => {
  const low = scoreConfidence({ source: "manual", geofenceValid: true, reporterReputation: 0, reportedPrice: 3, priorPrice: 3, priorConfidence: 0.5 });
  const high = scoreConfidence({ source: "manual", geofenceValid: true, reporterReputation: 1, reportedPrice: 3, priorPrice: 3, priorConfidence: 0.5 });
  assert.ok(high.confidence > low.confidence);
});
