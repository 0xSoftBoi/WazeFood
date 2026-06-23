// Perception extractor — the part that actually turns a photo/text into {price, text} with a
// field-level confidence. Two tiers behind one seam (docs/research/receipt-ocr-product-matching.md):
//   cheap     → a fast/cheap VLM does OCR+extraction in one shot (the memo's "buy OCR cheap")
//   expensive → a top VLM, used only when the cheap tier is low-confidence (the escalation)
// RoutingPerception owns the cost model + when-to-escalate; this owns how each tier reads the capture.
//
// The default is a deterministic stub (zero-dep, stable tests). The real extractor calls the
// Anthropic Messages API over fetch (no SDK dependency) and is gated by ANTHROPIC_API_KEY — the only
// live-network part; the response parsing below is pure and unit-tested.

export type CaptureImage = { base64?: string; url?: string; mediaType?: string };

export type Capture = {
  barcode?: string | null;
  text?: string | null;
  mediaHash?: string | null;
  image?: CaptureImage | null;
  reportedPrice?: number | null;
};

export type Extraction = {
  price: number | null;
  text: string | null;
  confidence: number; // 0..1, the model's field-level confidence the price/text was read correctly
};

export type Tier = "cheap" | "expensive";

export type Extractor = { extract: (capture: Capture, tier: Tier) => Promise<Extraction> };

// Deterministic pseudo-confidence from the media hash, so the stub's escalation behaviour is stable
// across runs (the real extractor returns the model's own confidence instead).
export function hashConfidence(mediaHash: string): number {
  let h = 0;
  for (let i = 0; i < mediaHash.length; i++) h = (h * 31 + mediaHash.charCodeAt(i)) >>> 0;
  return 0.45 + (h % 55) / 100; // 0.45..0.99
}

// Default extractor: no real perception, deterministic confidence. The expensive tier "fixes" the
// read to a high confidence, mirroring how escalation recovers a low-confidence cheap pass.
export function deterministicExtractor(): Extractor {
  return {
    extract: async (capture, tier) => ({
      price: capture.reportedPrice ?? null,
      text: capture.text ?? null,
      confidence: tier === "expensive" ? 0.92 : hashConfidence(capture.mediaHash ?? ""),
    }),
  };
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

// Parse a model's reply into an Extraction. Tolerates ```json fences and surrounding prose; missing
// or malformed fields degrade gracefully (null price, low confidence) rather than throwing.
export function parseExtraction(raw: string): Extraction {
  const fail: Extraction = { price: null, text: null, confidence: 0 };
  if (typeof raw !== "string" || raw.trim().length === 0) return fail;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return fail;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return fail;
  }
  const price = typeof obj.price === "number" && Number.isFinite(obj.price) ? obj.price : null;
  const text = typeof obj.text === "string" ? obj.text : null;
  const confidence = typeof obj.confidence === "number" && Number.isFinite(obj.confidence) ? clamp01(obj.confidence) : price !== null ? 0.6 : 0;
  return { price, text, confidence };
}

export type AnthropicExtractorOptions = {
  apiKey: string;
  cheapModel?: string;
  expensiveModel?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
};

const EXTRACT_PROMPT =
  "You read grocery price evidence (a receipt line, shelf tag, or photo). Return ONLY strict JSON, " +
  'no prose: {"price": <number or null>, "text": <string>, "confidence": <0..1>}. ' +
  "price is the unit shelf/receipt price in dollars; confidence is how sure you are it was read correctly.";

// Real extractor backed by the Anthropic Messages API. cheap→Haiku, expensive→Opus by default.
export function anthropicExtractor(opts: AnthropicExtractorOptions): Extractor {
  const doFetch = opts.fetchImpl ?? fetch;
  const endpoint = opts.endpoint ?? "https://api.anthropic.com/v1/messages";
  const model = { cheap: opts.cheapModel ?? "claude-haiku-4-5-20251001", expensive: opts.expensiveModel ?? "claude-opus-4-8" };

  return {
    extract: async (capture, tier) => {
      // Build the user content: the image if we have one, plus any client-typed text to ground it.
      const content: Array<Record<string, unknown>> = [{ type: "text", text: EXTRACT_PROMPT }];
      if (capture.image?.base64 != null) {
        content.push({ type: "image", source: { type: "base64", media_type: capture.image.mediaType ?? "image/jpeg", data: capture.image.base64 } });
      } else if (capture.image?.url != null) {
        content.push({ type: "image", source: { type: "url", url: capture.image.url } });
      }
      if (capture.text != null && capture.text.length > 0) content.push({ type: "text", text: `Client-typed line: ${capture.text}` });

      const res = await doFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: model[tier], max_tokens: 256, messages: [{ role: "user", content }] }),
      });
      if (!res.ok) throw new Error(`perception ${tier} HTTP ${res.status}`);
      const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
      return parseExtraction(text);
    },
  };
}
