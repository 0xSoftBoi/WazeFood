// Product Matching / Entity Resolution (docs/research/receipt-ocr-product-matching.md).
// Turns a captured signal — a barcode or a cryptic line-item string like "GV WHP MILK" — into
// a canonical product. Barcode (GTIN/UPC) is the exact key and makes ~70% of ingestion free;
// text falls back to a real embedding + cosine vector search over the catalog (semantic match,
// not just lexical overlap). The query and each product name are normalized (abbreviation
// expansion, stopword removal) before embedding. Returns a separate matchScore so "product
// matched correctly" stays distinct from "price read correctly" in the confidence engine.
//
// The vector index is in-memory brute-force here (correct + fast at MVP catalog sizes); the same
// embeddings land in pgvector for ANN at scale (db/migrations products.embedding). The embedder is
// pluggable: a deterministic local one by default, Voyage AI when VOYAGE_API_KEY is set.

import { hashingEmbeddings, type Embeddings } from "./embeddings.ts";
import { MemoryVectorIndex, type VectorIndex } from "../../platform/store/repositories.ts";

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
const TEXT_ACCEPT = 0.5; // cosine threshold for a confident text match

// Normalize a line item / product name into a canonical token string before embedding, so the
// query and catalog are compared in the same space (expand abbreviations, drop noise tokens).
export function normalizeText(s: string): string {
  const out: string[] = [];
  for (const raw of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length === 0) continue;
    const expanded = ABBREV[raw] ?? raw;
    for (const tok of expanded.split(" ")) {
      if (tok.length > 0 && !STOPWORDS.has(tok)) out.push(tok);
    }
  }
  return out.join(" ");
}

export class MatchingService {
  private readonly catalog: CatalogMatchPort;
  private readonly embeddings: Embeddings;
  private readonly acceptThreshold: number;
  // The vector index: in-memory brute-force by default, pgvector ANN in relational mode (same seam).
  private readonly index: VectorIndex;

  constructor(deps: { catalog: CatalogMatchPort; embeddings?: Embeddings; acceptThreshold?: number; vectors?: VectorIndex }) {
    this.catalog = deps.catalog;
    this.embeddings = deps.embeddings ?? hashingEmbeddings({ normalizer: normalizeText });
    this.acceptThreshold = deps.acceptThreshold ?? TEXT_ACCEPT;
    this.index = deps.vectors ?? new MemoryVectorIndex();
  }

  async resolve(input: { barcode?: string | null; text?: string | null }): Promise<MatchResult> {
    // 1) Barcode is the canonical exact key — free and unambiguous.
    if (input.barcode != null && input.barcode.length > 0) {
      const hit = this.catalog.getByUpc(input.barcode);
      if (hit !== undefined) return { productId: hit.id, matchScore: 1, method: "barcode" };
    }
    // 2) Text → embedding + nearest-neighbour over the catalog's vector index.
    if (input.text != null && input.text.length > 0) {
      await this.ensureIndex();
      const [qVec] = await this.embeddings.embed([normalizeText(input.text)]);
      if (qVec === undefined) return { productId: null, matchScore: 0, method: "none" };
      const [best] = await this.index.nearest(qVec, 1);
      if (best !== undefined && best.score >= this.acceptThreshold) {
        return { productId: best.id, matchScore: round2(best.score), method: "text" };
      }
      return { productId: best?.id ?? null, matchScore: best === undefined ? 0 : round2(best.score), method: "none" };
    }
    return { productId: null, matchScore: 0, method: "none" };
  }

  // Embed any products that are new or whose name/brand changed, and drop ones removed from the
  // catalog. Embedding is batched, so a cold start is a single provider call.
  private async ensureIndex(): Promise<void> {
    const products = this.catalog.listProducts();
    const sigOf = (p: { name: string; brand: string | null }) => `${p.brand ?? ""}|${p.name}`;
    const existing = new Map((await this.index.loadSignatures()).map((r) => [r.id, r.sig]));
    const stale = products.filter((p) => existing.get(p.id) !== sigOf(p));
    if (stale.length > 0) {
      const vecs = await this.embeddings.embed(stale.map((p) => normalizeText(`${p.brand ?? ""} ${p.name}`)));
      const rows = stale
        .map((p, i) => ({ id: p.id, sig: sigOf(p), vec: vecs[i] }))
        .filter((r): r is { id: string; sig: string; vec: number[] } => r.vec !== undefined);
      await this.index.upsertMany(rows);
    }
    const live = new Set(products.map((p) => p.id));
    const removed = [...existing.keys()].filter((id) => !live.has(id));
    if (removed.length > 0) await this.index.removeMany(removed);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
