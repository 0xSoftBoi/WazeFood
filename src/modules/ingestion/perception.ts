// Perception routing (docs/research/receipt-ocr-product-matching.md §"cheap→expensive").
// Decides how to turn a capture into structured {text, price} as cheaply as possible:
//   barcode/client-structured → free
//   else cheap OCR/VLM        → ~$0.0003
//   escalate to expensive VLM → ~$0.003, only when cheap extraction is low-confidence
// Tracks spend vs the naive "send everything to the expensive model" baseline so the savings
// are measurable (the memo's ~$1,000/mo → ~$30/mo result). The routing + cost model live here;
// the actual reading is delegated to an Extractor (deterministic stub by default; real VLM when
// ANTHROPIC_API_KEY is set — see extractor.ts).

import { deterministicExtractor, type Capture, type Extractor } from "./extractor.ts";

export type Route = "barcode" | "client" | "ocr_cheap" | "vlm_expensive" | "none";

export type PerceptionInput = Capture;

export type PerceptionResult = {
  routes: Route[];
  costCents: number;
  baselineCents: number; // cost if we had used the expensive model unconditionally
  extractionConfidence: number; // 0..1, "was the price/text read correctly"
  price: number | null;
};

const COST = { ocr_cheap: 0.03, vlm_expensive: 0.3 }; // cents per item
const CHEAP_ESCALATE_BELOW = 0.7;

export class RoutingPerception {
  private spentCents = 0;
  private baselineCents = 0;
  private readonly extractor: Extractor;

  constructor(deps: { extractor?: Extractor } = {}) {
    this.extractor = deps.extractor ?? deterministicExtractor();
  }

  async perceive(input: PerceptionInput): Promise<PerceptionResult> {
    const routes: Route[] = [];
    let costCents = 0;
    let extractionConfidence = 0;
    let price = input.reportedPrice ?? null;

    if (input.barcode != null && input.barcode.length > 0) {
      // Barcode decoded on-device: no server perception spend at all.
      routes.push("barcode");
      extractionConfidence = 1;
    } else if (input.text != null && input.text.length > 0) {
      routes.push("client");
      extractionConfidence = 0.85;
    } else if (hasImage(input)) {
      routes.push("ocr_cheap");
      costCents += COST.ocr_cheap;
      const cheap = await this.extractor.extract(input, "cheap");
      extractionConfidence = cheap.confidence;
      price = cheap.price ?? price;
      if (cheap.confidence < CHEAP_ESCALATE_BELOW) {
        routes.push("vlm_expensive");
        costCents += COST.vlm_expensive;
        const better = await this.extractor.extract(input, "expensive");
        // Take the stronger read (the expensive tier is meant to recover the low-confidence cheap one).
        if (better.confidence >= cheap.confidence) {
          extractionConfidence = better.confidence;
          price = better.price ?? price;
        }
      }
    } else {
      routes.push("none");
    }

    // Baseline: a naive pipeline would send every capture to the expensive model.
    const baseline = routes.includes("barcode") || routes.includes("client") || routes.includes("none") ? 0 : COST.vlm_expensive;
    this.spentCents += costCents;
    this.baselineCents += baseline;

    return { routes, costCents, baselineCents: baseline, extractionConfidence, price };
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

// A capture needs server-side perception when it has an image to read (or a media hash standing in
// for one in the demo/stub path).
function hasImage(input: PerceptionInput): boolean {
  return (input.image?.base64 != null && input.image.base64.length > 0)
    || (input.image?.url != null && input.image.url.length > 0)
    || (input.mediaHash != null && input.mediaHash.length > 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
