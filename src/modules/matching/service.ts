// Product Matching / Entity Resolution (docs/research/receipt-ocr-product-matching.md).
// Turns a captured signal — a barcode or a cryptic line-item string like "GV WHP MILK" — into
// a canonical product. Barcode (GTIN/UPC) is the exact key and makes ~70% of ingestion free;
// text falls back to normalized token similarity (a stand-in for the production embedding +
// ANN-blocking matcher over products.embedding). Returns a separate matchScore so "product
// matched correctly" stays distinct from "price read correctly" in the confidence engine.

export type MatchMethod = "barcode" | "text" | "none";
export type MatchResult = { productId: string | null; matchScore: number; method: MatchMethod };

export type CatalogMatchPort = {
  getByUpc: (upc: string) => { id: string } | undefined;
  listProducts: () => Array<{ id: string; name: string; brand: string | null }>;
};

// Retail line-item abbreviations → expansions. Tiny, illustrative; production uses a learned
// normalizer. ("GV WHP MILK" → "great value whole milk").
const ABBREV: Record<string, string> = {
  gv: "great value",
  whp: "whole",
  wht: "wheat",
  mlk: "milk",
  chz: "cheese",
  org: "organic",
  lg: "large",
  eggs: "eggs",
  brd: "bread",
};

const STOPWORDS = new Set(["the", "a", "of", "and", "ct", "oz", "gal", "lb", "pack", "size"]);
const TEXT_ACCEPT = 0.34;

function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length === 0) continue;
    const expanded = ABBREV[raw] ?? raw;
    for (const tok of expanded.split(" ")) {
      if (tok.length > 0 && !STOPWORDS.has(tok)) out.add(tok);
    }
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export class MatchingService {
  private readonly deps: { catalog: CatalogMatchPort };
  constructor(deps: { catalog: CatalogMatchPort }) {
    this.deps = deps;
  }

  resolve(input: { barcode?: string | null; text?: string | null }): MatchResult {
    // 1) Barcode is the canonical exact key — free and unambiguous.
    if (input.barcode != null && input.barcode.length > 0) {
      const hit = this.deps.catalog.getByUpc(input.barcode);
      if (hit !== undefined) return { productId: hit.id, matchScore: 1, method: "barcode" };
    }
    // 2) Text → normalized token similarity (blocking + scoring stand-in).
    if (input.text != null && input.text.length > 0) {
      const q = tokenize(input.text);
      let best: { id: string; score: number } | undefined;
      for (const p of this.deps.catalog.listProducts()) {
        const cand = tokenize(`${p.brand ?? ""} ${p.name}`);
        const score = jaccard(q, cand);
        if (best === undefined || score > best.score) best = { id: p.id, score };
      }
      if (best !== undefined && best.score >= TEXT_ACCEPT) {
        return { productId: best.id, matchScore: round2(best.score), method: "text" };
      }
      return { productId: best?.id ?? null, matchScore: best === undefined ? 0 : round2(best.score), method: "none" };
    }
    return { productId: null, matchScore: 0, method: "none" };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
