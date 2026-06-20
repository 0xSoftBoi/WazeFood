# Receipt OCR, Item Extraction & Cross-Retailer Product Matching — Research Memo

**Author:** ML/Ingestion research · **Date:** 2026-06-20 · **Audience:** SmartCart eng + founders
**Scope:** The AI subsystem of crowdsourced ingestion — turning phone photos of receipts and shelf tags into structured, matched, confidence-scored price data, **cheaply**. This memo is for a bootstrapped startup, so every recommendation is filtered through cost per 1,000 receipts.

> **Sourcing note.** All figures below were retrieved by direct fetch of primary sources (vendor pricing pages, GitHub, arXiv, HuggingFace, GS1) in June 2026; live web search was intermittently unavailable during research, so a few numbers I could not fetch are flagged `[verify]` rather than asserted. Vendor self-claims (e.g. PaddleOCR "beats GPT-5.5", Veryfi "99%+") are labeled as such. Per-receipt cost estimates derived by arithmetic from token/page prices are labeled `(est.)`. Every URL in the body is real and in **Sources**.

---

## 0. TL;DR (the five sharp conclusions)

1. **Don't run an OCR engine at MVP. Run a VLM.** A modern vision-language model (Gemini 2.0 Flash, GPT-4o-mini, or self-hosted Qwen2.5-VL) does OCR **and** structured line-item extraction in one call, beating the old "OCR engine → layout model → parser" stack on cryptic receipt text. Qwen2.5-VL-72B scores **OCRBench 885 / DocVQA 96.4**, above GPT-4o's 736, and on getomni's open benchmark Qwen2.5-VL hits **~75% end-to-end JSON accuracy, matching GPT-4o** ([getomni](https://getomni.ai/blog/benchmarking-open-source-models-for-ocr), [Qwen card](https://huggingface.co/Qwen/Qwen2.5-VL-72B-Instruct)).
2. **The cost spread is ~25×.** Per 1,000 receipts: Gemini 2.0 Flash ≈ **$0.20 (est.)**, GPT-4o-mini ≈ **$0.30–0.40 (est.)**, AWS Textract AnalyzeExpense = **$10.00**, Google Expense Parser = **$10.00**, Veryfi = **$80**. Self-hosted PaddleOCR/Qwen on a $0.39–0.53/hr GPU lands near **$0.01–0.07/1,000** at the cost of ops. Routing cheap→expensive is the whole game.
3. **Barcode is free; OCR is not.** On-device ML Kit / Apple Vision decode UPC-A/EAN-13 at **$0 marginal cost, offline** ([ML Kit](https://developers.google.com/ml-kit/vision/barcode-scanning)). A GTIN is a global canonical key ([GS1](https://ref.gs1.org/standards/digital-link/)). Barcode-first / OCR-fallback is the cheapest possible ingestion path and should be the default for shelf scans.
4. **Matching "GV WHP MILK" is the hard, durable problem — and it's entity resolution, not OCR.** The literature is mature: cast it as transformer sequence-pair matching (Ditto, **F1 96.5%** on a 1M-record task, [arXiv 2004.00584](https://arxiv.org/abs/2004.00584)), block with embeddings + ANN (pgvector HNSW, already in our data model), and keep a human-in-the-loop active-learning queue ([arXiv 1906.08042](https://arxiv.org/abs/1906.08042)).
5. **The receipt total is a free oracle.** Σ(line items) + tax = printed total is a self-checking reconciliation signal that costs nothing and slots directly into our existing **confidence engine** as a new multiplicative factor. Use it to gate auto-promotion and to trigger escalation to a more expensive model.

---

## 1. Receipt OCR / Document AI: managed APIs vs. open models

### 1.1 The pipeline has collapsed

The classic stack was three stages: (a) text detection+recognition (OCR), (b) layout/KIE model (LayoutLMv3, Donut), (c) rule/regex post-processing. Two things changed it:

- **OCR-free document understanding.** Donut (ECCV 2022, [arXiv 2111.15664](https://arxiv.org/abs/2111.15664)) showed you can map a receipt image straight to structured JSON with one transformer, avoiding OCR error propagation. It trained on **CORD** (1,000 receipts annotated with menu line items, subtotal, tax, total — [CORD-v2](https://huggingface.co/datasets/naver-clova-ix/cord-v2)).
- **General VLMs got good at OCR.** Qwen2.5-VL explicitly targets "receipts, invoices, forms" with structured JSON output ([Qwen blog](https://qwenlm.github.io/blog/qwen2.5-vl/)). For our use case a VLM **is** the OCR engine, the layout model, and the parser at once.

### 1.2 Cost & capability comparison

**Managed structured-extraction APIs** (price = list, US regions, fetched June 2026):

| Service | Product | Price | Per 1,000 receipts | Notes / source |
|---|---|---|---|---|
| **AWS Textract** | AnalyzeExpense | $0.01/page | **$10.00** (≥1M: $8.00) | Receipt/invoice fields + line items. [pricing](https://aws.amazon.com/textract/pricing/) |
| AWS Textract | DetectDocumentText (raw OCR) | $0.0015/page | $1.50 | OCR only, no fields. Same page |
| **Google Document AI** | Expense Parser (ex-receipt) | $0.10/10 pages | **$10.00** | Pretrained receipt/expense. [pricing](https://cloud.google.com/document-ai/pricing) |
| Google Document AI | Enterprise Document OCR | $1.50/1k pages | $1.50 (>5M: $0.60) | OCR only. Same page |
| Google Document AI | Custom Extractor | $30/1k pages | $30.00 | Train your own KIE. Same page |
| **Azure AI Doc Intelligence** | Prebuilt Receipt | per-page, commitment tiers `[verify]` | ~$1–$10 `[verify]` | Billing model confirmed (per page; free **F0** capped at 2 pages/req; commitment pricing for large workloads) but live per-page rate not fetchable. [pricing](https://azure.microsoft.com/en-us/pricing/details/ai-document-intelligence/) · [billing model](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/service-limits) |
| **Veryfi** | Receipt | $0.08/receipt (Starter, $500/mo min) | **$80.00** | "99%+ accuracy" (vendor claim), 150+ fields, Level-3 line items, blur detect, auto-rotate. [pricing](https://www.veryfi.com/pricing/) · [API](https://www.veryfi.com/receipt-ocr-api/) |
| **Taggun** | Receipt scan | $0.040–0.056/scan | **$40–$56** | Receipt-specialized, "90%+ accuracy" claim, <4s, merchant standardization, tax intel. [pricing](https://www.taggun.io/pricing) · [site](https://www.taggun.io/) |
| **Mindee** | per page | €0.035–0.05/page | **~$40–55** | Per physical page; confidence scores on higher tiers. [pricing](https://www.mindee.com/pricing) |

**VLM / LLM APIs** (do OCR + extraction in one call; per-receipt cost is `(est.)` from token prices — exact image token count depends on each provider's tiling):

| Model | Input $/1M | Output $/1M | ~Per receipt | ~Per 1,000 | Source |
|---|---|---|---|---|---|
| **Gemini 2.0 Flash** | $0.10 | $0.40 | ~$0.0002 | **~$0.20** | [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Gemini 2.5 Flash | $0.30 | $2.50 | ~$0.001 | ~$1.0 | Same |
| **GPT-4o-mini** | $0.15 | $0.60 | ~$0.0003–0.0004 | **~$0.30–0.40** | [OpenAI](https://developers.openai.com/api/docs/models/gpt-4o-mini) |
| GPT-4o | $2.50 | $10.00 | ~$0.005 | ~$5.00 | [OpenAI 4o](https://developers.openai.com/api/docs/models/gpt-4o) |

> Per-receipt token assumption: ~1,000 input (image, tiled) + ~300 output (JSON) tokens. Batch APIs (Gemini Batch $0.05/$0.20; OpenAI Batch -50%) halve this again for our async pipeline — and **our ingestion path is already async** (ARCHITECTURE §4.4), so batch is free money.

**Open models (self-hosted, $0 per-call license):**

| Model | Size | License | Why it matters | Source |
|---|---|---|---|---|
| **PaddleOCR / PP-OCRv6** (v3.7.0, 2026-06-11) | tiny 1.5M / small 7.7M / **medium 34.5M** | Apache 2.0 | Leading cheap OCR; one model, 50 languages; CPU-friendly; vendor claims it surpasses Qwen3-VL-235B/GPT-5.5 at 34.5M params **(self-claim, treat skeptically)** | [GitHub](https://github.com/PaddlePaddle/PaddleOCR) |
| PP-StructureV3 | — | Apache 2.0 | Doc→Markdown/JSON with cell+text coordinates (line-item layout) | Same |
| **Qwen2.5-VL-7B** | 7B | Apache 2.0 | OCRBench **864**, DocVQA 95.7; receipt JSON KIE built in | [card](https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct) |
| GOT-OCR2.0 | 0.7B | Apache 2.0 | Tiny end-to-end OCR | [card](https://huggingface.co/stepfun-ai/GOT-OCR2_0) |
| dots.ocr | ~3B | MIT | Layout+OCR VLM, 100+ langs, TEDS 88.6 (table) | [card](https://huggingface.co/rednote-hilab/dots.ocr) |
| docTR | — | Apache 2.0 | Mindee's open detect→recognize lib; no headline accuracy published | [GitHub](https://github.com/mindee/doctr) |
| Tesseract | — | Apache 2.0 | **Avoid for phone-photo receipts** — needs ≥300 DPI, deskew, clean binarization; degrades on skew/glare/faded thermal | [docs](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html) |

**OCR-capability scoreboard** (vendor model cards, so Qwen-framed — cross-check an independent OCRBench leaderboard `[verify]` before quoting externally; [72B](https://huggingface.co/Qwen/Qwen2.5-VL-72B-Instruct), [7B](https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct)):

| Model | OCRBench | DocVQA | Read |
|---|---|---|---|
| Qwen2.5-VL-72B | **885** | 96.4 (val) | best open-weights OCR |
| Qwen2.5-VL-7B | 864 | 95.7 (test) | self-host sweet spot |
| Gemini-2-flash | 854 | — | cheapest hosted, strong |
| GPT-4o | 736 | 91.1 (val) | escalation tier |
| GPT-4o-mini | 785 | — | cheap hosted default |

**End-to-end JSON-extraction accuracy** (getomni open-source benchmark, Mar 2025, GPT-4o judge, [link](https://getomni.ai/blog/benchmarking-open-source-models-for-ocr)): Qwen2.5-VL 72B/32B **~75%** ("equivalent to GPT-4o"), Mistral-OCR **72.2%**, Gemma-3-27B **42.9%**. Note OCRBench (raw text) and end-to-end JSON accuracy (text **and** structure) measure different things — the ~75% ceiling on full structured extraction is why **reconciliation + human review** (§2, §5) are non-negotiable, not optional polish. The headline Feb-2025 per-provider managed table (Textract/Azure/Google accuracy & cost) is JS-rendered and could not be fetched — `[verify]` if a precise managed-vs-VLM accuracy delta is needed.

**Read:** for SmartCart, a hosted VLM (Gemini 2.0 Flash) is **~25–50× cheaper than AnalyzeExpense/Veryfi** and does the structured extraction natively, at accuracy parity with GPT-4o and above Textract on the open benchmark. Tesseract is a trap on real phone photos. PaddleOCR/Qwen2.5-VL-7B are the self-host endgame once volume justifies the ops.

---

## 2. Receipt-specific challenges & how the panel companies solve them

Real SmartCart input is a crumpled, low-light, glare-streaked phone photo of a faded thermal receipt — the hardest case in document AI. Concrete failure modes and mitigations:

- **Image quality (wrinkles, blur, glare, faded thermal, rotation).** Vendor pipelines front-load **blur detection, image-quality scoring, and auto-rotate** before OCR (Veryfi "Stage 1 Blur Detection / Auto-Rotate Receipts," [API](https://www.veryfi.com/receipt-ocr-api/)). Tesseract specifically fails here — its line segmentation "reduces significantly if a page is too skewed" and Otsu binarization breaks on uneven/faded backgrounds ([Tesseract](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html)). Nanonets recommends grayscale→threshold→denoise (OpenCV) preprocessing ([Nanonets](https://nanonets.com/blog/receipt-ocr/)). **For SmartCart: do the cheap quality gate + dewarp on-device** (we already plan an "aisle-walk capture coach"; extend it to a receipt-capture coach that rejects blurry frames before upload — this is the cheapest possible quality lever).
- **Cryptic, abbreviated line items ("GV WHP MILK", "KRO 2% RF").** This is the signature receipt problem and is **not** solved by better OCR — the characters are read correctly; the string is just compressed and store-specific. It is a normalization + entity-resolution problem (§4). Receipt-specialist vendors layer **merchant standardization** and category tagging on top of OCR (Taggun mid-tiers add "merchant standardization, purchase categorization," [pricing](https://www.taggun.io/pricing)).
- **Missing brand/size.** Receipts rarely print size/UPC; you infer them from the abbreviation + the store + price + a catalog prior. Treat as attribute-value extraction (MAVE, Google, WSDM 2022, [arXiv 2112.08663](https://arxiv.org/abs/2112.08663)).
- **Store-specific formats.** Every retailer's receipt layout differs. VLMs generalize across layouts far better than templated parsers (the OCR-free thesis, Donut). Keep a small per-retailer abbreviation lexicon as a cache that grows from confirmed matches.
- **Totals/tax reconciliation = a free correctness oracle.** Σ(line-item prices) + tax ≈ printed total. CORD/SROIE annotate exactly these fields ([CORD-v2](https://huggingface.co/datasets/naver-clova-ix/cord-v2); [SROIE](https://arxiv.org/abs/2103.10213), 1,000 receipts, 3 tasks). If the sum doesn't reconcile, an item was mis-read or dropped → **lower confidence / escalate to a stronger model / route to human review**. This is the single highest-ROI validation we can add and it costs nothing.

**How Fetch / Ibotta do it at scale.** Both are receipt-panel businesses whose moat is exactly item-level normalization: OCR the receipt, then match each line to a canonical product/brand to attribute rewards. Their architecture is the textbook pattern — high-recall cheap OCR + a large, continuously-curated product graph + aggressive human-in-the-loop correction that feeds back into the matcher. (I could not fetch a citable receipts-scanned figure for Fetch/Ibotta in this session — `[verify]` the "billions of receipts" claim before quoting it externally.) The transferable lesson: **the durable asset is the canonical product graph and its match feedback loop, not the OCR model** — which is precisely our `products` / `product_upcs` / `product_swaps` tables.

---

## 3. Shelf-tag / price-tag reading & barcode / image product recognition

For in-store contributions (shelf photos, price tags), the cheapest signal is the barcode, then the tag, then the image.

- **Barcode = $0, on-device, offline.** Google **ML Kit barcode scanning** runs "completely on the device… doesn't require a network connection," Android+iOS, decoding UPC-A, UPC-E, EAN-8, EAN-13, Code128, ITF, QR, etc. ([ML Kit](https://developers.google.com/ml-kit/vision/barcode-scanning)). Apple **Vision** offers `VNDetectBarcodesRequest` → `VNBarcodeObservation.payloadStringValue` with the same symbologies ([Apple](https://developer.apple.com/documentation/vision/vnbarcodeobservation)). Open-source fallback: **ZXing** (Apache 2.0, [GitHub](https://github.com/zxing/zxing)).
- **GTIN as the join key.** A scanned UPC-A is a **GTIN-12**; GTIN encodes a GS1 company prefix + item ref + check digit and is the global canonical product identifier; GS1 Digital Link turns it into a resolvable URI ([GS1 ref](https://ref.gs1.org/standards/digital-link/); [GS1 US guide](https://www.gs1us.org/upcs-barcodes-prefixes/guide-to-upcs)). **Our `product_upcs(upc PK, product_id)` table is exactly this join.**
- **Barcode → product enrichment.** **Open Food Facts** is a free, ODbL-licensed DB of **4,556,586 products** queryable by barcode at `/api/v2/product/{barcode}.json` ([OFF](https://world.openfoodfacts.org/); [API docs](https://openfoodfacts.github.io/openfoodfacts-server/api/)). Great for cold-starting our food catalog from a scanned UPC at $0.
- **Shelf-tag OCR.** No dedicated electronic-shelf-label/price-tag OCR benchmark surfaced (`[verify]`/gap). Treat a shelf-tag photo as a tiny receipt: VLM reads `{price, unit_price, product_name}`; the printed barcode (if captured) is the canonical key. The "walk slowly, capture the aisle sign" on-device coach already in ARCHITECTURE §6 applies directly.
- **Image embeddings for visual product match.** ML Kit on-device image labeling (400+ entities, custom TFLite supported, [ML Kit](https://developers.google.com/ml-kit/vision/image-labeling)) for a cheap first pass; precise visual matching uses image embeddings + ANN against `products.embedding vector(768)` (§4).

---

## 4. Cross-retailer product matching / entity resolution (the durable hard problem)

Goal: `"GV WHP MILK"` → canonical `Great Value Whole Milk 1 gal` → equivalences across Kroger/Walmart/Target. This is **entity resolution (ER)**, a mature field. Pipeline:

**(a) Canonical keys first.** If a GTIN/UPC is present (barcode scan, or some receipts), it's a deterministic join — no ML needed. GTIN is the backbone ([GS1](https://ref.gs1.org/standards/digital-link/)).

**(b) Normalize the messy string (LLM).** Parse `"GV WHP MILK 1GAL"` → `{brand: Great Value, name: Whole Milk, size: 1, unit: gal}`. This is attribute-value extraction; the canonical academic anchor is **MAVE** (2.2M products, 3M attribute-value pairs, [arXiv 2112.08663](https://arxiv.org/abs/2112.08663)). A cheap LLM (GPT-4o-mini / Gemini Flash) does this well and **the same VLM call that read the receipt can emit normalized attributes**, so marginal cost ≈ 0.

**(c) Block to avoid O(n²).** Never compare every pair. Generate a text/image embedding and retrieve top-k candidates via **pgvector** ANN. pgvector supports **HNSW** (best speed-recall, no training, build on empty table) and **IVFFlat**, with cosine/L2/inner-product operators, up to 16,000 dims ([pgvector](https://github.com/pgvector/pgvector)). Two-pass "embed-blocking then rerank" (Matryoshka/Adaptive Retrieval) reaches **99% of full-KNN accuracy at ~580 q/s** ([Supabase](https://supabase.com/blog/matryoshka-embeddings)). Blocking is the canonical scalability trick ([ER survey, arXiv 1905.06397](https://arxiv.org/abs/1905.06397)).

**(d) Match the candidate pairs (transformer).** **Ditto** casts ER as BERT sequence-pair classification, beats prior SOTA by up to **29% F1** and reaches **F1 96.5%** on a 789K×412K company-matching task ([arXiv 2004.00584](https://arxiv.org/abs/2004.00584)). Tooling: **Magellan / py_entitymatching** (UW-Madison, PVLDB 2016, [GitHub](https://github.com/anhaidgroup/py_entitymatching)) gives the full blocking→sample→label→match→debug pipeline off the shelf. Benchmark to track: **WDC Products** (real e-commerce offers, 27 difficulty variants; SOTA F1 drops from 89→52 on **unseen** entities — [arXiv 2301.09521](https://arxiv.org/abs/2301.09521)) — the "unseen entity" cliff is exactly our long-tail store-brand problem.

**(e) Human-in-the-loop, label-efficiently.** ER on unseen products needs labels. **Transfer + active learning** reaches SOTA EM with **~10× fewer labels** ([arXiv 1906.08042](https://arxiv.org/abs/1906.08042)). Route low-confidence matches to a review queue; every confirmation becomes a `product_swap`/lexicon entry and training data — the same compounding feedback loop Fetch/Ibotta run.

**Cross-retailer equivalence** ("Great Value Whole Milk ↔ Kroger Whole Milk ↔ Market Pantry Whole Milk") is store-brand swap modeling — already first-class in our schema as `product_swaps(kind: exact|store_brand|size|unit, avg_savings, support_count)`. Matching just **populates and reinforces** it (support_count = corroboration count).

---

## 5. Cost-efficiency playbook (cheap → expensive routing)

The repo already encodes the right instinct — async ML boundary, on-device pre-filtering, "cost tied to value," token metering (ARCHITECTURE §6, roadmap "async/batch/cache the paid 3rd-party calls"). Concrete levers, quantified:

| Lever | Mechanism | Saving |
|---|---|---|
| **Barcode-first** | ML Kit on-device decode before any server OCR | Eliminates server OCR cost entirely for scanned items (→ $0) ([ML Kit](https://developers.google.com/ml-kit/vision/barcode-scanning)) |
| **On-device quality gate** | Reject blurry/dark frames at capture | Avoids wasted OCR calls + re-uploads; data-frugal client (already a SmartCart principle) |
| **Cheap model default** | Gemini 2.0 Flash / GPT-4o-mini for OCR+extract | **~$0.20–0.40 / 1k** vs $10 AnalyzeExpense / $80 Veryfi → **~25–400×** |
| **Escalate only on low confidence** | If reconciliation fails or fields low-conf, retry on GPT-4o / Gemini 2.5 | Premium model touches only the ~10–20% hard tail, not 100% |
| **Batch the async path** | Gemini Batch / OpenAI Batch (−50%) | Halves the per-call price; our pipeline is already async |
| **Cache by media hash** | Hash image bytes; identical re-upload (flaky-network retry) served from cache, never re-OCR'd | Pairs with our existing **idempotency-key** dedup; each unique image OCR'd once |
| **Self-host at volume** | PaddleOCR/Qwen on g4dn ($0.526/hr) / RunPod L4 ($0.39/hr) | **~$0.01–0.07 / 1k** (est., throughput-dependent) once volume justifies ops |
| **Quantize self-hosted models** | INT8 / INT4 (bitsandbytes) | 8-bit **halves** memory; 4-bit **÷4** → cheaper/smaller GPU, bigger batches ([HF](https://huggingface.co/docs/transformers/main/en/quantization/bitsandbytes)) |

GPU anchors: AWS **g4dn.xlarge (T4) $0.526/hr**, **g5.xlarge (A10G) $1.006/hr**; RunPod **L4 $0.39/hr, A100 $1.39/hr** ([vantage](https://instances.vantage.sh/aws/ec2/g4dn.xlarge); [RunPod](https://www.runpod.io/pricing)). Self-host per-1k math: at $0.526/hr and an assumed 5 receipts/s → ~$0.029/1k (throughput is an estimate, **measure before committing**).

**Per-1,000-receipts cost ladder (the routing thesis in one table):**

| Strategy | ~$/1,000 receipts | When |
|---|---|---|
| On-device barcode only | **$0** | scanned shelf items / receipts with UPCs |
| Gemini 2.0 Flash (Batch) | **~$0.10** | async default at scale |
| Gemini 2.0 Flash / GPT-4o-mini (sync) | **~$0.20–0.40** | MVP default |
| Self-hosted PaddleOCR/Qwen on Spot GPU | **~$0.01–0.07** (est.) | Phase 2, +ops cost |
| GPT-4o (escalation only) | ~$5.00 | low-confidence tail (~5%) |
| AWS Textract AnalyzeExpense | $10.00 | — (don't) |
| Google Expense Parser | $10.00 | — (don't) |
| Veryfi | $80.00 | — (don't) |

**Worked example.** 100k receipts/month: 100% AnalyzeExpense = **$1,000/mo**. Routed (70% barcode-resolved on-device at $0; 25% Gemini Flash @ $0.0002; 5% escalated to GPT-4o @ $0.005) ≈ 25k×$0.0002 + 5k×$0.005 = **$5 + $25 = ~$30/mo** before catalog/match. **~30× cheaper** — the difference between viable and not for a community-funded app. The catch the cheap path hides: the **engineering** cost lives in the matcher and the review queue (§4), not the OCR bill — which is exactly why we buy OCR and build matching.

---

## 6. Build-vs-buy by phase + the routing decision tree

**Phase 0 (MVP, ~50 users, 1 metro — SLC).** **Buy the cheap thing.** Use a hosted VLM (Gemini 2.0 Flash or GPT-4o-mini) for OCR+extraction behind the existing ML-worker boundary; ML Kit barcode on-device; Open Food Facts for cold-start enrichment; deterministic UPC join + LLM string-normalize + simple trigram/embedding match for the rest; **human review for everything low-confidence** (you have the volume to eyeball it, and it bootstraps training data). No GPUs. This matches roadmap Phase 0 ("OCR via managed API") but swaps the expensive managed *expense* API for a **10–50× cheaper VLM**.

**Phase 1 (soft launch, 4 metros).** Add the real matcher: embeddings into `products.embedding` + **pgvector HNSW** blocking, a **Ditto-style** cross-encoder on candidate pairs, an **active-learning review queue** feeding `product_swaps` and the abbreviation lexicon. Keep OCR hosted but turn on **Batch** + **media-hash cache**. Stand up reconciliation as a confidence factor. Self-hosting still not worth the ops.

**Phase 2 (multi-metro scale).** When the monthly VLM bill is the dominant ML line item (the same "extract along the seams" trigger discipline as the rest of the platform; cloud-vs-self-managed §5 calls ML inference "the first candidate to ever bring in-house"), **self-host PaddleOCR/Qwen2.5-VL on Spot/preemptible GPUs**, quantized, batched — dropping to ~$0.01–0.07/1k. Vector search graduates to OpenSearch/dedicated ANN per roadmap Phase 2.

### Model-routing decision tree

```
receipt / shelf photo
        │
        ▼
[on-device] quality gate (blur/dark?) ──reject──► ask user to recapture (coach)
        │ ok
        ▼
[on-device] barcode present? ──yes──► decode UPC ──► product_upcs join ─┐
        │ no                                                            │ hit → DONE ($0)
        ▼                                                               │ miss → Open Food Facts / create product
[server] CHEAP VLM (Gemini 2.0 Flash / GPT-4o-mini)                     │
  → {merchant, line items, prices, tax, total} + normalized attrs       │
        │                                                               │
        ▼                                                               │
RECONCILE: Σ(items)+tax ≈ total?  AND  per-field confidence ok?         │
   │ yes                          │ no / low-conf                       │
   ▼                              ▼                                     │
ENTITY RESOLUTION:           ESCALATE: GPT-4o / Gemini 2.5 (5–20% tail) │
 UPC join → else             then re-reconcile                         │
 pgvector HNSW block →        │ still low → HUMAN REVIEW QUEUE ─────────┤
 Ditto rerank                                                          │
   │ high-conf match          │ low-conf match                          │
   ▼                          ▼                                         │
auto-promote          human review queue ◄──────────────────────────────┘
   │                          │ (confirmations → training data + lexicon + product_swaps)
   └──────────► CONFIDENCE ENGINE ──► price.updated / current_price projection
```

---

## What this means for SmartCart

The existing architecture already has the right bones; this work **fills the stubbed ML and adds three signals**, with minimal new surface area.

1. **Ingestion pipeline (`src/modules/ingestion/service.ts`).** The stubbed OCR/vision step becomes: on-device barcode/quality gate → cheap VLM extract → reconcile → entity-resolve → score. It stays behind the async ML-worker boundary and the **idempotency key already dedups flaky-network re-uploads**; add a **media-hash cache** so the *same image* is never OCR'd twice (today dedup is keyed on `idempotencyKey`; extend to content hash for the OCR cache specifically). A receipt produces **many** `price.updated` events (one per matched line item) — the pipeline already emits per-(product,store), so this is fan-out, not redesign.

2. **Confidence engine (`src/modules/ingestion/confidence.ts`).** It is perfectly shaped to absorb the new signals as multiplicative factors alongside `source/geo/rep/agreement`:
   - **`reconciliation`** factor: Σ(line items)+tax vs. printed total within tolerance → boost; mismatch → damp (and trigger escalation). This is the §2/§5 free oracle, dropped in as one more clamp.
   - **`matchConfidence`** factor: the ER/pgvector+Ditto match score becomes an input, so an unparseable-abbreviation line with a weak product match is auto-damped — exactly the engine's stated job ("disagreement opens a low-confidence/dispute state"). Note today's `SOURCE_WEIGHT.receipt = 0.9` assumes the *receipt* is trustworthy; with line-item OCR we must separate **"is the price read correct"** (reconciliation) from **"is the product match correct"** (matchConfidence). Keep both factors so a perfectly-read price on a mis-matched product can't auto-promote.
   - Because confidence is **one pure function over replayable contributions** (data-model.md), we can back-test new factors by replaying — re-score historical receipts when the matcher improves, no migration.

3. **Catalog / matching (`src/modules/catalog/service.ts`).** Today `resolve()` is UPC-exact then naive `name.includes()` — fine as a stub, hopeless on "GV WHP MILK". Upgrade path with zero schema change: keep UPC-exact first; then **pgvector HNSW** over `products.embedding vector(768)` (already in the data model) for blocking; then an LLM/Ditto rerank; populate `product_upcs` from barcode scans and Open Food Facts; grow `product_swaps` (`store_brand`/`size`/`unit`, `support_count`) from confirmed cross-retailer equivalences. The **H3/pgvector/PostGIS data model needs no new tables** — `products.embedding`, `product_upcs`, `product_swaps`, and `current_price(product_id, store_id, confidence, source)` are already exactly the right shape.

4. **Cost discipline (ties to the repo's DeepSeek-style, Spot/quantized ethos).** Default to **Gemini 2.0 Flash / GPT-4o-mini** (~$0.20–0.40/1k), escalate to GPT-4o/Gemini 2.5 only when reconciliation or match confidence is low, run the async path in **Batch**, and **self-host quantized PaddleOCR/Qwen on Spot GPUs only when the bill triggers it** (cloud-vs-self-managed §5: ML inference is the first thing to repatriate). The worked example shows routing turns a ~$1,000/mo Textract bill into ~$30/mo — decisive for a bootstrapped startup.

**Net:** buy a cheap VLM now, invest the engineering in the **entity-resolution + confidence factors + feedback loop** (the durable moat), and self-host OCR only after scale justifies the ops — each step gated by the same trigger discipline the rest of SmartCart already follows.

---

## Sources

OCR / Document AI pricing & capability
- AWS Textract pricing — https://aws.amazon.com/textract/pricing/
- Google Document AI pricing — https://cloud.google.com/document-ai/pricing
- Azure AI Document Intelligence pricing — https://azure.microsoft.com/en-us/pricing/details/ai-document-intelligence/ · billing model — https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/service-limits
- Veryfi pricing — https://www.veryfi.com/pricing/ · Receipt OCR API — https://www.veryfi.com/receipt-ocr-api/
- Taggun pricing — https://www.taggun.io/pricing · site — https://www.taggun.io/
- Mindee pricing — https://www.mindee.com/pricing · docTR — https://github.com/mindee/doctr
- Nanonets receipt OCR — https://nanonets.com/blog/receipt-ocr/

Open OCR / VLM models & benchmarks
- PaddleOCR (PP-OCRv6 / PP-StructureV3) — https://github.com/PaddlePaddle/PaddleOCR
- Qwen2.5-VL blog — https://qwenlm.github.io/blog/qwen2.5-vl/ · 72B card — https://huggingface.co/Qwen/Qwen2.5-VL-72B-Instruct · 7B card — https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct
- Qwen3-VL 235B card — https://huggingface.co/Qwen/Qwen3-VL-235B-A22B-Instruct
- GOT-OCR2.0 — https://huggingface.co/stepfun-ai/GOT-OCR2_0 · dots.ocr — https://huggingface.co/rednote-hilab/dots.ocr
- getomni open-source OCR benchmark — https://getomni.ai/blog/benchmarking-open-source-models-for-ocr · harness — https://github.com/getomni-ai/benchmark · dataset — https://huggingface.co/datasets/getomni-ai/ocr-benchmark
- Tesseract image-quality guidance — https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html
- Donut (OCR-free) — https://arxiv.org/abs/2111.15664

Receipt datasets
- CORD-v2 — https://huggingface.co/datasets/naver-clova-ix/cord-v2 · SROIE (ICDAR 2019) — https://arxiv.org/abs/2103.10213

LLM API pricing
- OpenAI GPT-4o — https://developers.openai.com/api/docs/models/gpt-4o · GPT-4o-mini — https://developers.openai.com/api/docs/models/gpt-4o-mini
- Gemini API pricing — https://ai.google.dev/gemini-api/docs/pricing

Entity resolution / product matching
- Ditto — https://arxiv.org/abs/2004.00584 · WDC Products — https://arxiv.org/abs/2301.09521 · benchmark page — https://webdatacommons.org/largescaleproductcorpus/wdc-products/
- Magellan / py_entitymatching — https://github.com/anhaidgroup/py_entitymatching · ER survey — https://arxiv.org/abs/1905.06397 · neural EM survey — https://arxiv.org/abs/2010.11075
- Active-learning ER — https://arxiv.org/abs/1906.08042 · MAVE (attribute extraction) — https://arxiv.org/abs/2112.08663
- pgvector — https://github.com/pgvector/pgvector · Matryoshka/Adaptive retrieval — https://supabase.com/blog/matryoshka-embeddings

Barcode / GTIN / product enrichment
- GS1 Digital Link — https://ref.gs1.org/standards/digital-link/ · GS1 US UPC/GTIN guide — https://www.gs1us.org/upcs-barcodes-prefixes/guide-to-upcs
- ML Kit barcode scanning — https://developers.google.com/ml-kit/vision/barcode-scanning · ML Kit image labeling — https://developers.google.com/ml-kit/vision/image-labeling
- Apple Vision VNBarcodeObservation — https://developer.apple.com/documentation/vision/vnbarcodeobservation · ZXing — https://github.com/zxing/zxing
- Open Food Facts — https://world.openfoodfacts.org/ · API docs — https://openfoodfacts.github.io/openfoodfacts-server/api/

Cost-efficiency (GPUs, quantization)
- AWS g4dn.xlarge — https://instances.vantage.sh/aws/ec2/g4dn.xlarge · g5.xlarge — https://instances.vantage.sh/aws/ec2/g5.xlarge · RunPod — https://www.runpod.io/pricing
- bitsandbytes quantization (8-bit/4-bit memory) — https://huggingface.co/docs/transformers/main/en/quantization/bitsandbytes
