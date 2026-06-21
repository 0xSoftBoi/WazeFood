# Protecting the Data Graph — The Proper Anti-Scraping Solution

SmartCart's crowdsourced price graph **is the company** (every doc calls it the moat), so
"protect the data graph" deserves the real, production-grade answer rather than the naive
per-device rate limit in the scaffold today. This memo researches how serious operators stop
scraping/bulk-extraction, then says exactly what a bootstrapped SmartCart should **buy vs build**.

## 1. Threat model — name the threats (OWASP)

Use the **OWASP Automated Threats to Web Applications (OAT)** taxonomy as the shared model; it's
the canonical list and maps cleanly onto SmartCart
([OWASP OAT project](https://owasp.org/www-project-automated-threats-to-web-applications/)):

| OAT | Threat | SmartCart exposure |
|---|---|---|
| **OAT-011 Scraping** | Harvesting data via automated requests | Competitors extracting the price graph — the primary risk ([OAT-011](https://owasp.org/www-project-automated-threats-to-web-applications/assets/oats/EN/OAT-011_Scraping)) |
| **OAT-021 Denial of Inventory** | Enumerating/exhausting catalog | Mapping every product×store×cell |
| **OAT-003/004 Credential cracking/stuffing** | Account takeover | Account-gated data + referral rewards |
| **OAT-012 / fake content** | Fake submissions | Poisoning the confidence engine (already defended via geofence + reputation + Sybil controls) |

Scraping is also #4-ranked in the **OWASP API Security** context, and the consensus across vendor
research (Imperva, Cequence, DataDome, Fastly) is the same: **no single signal works** — modern
scrapers rotate residential proxies and inject behavioral variance, so defense must be **layered
and behavioral**, not IP/rate alone ([Fastly bot-management roundup](https://www.fastly.com/blog/best-bot-management-solutions-2025-2026), [Cequence content-scraping](https://www.cequence.ai/solutions/preventing-content-scraping/)).

## 2. The proper solution = defense in depth (6 layers)

### Layer 1 — Edge (network/transport)
Anycast CDN + WAF absorbing volumetric attacks and scoring every request before origin.
**TLS fingerprinting (JA3 → JA4)** is the current state of the art: a hash of the TLS handshake
(cipher suites, extensions, ALPN, TCP options) that stays stable across rotating IPs and
distinguishes browsers from scripted clients; adopted in 2025 by Cloudflare, AWS, VirusTotal
([Cloudflare JA4 signals](https://blog.cloudflare.com/ja4-signals/), [JA3/JA4 docs](https://developers.cloudflare.com/bots/additional-configurations/ja3-ja4-fingerprint/)).
Cloudflare emits a **bot score 1–99** from layered detectors that the origin acts on
([bot-management variables](https://developers.cloudflare.com/bots/reference/bot-management-variables/)).

### Layer 2 — Attestation (prove a real app on a real device)
For the read path behind the mobile app, **device/app attestation** is the highest-leverage
control — it removes the easy "script it from a laptop" path:
- **Android: Play Integrity API** (replaces SafetyNet). Verify `appRecognitionVerdict =
  PLAY_RECOGNIZED`, `appLicensingVerdict = LICENSED`, and a **nonce/requestHash** to stop replay
  ([Play Integrity overview](https://developer.android.com/google/play/integrity/overview)).
- **iOS: Apple App Attest / DeviceCheck** with hardware-bound keys; the app registers a key, the
  backend verifies the attestation, then verifies **signed assertions** on sensitive requests
  ([Apple App integrity](https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity)).
- **Web / privacy-preserving: Private Access Tokens** (Privacy Pass / RFC 9711 EAT). The OS
  manufacturer attests device health; the site learns only URL+IP, the attester never learns the
  site — a CAPTCHA-less, privacy-respecting check, with **Turnstile / proof-of-work** as fallback
  ([Cloudflare PATs](https://blog.cloudflare.com/eliminating-captchas-on-iphones-and-macs-using-new-standard/), [Turnstile](https://blog.cloudflare.com/turnstile-private-captcha-alternative/)).
- **Caveat (cited honestly):** attestation tokens **can be harvested from real devices**, so it
  raises cost, it doesn't end abuse — pair it with the other layers and a **phased rollout:
  monitor → warn → enforce → tighten** ([attestation best-practice summary](https://medium.com/@balwant.matharu/enhancing-app-security-protecting-unauthenticated-apis-with-app-attest-and-play-integrity-apis-80df0247d2ad)).

### Layer 3 — Multi-dimensional rate limiting / quota
Limit on **several keys at once** — per IP, per account, per device, per endpoint — because any
single key is evadable. Algorithm choice ([Arcjet comparison](https://blog.arcjet.com/rate-limiting-algorithms-token-bucket-vs-sliding-window-vs-fixed-window/), [SlashID GCRA](https://www.slashid.dev/blog/id-based-rate-limiting/)):
- **GCRA** (leaky-bucket variant): tiny memory, computes a "theoretical arrival time," atomic via
  a single **Redis Lua** script — the production default for distributed limits.
- **Sliding-window counter:** the practical accuracy/cost compromise; avoids the fixed-window
  boundary-burst bug (an attacker doubling the limit around the reset).
- **Token bucket:** when you want strict average but tolerate short bursts.

### Layer 4 — Behavioral bot scoring
Score sessions on **interaction entropy, timing, and navigation patterns**; throttle/tarpit or
challenge above a threshold rather than hard-blocking ([behavioral scoring](https://datadome.co/anti-detect-tools/behavioral-bot-classification/), [getstream](https://getstream.io/blog/bot-detection-moderation/)).
The domain-specific signal that matters most for SmartCart:
- **Geo-coherence / impossible travel:** a real shopper queries a handful of products near *one*
  area; an account hitting **many distinct products across many distant H3 cells** is extraction,
  not shopping. This is a high-signal, low-false-positive feature unique to our data.
- **Breadth-vs-depth:** humans = few products, repeated; scrapers = enumerate many, never write.

### Layer 5 — Data-graph deception + API shape (the moat-specific layer)
This is what no vendor can do for you because it's domain-specific:
- **No bulk through consumer APIs.** Responses are coarse and *require* a specific product +
  location; there is **no "dump all prices in this cell"** endpoint, result sizes are capped, and
  the `kRing` radius is bounded. (SmartCart's read API is already shaped this way.)
- **Honeytokens / canary records.** Seed **fake "canary" products/prices** that only an enumerator
  would ever touch; any query/use of a canary flags the account and — via per-account
  perturbations (**data watermarking**) — lets you trace *which* account leaked a dataset
  (CanaryTrap-style) ([OWASP WebApp Deception](https://owasp.org/www-community/controls/WebAppDeception), [honeytokens guide](https://www.securityengineering.dev/the-beginners-guide-to-honeytokens-aka-canary-tokens/), [CanaryTrap paper](https://arxiv.org/pdf/2006.15794)).
- **Bulk is a separate licensed B2B product**, never an accidental consumer export (the brain
  dump's explicit guidance).

### Layer 6 — Governance & response
Phased enforcement (monitor→warn→enforce), anomaly alerts → manual review → ban, and the abuse
KPIs landing in the warehouse next to the growth KPIs. Never hard-block on one signal (low-end
Android shoppers are the core user and must not be punished).

## 3. Buy vs build (for a bootstrapped startup)

Per [`cloud-vs-self-managed.md`](../cloud-vs-self-managed.md): **don't build a bot-management
vendor.** The right split:

| Layer | Decision | Why |
|---|---|---|
| 1 Edge (JA4, WAF, DDoS, bot score) | **Buy** (Cloudflare/Fastly) | Hundreds of engineer-years; an API call for you |
| 2 Attestation | **Adopt** (Play Integrity, App Attest, PAT/Turnstile) | Platform-provided; phased rollout |
| 3 Rate limiting | **Build thin** on Redis (GCRA/sliding-window) or use edge | Cheap, atomic Lua |
| 4 Behavioral (geo-coherence) | **Build** | Domain-specific; the highest-signal feature is ours |
| 5 Data-graph deception + API shape | **Build** | No vendor knows our graph |
| 6 Governance | **Build thin** | KPIs + manual-review queue |

## 4. What SmartCart builds now (grounded, verifiable)

The edge/attestation layers are config + platform SDKs (deferred to deployment). The
**domain-specific core is what we implement in the gateway** — and it's fully testable offline:

1. **Multi-dimensional abuse scoring** on device + account + endpoint + window (sliding-window
   counters in the existing cache; GCRA at the edge later).
2. **H3 geo-coherence** — track an account's recent distinct cells; score up on wide, scattered
   spread (the impossible-travel signal).
3. **Honeytoken canaries** — seeded canary products; any read/resolve that touches one is an
   instant high-confidence extractor flag.
4. **Score → decision** (`allow | challenge | throttle | block`) with **phased enforcement** (a
   monitor mode that scores and logs without blocking), reasons attached for the review queue.
5. **Metrics** to `/metrics` (and later the warehouse): scored requests, decisions, canary hits.

This upgrades the gateway from "naive per-device rate limit" to a real, layered, score-based
guard — the piece a vendor can't supply — while we **buy** the edge and **adopt** attestation.

## 5. What NOT to do
- Don't rely on a single signal (IP or rate) — proven evadable.
- Don't hard-block on one strike; **score + phase + challenge** (protect real low-end-Android users).
- Don't sell location/receipt data or run your own dynamic pricing — it detonates the very
  surveillance-pricing narrative SmartCart launches on (see the market memo).
- Don't reinvent edge bot-management or attestation — buy/adopt the proven platforms.

---

## Sources
- OWASP — [Automated Threats project](https://owasp.org/www-project-automated-threats-to-web-applications/) · [OAT-011 Scraping](https://owasp.org/www-project-automated-threats-to-web-applications/assets/oats/EN/OAT-011_Scraping) · [WebApp Deception (honeytokens)](https://owasp.org/www-community/controls/WebAppDeception)
- Edge / fingerprinting — [Cloudflare JA4 signals](https://blog.cloudflare.com/ja4-signals/) · [JA3/JA4 docs](https://developers.cloudflare.com/bots/additional-configurations/ja3-ja4-fingerprint/) · [bot-management variables](https://developers.cloudflare.com/bots/reference/bot-management-variables/) · [Fastly bot solutions](https://www.fastly.com/blog/best-bot-management-solutions-2025-2026) · [Cequence content scraping](https://www.cequence.ai/solutions/preventing-content-scraping/)
- Attestation — [Android Play Integrity](https://developer.android.com/google/play/integrity/overview) · [Apple App Attest](https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity) · [Cloudflare Private Access Tokens](https://blog.cloudflare.com/eliminating-captchas-on-iphones-and-macs-using-new-standard/) · [Turnstile](https://blog.cloudflare.com/turnstile-private-captcha-alternative/) · [attestation best practices](https://medium.com/@balwant.matharu/enhancing-app-security-protecting-unauthenticated-apis-with-app-attest-and-play-integrity-apis-80df0247d2ad)
- Rate limiting — [Arcjet algorithms](https://blog.arcjet.com/rate-limiting-algorithms-token-bucket-vs-sliding-window-vs-fixed-window/) · [SlashID GCRA](https://www.slashid.dev/blog/id-based-rate-limiting/) · [Redis + Lua](https://blog.callr.tech/rate-limiting-for-distributed-systems-with-redis-and-lua/)
- Behavioral / deception — [DataDome behavioral classification](https://datadome.co/anti-detect-tools/behavioral-bot-classification/) · [GetStream bot detection](https://getstream.io/blog/bot-detection-moderation/) · [honeytokens guide](https://www.securityengineering.dev/the-beginners-guide-to-honeytokens-aka-canary-tokens/) · [CanaryTrap](https://arxiv.org/pdf/2006.15794)
