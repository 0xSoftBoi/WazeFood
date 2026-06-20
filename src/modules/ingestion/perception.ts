// Perception routing (docs/research/receipt-ocr-product-matching.md §"cheap→expensive").
// Decides how to turn a capture into structured {text, price} as cheaply as possible:
//   barcode/client-structured → free
//   else cheap OCR/VLM        → ~$0.0003
//   escalate to expensive VLM → ~$0.003, only when cheap extraction is low-confidence
// Tracks spend vs the naive "send everything to the expensive model" baseline so the savings
// are measurable (the memo's ~$1,000/mo → ~$30/mo result). The extraction itself is stubbed
// deterministically here; the *routing + cost model* is real and what we test.

export type Route = "barcode" | "client" | "ocr_cheap" | "vlm_expensive" | "none";

export type PerceptionInput = {
  barcode?: string | null;
  text?: string | null;        // already-structured text (e.g. on-device or client-typed)
  mediaHash?: string | null;   // a photo to process server-side
  reportedPrice?: number | null;
};

export type PerceptionResult = {
  routes: Route[];
  costCents: number;
  baselineCents: number;       // cost if we had used the expensive model unconditionally
  extractionConfidence: number; // 0..1, "was the price/text read correctly"
  price: number | null;
};

const COST = { ocr_cheap: 0.03, vlm_expensive: 0.3 }; // cents per item
const CHEAP_ESCALATE_BELOW = 0.7;

// Deterministic pseudo-confidence for a stubbed cheap extractor, derived from the media hash
// so tests are stable. Real impl returns the model's field-level confidence.
function cheapConfidence(mediaHash: string): number {
  let h = 0;
  for (let i = 0; i < mediaHash.length; i++) h = (h * 31 + mediaHash.charCodeAt(i)) >>> 0;
  return 0.45 + (h % 55) / 100; // 0.45..0.99
}

export class RoutingPerception {
  private spentCents = 0;
  private baselineCents = 0;

  perceive(input: PerceptionInput): PerceptionResult {
    const routes: Route[] = [];
    let costCents = 0;
    let extractionConfidence = 0;

    if (input.barcode != null && input.barcode.length > 0) {
      // Barcode decoded on-device: no server perception spend at all.
      routes.push("barcode");
      extractionConfidence = 1;
    } else if (input.text != null && input.text.length > 0) {
      routes.push("client");
      extractionConfidence = 0.85;
    } else if (input.mediaHash != null && input.mediaHash.length > 0) {
      routes.push("ocr_cheap");
      costCents += COST.ocr_cheap;
      extractionConfidence = cheapConfidence(input.mediaHash);
      if (extractionConfidence < CHEAP_ESCALATE_BELOW) {
        routes.push("vlm_expensive");
        costCents += COST.vlm_expensive;
        extractionConfidence = Math.max(extractionConfidence, 0.92);
      }
    } else {
      routes.push("none");
    }

    // Baseline: a naive pipeline would send every capture to the expensive model.
    const baseline = routes.includes("barcode") || routes.includes("client") || routes.includes("none") ? 0 : COST.vlm_expensive;
    this.spentCents += costCents;
    this.baselineCents += baseline;

    return { routes, costCents, baselineCents: baseline, extractionConfidence, price: input.reportedPrice ?? null };
  }

  // Cumulative spend vs the naive baseline — the cost-efficiency receipt.
  stats(): { spentCents: number; baselineCents: number; savedCents: number; savedPct: number } {
    const saved = this.baselineCents - this.spentCents;
    return {
      spentCents: round2(this.spentCents),
      baselineCents: round2(this.baselineCents),
      savedCents: round2(saved),
      savedPct: this.baselineCents === 0 ? 0 : Math.round((saved / this.baselineCents) * 100),
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
