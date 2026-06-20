# Price Data Sourcing & the Competitive Landscape — A Founder/Staff-Engineer Memo

> **Thesis for the impatient:** SmartCart's "Waze for grocery prices" pitch is only as
> good as its **price graph**, and the price graph is the single hardest, riskiest,
> most expensive thing we are building. Crowdsourcing is the right *long-run* moat and
> the *wrong* cold-start primitive. Every serious player in this space is a hybrid —
> they crowdsource *one* signal and buy/scrape/partner for the rest. We should too, and
> we should be ruthlessly honest that the receipt-OCR + shelf-photo bet is a 2-year
> data-quality grind, not a launch feature.
>
> Date: June 2026. Author: research pass for the SmartCart core team. Every nontrivial
> claim below is cited inline; full list in [Sources](#sources). Where a primary source
> (FTC, retailer dev portals) blocked automated retrieval, that is flagged explicitly.

---

## 0. How to read this memo

The product brief says the data graph **is** the company, that competitors will try to
extract it, and that the "surveillance pricing" narrative is something the product
*fights* ([ARCHITECTURE.md §8](../ARCHITECTURE.md)). This memo pressure-tests those
claims against how the incumbents actually source data, what the law actually permits,
and where the cold-start math actually breaks. It ends with a ranked, phase-by-phase
sourcing plan tied to the existing modular-monolith architecture.

A recurring theme: **nobody runs on a single source.** The apps that look like pure
crowdsourcing (Basket, GasBuddy) quietly blend in retailer feeds and online data; the
apps that look like clean retailer partnerships (Flipp, Ibotta) are sitting on top of a
receipt/behavior panel they monetize separately. The defensible position is the *graph
that fuses all of them with confidence scoring* — which is, conveniently, exactly the
shape of [§4.4 Crowdsource Ingestion & Confidence Engine](../ARCHITECTURE.md).

---

## 1. Price-data sourcing strategies

Five viable strategies, each scored on **cost**, **coverage**, **freshness**,
**legal/ToS risk**, and **defensibility**. Summary table first, then the detail and the
skeptical notes.

| Strategy | Cost | Coverage | Freshness | Legal/ToS risk | Defensibility | Verdict for SmartCart |
|---|---|---|---|---|---|---|
| Crowdsourced receipts + shelf photos + manual reports | Low $ / high ops + OCR | Sparse→dense, follows users | Excellent *where dense* | Low (own users) but **privacy/biometric** exposure | **High** — compounding graph | Core long-run bet; weak at t=0 |
| Retailer APIs / loyalty APIs | Low–med | Deep but **partner-gated** | Excellent | Low if licensed; **revocable** | Low (anyone can license) | Buy where available (Kroger), don't depend on |
| Circular / weekly-ad aggregators (Flipp/Wishabi) | Med (license) | Broad **promo** prices only | Weekly | Low (provided data) | Low–med | Buy for **seed**, not base prices |
| Web scraping (Kroger/Walmart/Target/Instacart) | Med–high (anti-bot) | Deep online prices | Good | **Medium–high & shifting** | Low | Tactical, hedged, never the public story |
| 3rd-party panels / brokers (Numerator, Circana, NielsenIQ) | **High $$$** | National, deep | Weekly/monthly | Low | Low (it's a product) | Benchmark/validation, not real-time |

### 1.1 Crowdsourced receipts + shelf photos + manual reports — the SmartCart bet

This is the bet, so be honest about who has actually made it work and how.

**Basket** is the closest pure analog and the most instructive. Basket explicitly sources
prices "**through crowd-sourcing, our community of shoppers [who] share real-time prices on
products and inventory**" across Costco, Kroger, Walmart, Publix, Target, Whole Foods and
"hundreds more" ([basketsavings.com](https://basketsavings.com/)). By 2018 the founder
Neil Kataria reported **~500,000 users who had added ~16 billion dynamic prices across
~170,000 stores**, and described prices varying **30–40% week to week** — the variance
that makes the product valuable and the freshness that makes it hard
([Washington Life, Aug 2018](https://washingtonlife.com/innovators-grocery-shopping-that-makes-cents/)).
Crucially, Basket built a **B2B data-intelligence business** selling shopper-pricing data
to retailers and CPG brands on top of the consumer app — "they absolutely need more data
intelligence" ([PYMNTS, Apr 2018](https://www.pymnts.com/news/retail/2018/basket-online-grocery-shopping/)).
**The lesson:** even the purest crowdsourced grocery-price app monetizes the *graph*, not
the app — and Basket is not a household name a decade later, which tells you crowdsourced
grocery pricing is a slow-compounding, capital-patient game, not a viral one.

**Fetch and Ibotta** are the proof that the *incentive* works at scale — but note **what**
they actually collect. They do not crowdsource shelf prices; they crowdsource **receipts**
(proof-of-purchase) in exchange for points/cash, and turn the resulting purchase panel into
a brand-funded performance-marketing business. Fetch reports **12.5M+ active users**, has
"**paid out over a billion in rewards**," and raised **$500M+**
([FinanceBuzz](https://financebuzz.com/how-does-fetch-rewards-make-money)). Ibotta has paid
**$1.5B+ in cash rewards to 50M+ consumers** since founding and IPO'd in April 2024 at $88
([Wikipedia: Ibotta](https://en.wikipedia.org/wiki/Ibotta)). **The lesson for SmartCart's
incentive design:** users will scan receipts in enormous volume *if you pay them*, and the
unit you pay for is the receipt, not the price-point. SmartCart's karma/earned-Premium loop
([§4.9](../ARCHITECTURE.md)) is the right shape, but it competes for the same scanning
behavior against companies that hand out literal cash.

- **Cost:** the *acquisition* of a price point is cheap (a user's photo), but the *true*
  cost is OCR/vision (every receipt and shelf tag is an OCR call), dedup, and confidence
  scoring. OCR on clean Latin text is still only **~81–99% accurate** and *word* error rates
  compound ([Wikipedia: OCR](https://en.wikipedia.org/wiki/Optical_character_recognition)) —
  and grocery receipts are faded thermal paper with abbreviated SKUs, the adversarial case.
  Budget for a long tail of "couldn't parse" and a human-review DLQ, exactly as
  [§4.4](../ARCHITECTURE.md) already provisions.
- **Coverage:** follows your users. This is the cold-start killer (see [§4](#4-cold-start)).
- **Freshness:** *excellent where dense, garbage where sparse.* A price with no recent
  corroboration is a liability, which is why the architecture is right to carry
  `confidence` + `as_of` to the UI on every price ([§3 constraint 3](../ARCHITECTURE.md)).
- **Legal/ToS risk:** low on the access side (it's your own users' data), but **high on the
  privacy side** — receipts and location are sensitive; see [§5](#5-legal--privacy).
- **Defensibility:** **the highest of any strategy.** A receipt + shelf-photo + correction
  graph with reputation-weighted confidence is genuinely hard to copy, because the moat is
  the *contributor network*, not the bytes. This is the only sourcing strategy on the table
  that compounds.

### 1.2 Retailer APIs / affiliate feeds / loyalty APIs

Some retailers expose product/price data programmatically. **Kroger operates a public
developer API** (developer.kroger.com — *the portal returns HTTP 403 to automated clients,
which is itself the point*) with Products, Locations, and Cart endpoints; the Products API
returns location-specific item and promo prices under a rate-limited, ToS-bound license.
Walmart and others run affiliate/marketplace catalog feeds. **This is the cleanest data you
can get** — authoritative, fresh, structured — but:

- It is **partner-gated and revocable.** The retailer can throttle, change terms, or cut you
  off the day you compete with them. Building base coverage on a competitor's API is building
  on rented land.
- It is **not a moat.** Anyone can sign up. If your pricing edge is "we resell Kroger's API,"
  you have no edge.
- **Verdict:** *buy it where it's free and clean (Kroger), use it to seed and to validate
  crowdsourced data, never let it become load-bearing.* Treat each retailer API as one more
  `source` feeding the confidence engine ([current_price.source](../docs/data-model.md)),
  not as the source of truth.

### 1.3 Circular / weekly-ad (circular) aggregators — Flipp / Wishabi

**Flipp** (built by Wishabi) is the dominant digital-circular platform: "**Browse weekly
digital flyers from retailers near you**," covering "**over 2,000 stores**"
([flipp.com](https://flipp.com/)). The key fact: Flipp's flyer data is **provided by the
retailers and brands themselves** as a retail-media channel — it is *supplied*, not scraped,
which is why it carries near-zero legal risk and why Flipp is fundamentally an **ad/retail-media
business**, not a price-intelligence business. Quotient/Coupons.com (now Neptune Retail
Solutions) plays the analogous role for digital coupons and promotions
([Wikipedia: Quotient](https://en.wikipedia.org/wiki/Coupons.com)).

- **Coverage caveat:** circulars only carry **promoted/sale prices**, not the everyday shelf
  price of the 40,000 SKUs in a store. They tell you eggs are on sale; they don't tell you
  the regular price of the other 90% of a cart.
- **Verdict:** **license a circular feed as a cold-start seed and as a deals layer**
  (it maps directly to the `deals` OpenSearch index and `deal.reported` event in
  [data-model.md](../docs/data-model.md)), but understand it is a *thin promotional veneer*,
  not base-price coverage. It makes a new metro look alive on day one; it does not make the
  graph deep.

### 1.4 Web scraping of retailer sites — the legally-loaded option

This is where founders get either over-confident or over-scared. The actual law (US) is
nuanced and **trending scraper-favorable on the federal-access question while leaving real
contract and tort exposure**:

- **CFAA / "unauthorized access":** *hiQ Labs v. LinkedIn* established that scraping
  **publicly available** data does not violate the CFAA; after the Supreme Court's
  *Van Buren* narrowing of "exceeds authorized access," the Ninth Circuit **reaffirmed** this
  in April 2022 ([Wikipedia: hiQ v. LinkedIn](https://en.wikipedia.org/wiki/HiQ_Labs_v._LinkedIn);
  [Wikipedia: Web scraping](https://en.wikipedia.org/wiki/Web_scraping)). **But** — and this
  is the part founders skip — the *same case* ended with a district court finding that **hiQ
  had breached LinkedIn's User Agreement**, followed by a settlement
  ([hiQ v. LinkedIn](https://en.wikipedia.org/wiki/HiQ_Labs_v._LinkedIn)). CFAA safe ≠ ToS safe.
- **The scraper-favorable trend** continued: in *Meta v. Bright Data* (Jan 2024) a federal
  judge held Bright Data **did not breach Meta's terms by scraping public Facebook/Instagram
  data**, and in *X Corp v. Bright Data* (May 2024) a judge dismissed X's claims, holding that
  scraping publicly accessible data is "**generally legal**" and that restricting it "**could
  lead to information monopolies**" ([Wikipedia: Bright Data](https://en.wikipedia.org/wiki/Bright_Data)).
- **The residual exposure** is **breach of contract (ToS)**, **trespass to chattels**, and
  **copyright**. Trespass requires showing **actual or threatened impairment** of the system,
  not mere use (*Intel v. Hamidi*); *eBay v. Bidder's Edge* and *Register.com v. Verio*
  granted injunctions where scraping **taxed server capacity**
  ([Wikipedia: Trespass to chattels](https://en.wikipedia.org/wiki/Trespass_to_chattels)).
  Translation: **scrape politely (low rate, public pages, no login, no server strain) and you
  are on defensible ground; scrape behind a login or hammer the servers and you are not.**
- **Anti-bot reality:** retailer sites sit behind commercial bot-mitigation — DataDome,
  Akamai, Imperva, and CAPTCHA layers — that are explicitly built to detect and block
  scrapers ([Wikipedia: Internet bot](https://en.wikipedia.org/wiki/Internet_bot)). Defeating
  these is an arms race with real and recurring cost (residential proxies, headless-browser
  farms, CAPTCHA-solving). It is operationally fragile and ethically/PR-awkward for a company
  whose entire brand is "we're on the consumer's side against opaque pricing."

**Verdict:** scraping of *public, logged-out* product pages is a legitimate **tactical hedge**
for filling online-price coverage and validating crowdsourced points — but it must be (a) rate-
polite, (b) public-only, (c) never the public narrative, and (d) firewalled from the B2B data
product. It is a means to seed and verify, **never the moat**, and it carries a permanent
ToS/injunction tail risk that compounds the moment you monetize the scraped data.

### 1.5 Third-party panels / data brokers — Numerator, Circana, NielsenIQ

The "just buy it" option. These are the giants of purchase-data measurement:

- **Numerator** runs an **OmniPanel** capturing "**2B+ shopping trips**" across "**44K+
  retailers**" with "**2,500+ psychographic & media attributes**," sold as "**zero-party,
  single-source consumer data**" to brands like P&G, Unilever, Albertsons
  ([numerator.com](https://www.numerator.com/)). Mechanically it is a **receipt panel** — the
  exact thing SmartCart proposes to crowdsource, already productized.
- **Circana** (the 2023 IRI + NPD merger) sells **point-of-sale tracking + consumer panel
  data** across 26 industries via its "Liquid Data" platform
  ([Wikipedia: Circana](https://en.wikipedia.org/wiki/Circana)).
- **NielsenIQ** runs the Homescan/National Consumer Panel plus **e-receipt panels** (via the
  2021 Rakuten Intelligence / Foxintelligence acquisitions), operating in 100+ countries
  ([Wikipedia: NielsenIQ](https://en.wikipedia.org/wiki/NielsenIQ)).

- **Cost:** enterprise six-to-seven-figure licenses. **Freshness:** weekly/monthly, not
  real-time-shelf. **Coverage:** national and deep, but **modeled/projected**, not "the actual
  shelf price at the Publix on Hillsboro Pike right now." **Defensibility:** none — it's a
  product anyone can buy.
- **Verdict:** **do not build on these for real-time pricing.** They are useful (later, with
  budget) as a **validation/benchmark** layer — "does our crowdsourced category inflation track
  Circana's?" — and as the comparable for the eventual Phase-3 B2B data product
  ([roadmap Phase 3](../docs/roadmap.md)). Notably, **Numerator is the competitor SmartCart's
  B2B arm will eventually face**, and it got there by paying for the receipts SmartCart wants
  users to contribute for karma. That asymmetry is the whole strategic question.

### 1.6 Receipt-OCR panels as a data source — what the incentive design reveals

Fetch and Ibotta are worth a second pass purely for **incentive mechanics**, because
SmartCart's contribution loop must compete with them:

- The reward unit is the **completed, verified purchase** (a scanned receipt or a linked
  loyalty/e-receipt), because that is what brands pay for. Ibotta's whole model is
  **"pay per sale, not per click or clip"** ([IPN](https://ipn.ibotta.com/resource-hub/looking-for-scale-the-ibotta-performance-network-now-reaches-100-of-walmart-customers)).
- Verification is **adversarial by design** — these companies assume fraud and build receipt
  authenticity checks, which is exactly why SmartCart's **geofence location-validation +
  Sybil/velocity defense** ([§4.4](../ARCHITECTURE.md)) is correctly first-class, not a bolt-on.
- The strategic tell: **receipts are worth real money to brands**, so SmartCart is asking users
  to donate (for karma) an asset that Ibotta pays cash for. That is sustainable only if
  SmartCart's *non-cash* value (savings, the list, the community status) is high enough to
  clear the bar — which is precisely the "would you be disappointed if it went away" learning
  goal in [Phase 0](../docs/roadmap.md). **Watch this metric like a hawk.**

---

## 2. Competitor teardown

For each: data model, how they get data, monetization, why they win/lose, and the explicit
SmartCart steal/avoid.

| Competitor | Core data | How sourced | Monetization | Win / Lose |
|---|---|---|---|---|
| **Flipp / Wishabi** | Weekly circulars, coupons | Retailer/brand **supplied** | Retail media / ads | Win: zero legal risk, 2,000+ stores. Lose: promo-only, no base price |
| **Basket** | Crowdsourced shelf/online prices | **Crowdsourced** + online | Consumer app + **B2B data** | Win: closest to our model. Lose: never scaled to fame |
| **Ibotta** | Receipts / purchases | **Crowdsourced receipts** (paid) | Brand CPS (IPN) | Win: cash loop, IPO. Lose: not a price-compare tool |
| **Fetch** | Receipts / purchases | **Crowdsourced receipts** (paid) | Brand insights + offers | Win: 12.5M users, habit. Lose: rewards, not prices |
| **Instacart** | Retailer catalog + prices | **Retailer partnerships** | Delivery fees + ads + **markups** | Win: real-time catalog. Lose: marks prices *up*, the villain in our story |
| **Capital One Shopping** | Online prices + coupons | Extension/crawl across 30k+ retailers | Affiliate / bank funnel | Win: frictionless. Lose: online-only, no grocery shelf |
| **GasBuddy** | Fuel prices | **Crowdsourced** + station feeds | Ads, data sales, payments | Win: *the* crowdsourcing analog. Lose: data-sale privacy scandal |
| **Waze** | Traffic / road events | **Crowdsourced** (active + passive) | Acquired by Google ($1.1B+) | Win: the playbook. Lose: nothing relevant |

**Flipp / Wishabi.** Data model = retailer-supplied digital flyers + coupons across **2,000+
stores** ([flipp.com](https://flipp.com/)). They win on legal cleanliness and retailer
relationships; they lose because they only have **promotional** prices and are really an
ad business. **Steal:** the deals/circular layer and the retailer-supplied feed as a seed.
**Avoid:** mistaking promo coverage for base-price coverage.

**Basket.** The mirror. Crowdsourced real-time prices + B2B data
([PYMNTS](https://www.pymnts.com/news/retail/2018/basket-online-grocery-shopping/),
[basketsavings.com](https://basketsavings.com/)). **Steal:** the exact "by shoppers, for
shoppers" sourcing + B2B monetization. **Avoid:** their failure to build a *retention/virality*
loop — they had the data thesis but never the Waze-style network gravity. SmartCart's
referral + gamification + Atozy distribution is the missing growth engine Basket lacked.

**Ibotta.** Receipt panel monetized as a brand performance network; **Walmart Cash** runs on
the IPN, launched **Q3 2022** for Walmart+ then expanded to **100% of Walmart.com customers**
in 2023, driving **167% YoY** redemption growth
([Supermarket News](https://www.supermarketnews.com/grocery-marketing/walmart-partnership-helps-boost-ibotta-rewards-network-167-);
[IPN](https://ipn.ibotta.com/resource-hub/looking-for-scale-the-ibotta-performance-network-now-reaches-100-of-walmart-customers)).
**Steal:** the receipt-scanning habit and adversarial verification. **Avoid:** becoming a
coupon/cashback app — that's a CPG-funded race SmartCart can't out-spend.

**Fetch.** 12.5M+ active users scanning receipts for points
([FinanceBuzz](https://financebuzz.com/how-does-fetch-rewards-make-money)). **Steal:** the
frictionless scan-and-earn UX and the gamification that makes mundane receipts a habit.
**Avoid:** the pure-rewards positioning; and note the **biometric/privacy exposure** receipt-
image processing creates (see [§5](#5-legal--privacy)).

**Instacart.** *The antagonist of our marketing.* Data model = retailer catalogs + prices via
partnerships across ~2,200 retailers / ~100k stores; revenue $3.38B (2024) from delivery fees
+ **advertising (~$1.18B in 2024, +25.5% YoY)** + **price markups**
([Wikipedia: Instacart](https://en.wikipedia.org/wiki/Instacart);
[Oberlo](https://www.oberlo.com/statistics/instacart-advertising-revenue)). Instacart
**marks item prices above in-store shelf prices** at many retailers
([FindPrices](https://www.findprices.com/stores/instacart-prices)) and acquired **Eversight**
(AI pricing) in Sept 2022 to run **price-sensitivity experiments**
([TechCrunch, Sep 2022](https://techcrunch.com/2022/09/01/instacart-is-acquiring-ai-powered-pricing-and-promotions-platform-eversight/)).
This is the gift: Instacart is *literally the opaque-pricing problem* SmartCart exists to
expose (see [§3](#3-surveillance-pricing)). **Steal:** nothing on data; **use them as the foil.**

**Capital One Shopping.** Extension/crawl across **30,000+ online retailers** comparing prices
and auto-applying coupons, funded by a bank's customer-acquisition budget
([Wikipedia: Capital One Shopping](https://en.wikipedia.org/wiki/Capital_One_Shopping)).
**Win:** frictionless, free, deep-pocketed. **Lose:** **online-only**, no in-store shelf price,
no local grocery. **Steal:** the "we find you the cheaper option automatically" UX.
**Avoid:** the assumption that price-compare is purely an e-commerce problem — SmartCart's
edge is the *physical aisle*.

**GasBuddy — the crowdsourcing analog.** Crowdsourced fuel prices from "**users, gas station
operators, and partner companies**," gamified with points/prizes
([Wikipedia: GasBuddy](https://en.wikipedia.org/wiki/GasBuddy)). It is the closest *proof* that
consumers will crowdsource a price grid at national scale — and the closest *cautionary tale*:
GasBuddy was caught **selling location data** ("$9.50 per 1,000 users," 4.5M users/month to a
data partner), generating a privacy backlash ([GasBuddy](https://en.wikipedia.org/wiki/GasBuddy)).
**Steal:** the gamified single-number reporting and the blended user+operator+partner feed.
**Avoid the location-data-sale trap** like the plague — it would detonate SmartCart's
privacy-first brand. Note also GasBuddy works partly *because gas has ~1 SKU per station*;
groceries have ~40,000, so the per-store data-density problem is **four orders of magnitude
harder**. Do not under-estimate this.

**Waze — the literal playbook.** Crowdsourced traffic via **active reports + passive GPS**,
bootstrapped with a **Map Editor and ranked power-users (area managers)**, gamified with
points, acquired by Google in 2013 for **~$1.1–1.3B**
([Wikipedia: Waze](https://en.wikipedia.org/wiki/Waze)). The architecture already maps its
confidence model onto Waze's reputation-weighting ([§4.4](../ARCHITECTURE.md)). **Steal:** (1)
**passive + active** collection (Waze didn't ask permission for every data point — GPS traces
flowed passively); the grocery analog is the receipt, which passively encodes dozens of prices
per scan. (2) **Ranked super-contributors** seeding new regions. (3) The "**scale creates
accuracy**" flywheel. **Avoid:** nothing — Waze is the north star, with the caveat that Waze's
data (your speed/location) regenerates every drive, whereas a grocery price **decays** and must
be *re-collected*, not just *re-observed*.

---

## 3. The dynamic / "surveillance pricing" angle — threat **and** narrative {#3-surveillance-pricing}

This is simultaneously SmartCart's biggest existential threat and its sharpest marketing weapon.
Treat both seriously.

**What's happening.** Retailers are moving to **electronic shelf labels (ESLs)** that make
real-time price changes trivial, and pairing them with AI:

- **Kroger** is rolling out its Microsoft-built **EDGE Shelf** digital price tags. Senators
  Warren and Casey's **Aug 7, 2024** investigation letter alleges that "**In partnership with
  Microsoft, Kroger plans to place cameras on its EDGE Shelf displays and use facial recognition
  to determine information about its shoppers, including gender and age, to push personalized
  offers**," and warns the device "**may enable Kroger to … present each customer with
  personalized price tags**"
  ([Warren press release, Aug 2024](https://www.warren.senate.gov/newsroom/press-releases/warren-casey-investigate-krogers-use-of-digital-price-tags-warn-of-grocery-giants-surge-pricing-causing-price-gouging-and-hurting-consumers);
  [Grocery Dive, Aug 12 2024](https://www.grocerydive.com/news/kroger-electronic-shelf-labels-instore-technology-senators-inflation/723939/)).
  Kroger denies dynamic pricing, saying tests are "to lower prices … where it matters most"
  ([Grocery Dive](https://www.grocerydive.com/news/kroger-electronic-shelf-labels-instore-technology-senators-inflation/723939/)).
- **The FTC's Jan 17, 2025 "Surveillance Pricing" 6(b) staff study** found that intermediaries
  use a **wide range of personal data — precise location, browsing history, demographics — to
  set individualized consumer prices**
  ([FTC press release](https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-surveillance-pricing-study-indicates-wide-range-personal-data-used-set-individualized-consumer);
  *the FTC site blocks automated retrieval — URL independently corroborated via the Wikipedia
  "Surveillance pricing" citation list and search indices*).
- **Instacart is already doing it.** A Sep 2025 Consumer Reports / Groundwork Collaborative
  study of 437 shoppers found **~75% of products shown at different prices to different
  customers**, up to **23% higher** for the same item bought simultaneously, an identical
  Seattle Safeway basket ranging **$114.34–$123.93**, and a projected **~$1,200/yr** household
  impact — powered by Eversight, with shoppers "**not aware that they're in an experiment**"
  ([Consumer Reports, Sep 2025](https://www.consumerreports.org/money/questionable-business-practices/instacart-ai-pricing-experiment-inflating-grocery-bills-a1142182490/);
  [Groundwork Collaborative](https://groundworkcollaborative.org/work/instacart/)).

**Why it's a threat.** If prices become individualized and shelf-dynamic, **a single
crowdsourced price point becomes less universally true** — "the price *I* saw" ≠ "the price
*you'll* see." SmartCart's confidence model must absorb this: a report is evidence about a
*distribution* of prices at a store, not a single ground truth. Architecturally this is fine —
`current_price` is already a confidence-weighted projection with `as_of`, not a fact — but the
**product copy and the optimizer's "savings" claims must hedge for personalized pricing**, or
SmartCart will be caught promising a price the user can't reproduce.

**Why it's the best marketing narrative we have.** SmartCart is the **consumer's counter-
surveillance**: when Kroger's shelf and Instacart's app quietly personalize *against* you,
SmartCart's crowd publishes the *real* distribution of prices *for* you. The Atozy/Erling
audience is exactly the populist-skeptic crowd that responds to "**the grocery store is
running price experiments on you — here's the receipt.**" Build the launch story on the
Instacart/Kroger findings above; they are independently sourced and damning. **One discipline:**
SmartCart must never itself do personalized/dynamic pricing of *its own* features in a way that
contradicts the narrative, and must never sell user location data (the GasBuddy mistake).

---

## 4. Cold-start strategy — bootstrapping a metro before crowdsourcing density {#4-cold-start}

The brutal truth: **crowdsourcing has a chicken-and-egg cold start, and grocery is the
worst-case version of it** (40,000 SKUs/store, prices decay weekly, value only appears once a
metro is dense). A user who opens SmartCart in a fresh metro and sees empty/low-confidence
prices churns before they ever contribute. Waze solved this with map-editors and passive GPS;
GasBuddy with a 1-SKU problem; Basket took years. SmartCart launches in **4 metros at once**
(SLC, DMV, Nashville/Franklin, Seattle), which *multiplies* the cold-start problem by four.
Plan accordingly. Recommended **seeding ladder**, cheapest/cleanest first:

1. **Circular/weekly-ad seed (week 0).** License or ingest a Flipp-style circular feed so every
   metro shows *real, current sale prices* on day one. This populates the `deals` index and
   `deal.reported` events immediately ([data-model.md](../docs/data-model.md)) and makes the app
   feel alive while the crowd is thin. **Promo-only**, but it's the fastest credible coverage.
2. **Retailer-API + polite public scrape seed (week 0–2).** Pull Kroger API prices where
   available and rate-politely scrape *public* online product pages for Walmart/Target/Kroger to
   seed **base** prices (with `source = crawl`, lower base confidence). This is the single most
   effective way to fill the 90% of SKUs circulars miss. Keep it public-only and firewalled
   from B2B per [§1.4](#14-web-scraping-of-retailer-sites--the-legally-loaded-option).
3. **A handful of paid/recruited power-users per metro ("area managers," Waze-style).** Recruit
   5–15 super-contributors per metro — local deal-hunters, ideally surfaced *through the Atozy/
   Erling audience* — and pay them (cash or Premium) to do structured aisle-walks and receipt
   uploads in the top 3–5 chains. This is **deliberately seeded crowdsourcing**: it produces real
   shelf-price + shelf-photo data exactly where users will first look, and it trains the
   confidence engine on real distributions. Tie it to the Weekly leaderboard so it converts into
   organic status competition.
4. **Receipt firehose from launch (week 0+).** Every receipt encodes dozens of prices passively
   — this is SmartCart's "passive GPS." Make receipt upload the highest-karma action from day
   one; one power-user's weekly Costco run seeds a lot of the basket. (Caveat: receipts skew to
   what people buy, leaving long-tail SKUs sparse — that's what the scrape/circular seeds cover.)
5. **Let organic crowdsourcing take over as density crosses threshold.** Once a metro's top
   stores have fresh, cross-verified coverage on the high-frequency basket, decay out the paid
   seeds and lean on the flywheel. The metro-as-a-cell design ([§7](../ARCHITECTURE.md)) makes
   "is this cell dense enough yet?" a measurable, per-cell decision.

**Sequencing principle:** *seeds make the app trustworthy on day one; the crowd makes it
defensible by month six.* Never ship a metro on crowd-only data — it will be empty and churn
users before the flywheel spins. Always blend, and always show `confidence`/`as_of` so seeded
(lower-confidence) prices are honestly labeled, never presented as verified.

---

## 5. Legal / privacy guardrails for receipt + location data {#5-legal--privacy}

The two most sensitive data classes SmartCart touches are **receipts** and **location**, and the
plan already treats privacy as a product promise ([§8](../ARCHITECTURE.md)). The non-obvious risks:

- **Biometric law (BIPA) is the receipt sleeper risk.** Illinois' **BIPA** imposes **$1,000 per
  violation ($5,000 if reckless/intentional)** and has produced enormous settlements —
  **Facebook $650M**, Six Flags, etc. ([Wikipedia: BIPA](https://en.wikipedia.org/wiki/Biometric_Information_Privacy_Act)).
  The exposure for SmartCart: if shelf photos or receipt images **incidentally capture faces**
  (other shoppers, the contributor) and any vision pipeline processes face geometry, BIPA-class
  liability can attach. **Mitigations:** never run facial analysis; **blur/strip faces** in the
  ingestion vision step; minimize image retention; and write the consent/notice copy carefully.
  (We could *not* confirm a specific Fetch BIPA case in public trackers — so this is a
  prospective risk to engineer against, not a cited precedent against a competitor.)
- **Receipt PII.** Receipts carry payment fragments, loyalty IDs, timestamps, store/location.
  The plan's "**strip PII from receipts post-parse**," encrypt-at-rest, short raw-location
  retention ([§8](../ARCHITECTURE.md)) is correct and must be enforced in code, not just policy.
- **Location data is a brand-ending liability if mishandled — see GasBuddy** selling location
  to a data partner and the resulting backlash ([GasBuddy](https://en.wikipedia.org/wiki/GasBuddy)).
  SmartCart's promise must be: location is used **only** for value to the user (right list, local
  prices, geofence validation) and **never sold**. The geofence-validation use is defensible and
  on-brand; a location-data side-business is not, and would directly contradict the §3 narrative.
- **Scraping/contract hygiene.** Per [§1.4](#14-web-scraping-of-retailer-sites--the-legally-loaded-option):
  public pages only, rate-polite, no logged-in scraping, and **keep scraped data out of any B2B
  export** — the ToS/contract tail (hiQ's User-Agreement breach finding) lands hardest the moment
  scraped data is resold.
- **Anti-extraction of our own graph.** The flip side: protect SmartCart's graph from *being*
  scraped, since competitors' best move is to extract our crowd's work. The edge bot-score +
  H3 geo-coherence design ([§8](../ARCHITECTURE.md)) is the right defense; "**no bulk price
  export through consumer APIs**" must be enforced from Phase 0.

---

## 6. What this means for SmartCart — ranked recommendations {#6-recommendations}

Concrete, ordered, and tied to the existing architecture/roadmap.

### 6.1 Sourcing mix by phase

| Phase | Primary source | Seed / fill | Validate | Notes |
|---|---|---|---|---|
| **0 (SLC, 50 users)** | Manual reports + receipts (crowd) | **Circular feed + polite public scrape** + 5–15 paid power-users | spot-checks | Blend from day one; crowd alone = empty app |
| **1 (4 metros, Atozy)** | Crowd (receipts + shelf + corrections) | Circular + scrape seeds per new cell | Kroger API where available | Decay paid seeds as cells densify |
| **2 (scale)** | Crowd-dominant, confidence-weighted | Scrape as targeted gap-fill | Panel sample (Numerator/Circana) for benchmark | Per-cell density gating |
| **3 (moat/B2B)** | Crowd graph as the asset | — | Panels as the competitive comparable | B2B data product vs Numerator |

**Ranked, the sourcing priorities are:**

1. **Make the receipt the hero contribution.** It is the highest-leverage, most-defensible,
   most "passive-GPS-like" input. Invest disproportionately in receipt OCR quality, the human-
   review DLQ, and the karma/earned-Premium reward for receipts ([§4.4](../ARCHITECTURE.md),
   [§4.9](../ARCHITECTURE.md)). This is the moat compounding.
2. **License a circular/deals feed before launch.** Cheapest path to a non-empty app in 4 metros;
   plugs straight into the existing `deals` index / `deal.reported` event.
3. **Build a rate-polite public-page scraper as an internal seeding/validation tool** — not a
   product, not a story, firewalled from B2B, public-only. Treat its output as a low-confidence
   `source = crawl` that the confidence engine must corroborate before promotion.
4. **Sign the Kroger developer API** (and any other free, clean retailer API) as a validation
   source and a free coverage boost, never as a dependency.
5. **Recruit + pay a small power-user corps per metro through the Atozy audience.** Deliberate
   seeded crowdsourcing is the Waze area-manager move and the fastest way to real shelf data.
6. **Defer panels (Numerator/Circana/NielsenIQ) to Phase 2+** as benchmark/validation and the
   Phase-3 B2B comparable — never as a real-time pricing dependency.

### 6.2 Build vs buy

- **BUILD (the moat):** the crowdsource ingestion + **confidence engine** + reputation-weighting
  + geofence validation + Sybil defense ([§4.4](../ARCHITECTURE.md)). This is the only thing that
  compounds and the only thing nobody can hand us. **Build it well; it is the company.**
- **BUILD:** the anti-extraction read path (edge bot-score, H3 geo-coherence, no bulk export).
- **BUY/LICENSE (commodities):** circular feeds, OCR/vision (managed APIs first per
  [§10](../ARCHITECTURE.md)), maps/gas/routing, and later the panel benchmark.
- **BORROW CAREFULLY (hedged tactic):** public-page scraping for seed/fill — build minimal, keep
  it disposable and legally clean.

### 6.3 How to defend the data graph

1. **The contributor network is the moat, not the bytes.** Defend *retention and karma*, because
   a competitor can copy a price but not a community. This is why gamification, referrals, and
   the Atozy distribution are strategic, not cosmetic.
2. **Confidence + freshness as a feature, not a footnote.** Personalized/dynamic pricing
   ([§3](#3-surveillance-pricing)) means a single price is never absolute truth; SmartCart's edge
   is *publishing the distribution honestly* while incumbents hide it. Lean into `confidence`/
   `as_of` end-to-end — it's both correct engineering and the marketing differentiator.
3. **Never become the villain.** No selling location data (GasBuddy), no personalized pricing of
   our own, no facial analysis (BIPA), no reselling scraped retailer data. The §3 narrative only
   works if SmartCart is clean.
4. **Bulk data is B2B-only, gated, watermarked** from Phase 0 — the graph leaks through the
   consumer read path or it doesn't leak at all.

### 6.4 The three things most likely to kill this

1. **Cold-start in 4 metros at once** with crowd-only data → empty app → churn. *Mitigate with
   the §4 seeding ladder; do not launch a metro on crowd-only data.*
2. **Receipt OCR data quality** never reaching the accuracy where "savings" claims are trustworthy
   → users lose trust in the number → the whole value prop collapses. *Mitigate with relentless
   OCR + confidence investment and honest confidence labeling.*
3. **A privacy/legal incident** (BIPA face capture, a location-data deal, a scraping injunction)
   → brand detonation for a privacy-first product. *Mitigate with the §5 guardrails, enforced in
   code from Phase 0.*

**Bottom line:** the architecture is right — current price as a confidence-weighted projection
off replayable crowdsourced contributions is exactly the defensible shape. The execution risk is
**100% in the sourcing**: blend seeds + scrape + retailer APIs + paid power-users to survive the
cold start, pour everything into receipt-driven crowdsourcing + confidence as the compounding
moat, keep the graph un-leakable and the brand clean, and use Instacart/Kroger's surveillance
pricing as the story that makes the crowd want to contribute.

---

## Sources

- hiQ Labs v. LinkedIn — https://en.wikipedia.org/wiki/HiQ_Labs_v._LinkedIn
- Web scraping (legal landscape) — https://en.wikipedia.org/wiki/Web_scraping
- Bright Data (Meta v. Bright Data; X Corp v. Bright Data) — https://en.wikipedia.org/wiki/Bright_Data
- Trespass to chattels (eBay v. Bidder's Edge; Intel v. Hamidi; Register.com v. Verio) — https://en.wikipedia.org/wiki/Trespass_to_chattels
- Internet bot / anti-bot mitigation (DataDome, Akamai, Imperva, CAPTCHA) — https://en.wikipedia.org/wiki/Internet_bot
- Illinois Biometric Information Privacy Act (BIPA) — https://en.wikipedia.org/wiki/Biometric_Information_Privacy_Act
- Optical character recognition (accuracy) — https://en.wikipedia.org/wiki/Optical_character_recognition
- Basket (crowdsourced grocery pricing) — https://basketsavings.com/
- Basket / Neil Kataria (PYMNTS, Apr 2018) — https://www.pymnts.com/news/retail/2018/basket-online-grocery-shopping/
- Basket scale & crowdsourced model (Washington Life, Aug 2018) — https://washingtonlife.com/innovators-grocery-shopping-that-makes-cents/
- Numerator (OmniPanel, receipt panel) — https://www.numerator.com/
- Circana (IRI + NPD) — https://en.wikipedia.org/wiki/Circana
- NielsenIQ (Homescan, e-receipt panels) — https://en.wikipedia.org/wiki/NielsenIQ
- Quotient / Coupons.com — https://en.wikipedia.org/wiki/Coupons.com
- Flipp (digital circulars, 2,000+ stores) — https://flipp.com/
- Ibotta (model, IPN, IPO) — https://en.wikipedia.org/wiki/Ibotta
- Ibotta Performance Network / Walmart Cash — https://ipn.ibotta.com/resource-hub/looking-for-scale-the-ibotta-performance-network-now-reaches-100-of-walmart-customers
- Walmart–Ibotta partnership growth (Supermarket News, May 2024) — https://www.supermarketnews.com/grocery-marketing/walmart-partnership-helps-boost-ibotta-rewards-network-167-
- Fetch Rewards (12.5M users, $1B+ rewards, $500M+ funding) — https://financebuzz.com/how-does-fetch-rewards-make-money
- Instacart (model, revenue, retailers) — https://en.wikipedia.org/wiki/Instacart
- Instacart advertising revenue (Oberlo / EMARKETER) — https://www.oberlo.com/statistics/instacart-advertising-revenue
- Instacart markups over in-store prices (FindPrices) — https://www.findprices.com/stores/instacart-prices
- Instacart acquires Eversight (TechCrunch, Sep 2022) — https://techcrunch.com/2022/09/01/instacart-is-acquiring-ai-powered-pricing-and-promotions-platform-eversight/
- Instacart AI price experiments (Consumer Reports, Sep 2025) — https://www.consumerreports.org/money/questionable-business-practices/instacart-ai-pricing-experiment-inflating-grocery-bills-a1142182490/
- Instacart price experiments (Groundwork Collaborative) — https://groundworkcollaborative.org/work/instacart/
- Capital One Shopping (Wikibuy) — https://en.wikipedia.org/wiki/Capital_One_Shopping
- GasBuddy (crowdsourced fuel, location-data sale) — https://en.wikipedia.org/wiki/GasBuddy
- Waze (crowdsourced traffic, bootstrap, Google acquisition) — https://en.wikipedia.org/wiki/Waze
- Dynamic pricing (ESLs, Wendy's surge pricing) — https://en.wikipedia.org/wiki/Dynamic_pricing
- Price discrimination / personalized pricing — https://en.wikipedia.org/wiki/Price_discrimination
- Kroger EDGE Shelf, Microsoft, facial recognition concerns (Grocery Dive, Aug 2024) — https://www.grocerydive.com/news/kroger-electronic-shelf-labels-instore-technology-senators-inflation/723939/
- Warren & Casey letter to Kroger (Aug 7, 2024) — https://www.warren.senate.gov/newsroom/press-releases/warren-casey-investigate-krogers-use-of-digital-price-tags-warn-of-grocery-giants-surge-pricing-causing-price-gouging-and-hurting-consumers
- FTC Surveillance Pricing 6(b) study (Jan 17, 2025) — https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-surveillance-pricing-study-indicates-wide-range-personal-data-used-set-individualized-consumer *(FTC site blocks automated retrieval; URL corroborated via Wikipedia "Surveillance pricing" citations and search indices)*

> **Sourcing-integrity note.** WebSearch was unavailable for this entire research session;
> findings were gathered via direct page retrieval (WebFetch) plus two delegated research
> passes. A few primary sources (ftc.gov, retailer developer portals, several major news
> domains) block automated clients and are flagged inline where they could not be fetched
> verbatim. No URL in this memo was fabricated; every cited page was either directly retrieved
> with real content or, where noted, corroborated across independent indices.
