// Embeddings for product entity-resolution (docs/research/receipt-ocr-product-matching.md). The
// matcher turns "GV WHP MLK" and "Great Value Whole Milk" into nearby vectors so cosine similarity
// resolves them — semantic, not just lexical overlap. Two providers behind one seam:
//   default → a deterministic local feature-hashing embedder (zero-dep, offline, stable tests)
//   real    → Voyage AI (Anthropic's recommended embedding model), gated by VOYAGE_API_KEY
// Vectors are L2-normalized so cosine == dot product.

export type Embeddings = { dims: number; embed: (texts: string[]) => Promise<number[][]> };

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// FNV-1a 32-bit — stable string hash for feature hashing.
function fnv1a(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Feature-hashing ("hashing trick") embedding: hash word tokens + character trigrams into a fixed
// vector with signed buckets, then L2-normalize. Lexically/semantically related normalized strings
// share many features → high cosine, with no model or network. Good enough for MVP-scale catalogs
// and for offline tests; the Voyage provider swaps in for production-quality semantics.
export function hashingEmbeddings(opts: { dims?: number; normalizer?: (s: string) => string } = {}): Embeddings {
  const dims = opts.dims ?? 256;
  const normalize = opts.normalizer ?? ((s) => s.toLowerCase());
  return {
    dims,
    embed: async (texts) => texts.map((t) => featurize(normalize(t), dims)),
  };
}

function featurize(text: string, dims: number): number[] {
  const vec = new Array<number>(dims).fill(0);
  const words = text.split(/\s+/).filter(Boolean);
  const add = (feature: string, weight: number) => {
    const h = fnv1a(feature);
    const bucket = h % dims;
    const sign = (fnv1a(feature, 0x9e3779b1) & 1) === 0 ? 1 : -1;
    vec[bucket]! += sign * weight;
  };
  for (const w of words) {
    add(`w:${w}`, 1);
    const padded = `^${w}$`;
    for (let i = 0; i + 3 <= padded.length; i++) add(`t:${padded.slice(i, i + 3)}`, 0.5);
  }
  // L2 normalize
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dims; i++) vec[i]! /= norm;
  return vec;
}

export type VoyageOptions = {
  apiKey: string;
  model?: string;
  dims?: number;
  endpoint?: string;
  inputType?: "query" | "document";
  fetchImpl?: typeof fetch;
};

// Real embeddings via Voyage AI. The live HTTP call is the only un-tested part (gated by key).
export function voyageEmbeddings(opts: VoyageOptions): Embeddings {
  const doFetch = opts.fetchImpl ?? fetch;
  const endpoint = opts.endpoint ?? "https://api.voyageai.com/v1/embeddings";
  const model = opts.model ?? "voyage-3";
  return {
    dims: opts.dims ?? 1024,
    embed: async (texts) => {
      if (texts.length === 0) return [];
      const res = await doFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({ input: texts, model, ...(opts.inputType ? { input_type: opts.inputType } : {}) }),
      });
      if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`);
      const body = (await res.json()) as { data?: Array<{ embedding: number[] }> };
      return (body.data ?? []).map((d) => d.embedding);
    },
  };
}
