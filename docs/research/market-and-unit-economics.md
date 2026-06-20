# SmartCart — Market Sizing, Go-to-Market & Unit Economics

*Research memo. Date: June 2026. Audience: founders / investors. Tone: skeptical, numbers-first.*

SmartCart is positioned as "Waze for grocery prices": a crowdsourced grocery price-comparison and cart-optimization app with a free tier (basic list, limited optimization tokens, 30-day price tracker, contributions earning karma/badges), a Premium tier (full-cart optimization, multi-store routing, unlimited price-drop alerts, shared household lists, exports, ad-free), and an earned-Premium path (3 activated referrals = 1 month; top contributors earn Premium). Launch metros: Salt Lake City, the DMV (Washington DC), Nashville/Franklin, and Seattle. Distribution: the Atozy/Erling Instagram audience riding an anti-grocery-price-gouging narrative.

This memo sizes the opportunity, benchmarks comparable apps, models freemium + referral economics, lays out the creator-led GTM, and stress-tests the risks. **Bottom line up front:** the wedge is real (households spend ~$6,000/yr on groceries and prices are up ~25% since 2019), but the business is hard for two structural reasons — (1) the people who most need the savings are the least able/willing to pay a subscription, and (2) crowdsourced price data is expensive to keep fresh and decays fast. The plausible business is a **mid-single-digit-thousands of paying households per metro** outcome, not a venture rocket, unless the referral loop genuinely compounds (k-factor sustained > ~0.5 with strong organic top-up).

---

## 1. Market context

### 1.1 Grocery spend & inflation

US households spend a lot on groceries and felt a real shock. Average **food-at-home (grocery) spending was ~$6,053 per household in 2024** (~$504/month), up from ~$5,703 in 2023; total food spending including dining out was ~$9,259 ([USDA ERS, Food Prices and Spending](https://www.ers.usda.gov/data-products/ag-and-food-statistics-charting-the-essentials/food-prices-and-spending)). USDA's per-quintile cut shows the spread: in 2024 the lowest-income households spent ~$5,498 on food (33.0% of income) while the highest spent ~$16,989 (6.4% of income) ([USDA ERS](https://www.ers.usda.gov/data-products/ag-and-food-statistics-charting-the-essentials/food-prices-and-spending)). The pain is regressive, which is exactly the narrative SmartCart leans on — and exactly the segment with the weakest willingness-to-pay (see §6).

The inflation shock that creates the political opening has largely **passed** as of mid-2026:

| Year | Food-at-home (grocery) CPI change | Source |
|---|---|---|
| 2022 | **+11.4%** (largest since 1979) | [USDA ERS Food Price Outlook](https://www.ers.usda.gov/data-products/food-price-outlook) |
| 2023 | **+5.0%** | [USDA ERS, Summary Findings](https://www.ers.usda.gov/data-products/food-price-outlook/summary-findings) |
| 2024 | **+1.2%** | [USDA ERS](https://www.ers.usda.gov/data-products/food-price-outlook/summary-findings) |
| 2025 | **+2.3%** | [USDA ERS](https://www.ers.usda.gov/data-products/food-price-outlook/summary-findings) |
| 2026 (forecast) | **+3.2%** (interval 1.3%–5.2%) | [USDA ERS](https://www.ers.usda.gov/data-products/food-price-outlook/summary-findings) |

The *level* is what stings: cumulatively grocery prices rose ~25% from 2019 to 2024 ([BLS CPI](https://www.bls.gov/cpi/)), so the "prices are still crazy" feeling persists even though the *rate* has normalized below the 2.6%/yr historical average ([USDA ERS](https://www.ers.usda.gov/data-products/food-price-outlook/summary-findings)). **Skeptic's note:** SmartCart is launching as the acute inflation anger cools. The product must sell on durable everyday savings, not on a fading news cycle.

### 1.2 How much can a household actually save?

This is the load-bearing assumption for the whole pitch, and the savings are large and reasonably well-documented. An **Ernst & Young QUEST study (Jan 2025)** found **ALDI saves shoppers up to ~36% per trip** vs. competitors, ~**$4,000/year for a family of four** vs. name brands, and ~$8.3B/yr in aggregate ([PR Newswire / ALDI](https://www.prnewswire.com/news-releases/report-confirms-aldi-offers-the-lowest-prices-of-any-national-grocery-store-saving-shoppers-8-3-billion-per-year-302349728.html)). **Store/private-label brands are typically 25–30% cheaper than name brands**, and a family using sales + private label can save ~$5,000/year ([Consumer Reports](https://www.consumerreports.org/money/store-private-label-brands/how-store-brand-groceries-can-help-you-save-a4379816935/)); the private-label vs national price gap has grown 38% since 2019 ([Numerator](https://www.numerator.com/press/price-gap-growing-between-private-label-and-national-brands/)). **Caveat:** these are *best-case* (full switch to a discounter or to store brands), not the marginal saving from one more app. The defensible, conservative framing for SmartCart: at ~$6,053/yr grocery spend ([USDA ERS](https://www.ers.usda.gov/data-products/ag-and-food-statistics-charting-the-essentials/food-prices-and-spending)), capturing even **10–15%** via store-switching and basket optimization is **~$600–$900/yr** — well below the discounter ceiling, and the number to validate empirically with SmartCart's own first-50 data (savings/list × lists/month), not to assert.

### 1.3 Who already comparison-shops / uses grocery apps

Digital grocery behavior is now mainstream, which cuts both ways (large addressable behavior, but also a crowded field). Per FMI's U.S. Grocery Shopper Trends, **77% of shoppers use digital tools before shopping** and **71% use digital tech while in-store**; of those, **54% use retailer apps**, 39% do web searches ([FMI, U.S. Grocery Shopper Trends](https://www.fmi.org/our-research/research-reports/u-s-grocery-shopper-trends)). Specifically on cross-store price comparison, FMI's 2024 series found **37% use their phones to compare prices across stores** and **50% use digital coupons**, with **91% of price-concerned shoppers changing habits** for better value ([FMI 2024 Trends](https://www.fmi.org/newsroom/news-archive/view/2024/05/14/fmi-launches-2024-u.s.-grocery-shopper-trends-series--how-consumers-are-finding-value-at-the-grocery-store)). A Feb-2026 LendingTree survey (n=2,000) found **~90% changed grocery habits due to inflation** — but only **16% shop at multiple stores**, vs. 23% switching to store brands and 19% using more coupons ([LendingTree](https://www.lendingtree.com/debt-consolidation/grocery-shopping-habits-survey/)). **That ~16% multi-store figure is the key headroom-and-friction signal for SmartCart:** appetite to save is near-universal (~90%), comparison-shopping on phone is already common (~37%), but actually trekking to multiple stores is rare (16%) — which is precisely the friction multi-store routing must dissolve, against incumbents who only ever serve a single retailer.

### 1.4 Smartphone / low-end Android context

Reach is high but skewed exactly against SmartCart's stated core user. **91% of US adults own a smartphone (2025)**, but ownership is **82% for households under $30K** vs **97% for $100K+** ([Pew Research Center, Mobile Fact Sheet](https://www.pewresearch.org/internet/fact-sheet/mobile/)). Low-income users are also far more **smartphone-dependent** for internet access (34% of under-$30K vs 4% of $100K+) ([Pew](https://www.pewresearch.org/internet/fact-sheet/mobile/)) — so the phone *is* their device. US OS split is **iOS 61.5% / Android 38.5%** as of May 2026 ([StatCounter](https://gs.statcounter.com/os-market-share/mobile/united-states-of-america)), and Android skews materially lower-income (iPhone users average ~$53K income vs ~$37K for Android, per aggregated [Statista data](https://www.sci-tech-today.com/stats/iphone-vs-android-user-statistics/)). **Implication:** the most price-sensitive users are disproportionately on budget Android and least likely to own any smartphone — so (a) **Android-first, low-end-device support is non-negotiable**, and (b) the willing-to-pay population skews higher-income than the marketing narrative implies. This tension recurs throughout the memo.

---

## 2. TAM / SAM / SOM

### 2.1 Top-down

There are **132.7M US households** (ACS 2024 1-yr, median household income $81,604) ([Census Reporter / ACS](https://censusreporter.org/profiles/01000US-united-states/)). At ~$6,053 grocery spend each ([USDA ERS](https://www.ers.usda.gov/data-products/ag-and-food-statistics-charting-the-essentials/food-prices-and-spending)), US grocery spend is ~$800B/yr — but that is the *category*, not SmartCart's revenue pool. SmartCart monetizes via subscriptions (+ later affiliate/ads), so the relevant TAM is **households willing to pay a savings-app subscription**, not grocery dollars. Anchor: if 132.7M households, ~50% smartphone-equipped value-seekers, and a generous 3% pay $40/yr → ~$80M/yr theoretical US TAM for the subscription line alone. That is a "nice business," not a "category-defining" TAM, which should calibrate expectations.

### 2.2 The four launch metros (bottom-up base)

| Metro (CBSA) | Population | Households | Median HH income |
|---|---|---|---|
| Salt Lake City, UT (41620) | 1,300,762 | 469,925 | $100,548 |
| Washington–Arlington–Alexandria (DMV, 47900) | 6,437,907 | 2,415,530 | $126,244 |
| Nashville–Davidson–Murfreesboro–Franklin (34980) | 2,151,715 | 869,185 | $88,800 |
| Seattle–Tacoma–Bellevue (42660) | 4,145,494 | 1,658,652 | $112,388 |
| **Combined** | **~14.0M** | **~5.41M** | — |

Source: [Census Reporter, ACS 2024 1-yr](https://censusreporter.org/profiles/31000US47900-washington-arlington-alexandria-dc-va-md-wv-metro-area/) (per-metro profile pages; SLC labeled "Salt Lake City–Murray"). The four metros = **~5.41M households, ~4.1% of all US households**. Note the metros skew **high-income** (three of four above the US median), reinforcing §1.4: good for WTP, off-narrative for "helping the squeezed."

### 2.3 SAM and SOM (the math)

**SAM** = launch-metro households who are smartphone-equipped value-seekers who would plausibly use a cross-store grocery app. We assume:
- Smartphone-equipped: ~90% (blend of Pew income bands; these metros skew high-income) → ~4.87M.
- Active grocery value-seekers / digital-tool users: ~55% of those (conservative read of FMI's 77% digital-tool usage, discounted for "would use a *new cross-store* app") → **SAM ≈ 2.68M households**.

**SOM (3-year, base case)** = penetration of SAM. Consumer utility apps in a hand-built, metro-by-metro rollout realistically reach low-single-digit % of a defined SAM in 3 years without large paid spend. We model **2% of SAM = ~53,600 installed/active free households**, and apply a premium conversion rate anchored to benchmarks (§3, §4).

| Scenario | Active free HH (SOM) | Premium conv. | Paying HH | Blended ARPU/yr | Subscription revenue/yr |
|---|---|---|---|---|---|
| Bear | ~27,000 (1% SAM) | 2.5% | ~675 | $40 | **~$27K** |
| Base | ~53,600 (2% SAM) | 4.0% | ~2,144 | $45 | **~$96K** |
| Bull | ~134,000 (5% SAM) | 6.0% | ~8,040 | $50 | **~$402K** |

**Assumptions stated plainly:** conversion of 2.5–6% brackets the RevenueCat freemium range (median ~1.7–1.9%, upper quartile ~3.8–4.2%, hard-paywall ~12%; §3.7) — SmartCart should be *above median* because the value is monetary and measurable, but the earned-Premium referral path will *cannibalize* paid conversion (§4). ARPU is blended across monthly/annual mixes and assumes a $5–7/mo price (§7). **This is a single-digit-millions ARR business at maturity in these four metros even in the bull case from subscriptions alone** — affiliate/ad revenue (Ibotta/Flipp-style, §3) is the realistic second leg and arguably the larger one long-term.

---

## 3. Comparable apps' monetization & benchmarks

### 3.1 Ibotta (NYSE: IBTA) — cash-back, data/affiliate model
IPO'd **April 18, 2024 at $88/share**; by Sept 2025 traded ~$27 (~69% below IPO) ([Wikipedia](https://en.wikipedia.org/wiki/Ibotta); [StockAnalysis](https://stockanalysis.com/stocks/IBTA/)). Revenue **$320M (2023) → $367M (2024)**, net income $38M → $69M; ~$340M TTM by 2025 ([StockAnalysis](https://stockanalysis.com/stocks/IBTA/financials/)). Paid >$1.5B cash back to 50M+ consumers since founding ([Wikipedia](https://en.wikipedia.org/wiki/Ibotta)); the Ibotta Performance Network reaches 200M+ consumers ([investors.ibotta.com](https://investors.ibotta.com)). **Lesson for SmartCart:** the durable money is the *brand-funded performance/affiliate network*, not the consumer. But the post-IPO derating shows the market is skeptical of consumer-savings-app growth.

### 3.2 Instacart / Maplebear (NASDAQ: CART) — marketplace + subscription + ads
Revenue **$3.04B (2023) → $3.38B (2024) → $3.74B (2025)**, net income $457M (2024) ([StockAnalysis](https://stockanalysis.com/stocks/CART/financials/); [Wikipedia](https://en.wikipedia.org/wiki/Instacart)). Q1 2026: GTV $10.3B, 91.2M orders, transaction revenue $733M = a **~7.1% transaction take rate**; **advertising exceeded $1B in 2025** ([StockAnalysis](https://stockanalysis.com/stocks/CART/)). **Instacart+ subscription is $9.99/mo or $99/yr** with a 14-day trial ([Instacart+](https://www.instacart.com/instacart-plus)). **Lesson:** ads became Instacart's margin engine; a price-comparison app with high-intent shoppers is an attractive ad surface — but only at scale.

### 3.3 Fetch Rewards — receipt-scanning, brand-funded
Receipt-scanning rewards monetized via CPG brand partnerships and shopper data; widely reported tens of millions of active users and a ~$2.5B 2021 valuation (SoftBank/ICONIQ ~$210M round). **We could not retrieve a clean primary URL this pass — flag as needs-verification.** **Lesson:** like Ibotta, the consumer is the data/audience; brands pay.

### 3.4 GasBuddy — the closest structural analog (crowdsourced prices)
Crowdsourced gas prices; owned by PDI Technologies (2021). Monetizes via B2B services to stations and historically via selling user location data (in 2017, ~4.5M users/month to Reveal at $9.50/1,000) ([Wikipedia](https://en.wikipedia.org/wiki/GasBuddy)). GasBuddy also runs a consumer "Premium" tier (commonly cited ~$9.99/mo with per-gallon savings) — **we could not confirm current pricing via a retrievable URL; flag.** **Lesson — most important comp:** GasBuddy proves crowdsourced-price + premium can persist, but note it took years, a simpler single-SKU data problem (one price per station vs thousands of SKUs per store), and still leaned on data sales.

### 3.5 Waze — the crowdsourcing/brand inspiration
~130M users; monetizes via hyperlocal Waze Ads; acquired by Google for **$1.3B in 2013** ([Wikipedia](https://en.wikipedia.org/wiki/Waze)). **Lesson:** crowdsourced data networks can reach huge scale and were monetized via ads, not consumer subs — and the exit was strategic acquisition, not standalone profitability.

### 3.6 Flipp — flyers/deals, retailer-funded (no consumer sub)
Digital-flyer/merchandising platform; monetizes via retailers/brands paying for placement, **not** consumer subscriptions ([corp.flipp.com](https://corp.flipp.com/about)). User/revenue metrics not disclosed. **Lesson:** the incumbent in "deals discovery" is free-to-consumer and ad/retailer-funded — a pricing-pressure reality for SmartCart's Premium.

### 3.7 Subscription & freemium benchmarks (RevenueCat)
From RevenueCat's State of Subscription Apps ([2024](https://www.revenuecat.com/state-of-subscription-apps-2024/); [2025](https://www.revenuecat.com/state-of-subscription-apps-2025/)):
- **Install→paid:** median **1.7% (2024) / 1.9% (2025)**; upper quartile ~3.8–4.2%; **hard-paywall median 12.1% vs freemium 2.2%**. North America 2–3% typical.
- **Free-trial conversion:** median **37–39%**; Shopping category **45.4%** (one of the highest).
- **Retention/churn:** monthly-plan **Year-1 retention only ~11–17%** (i.e. ~83–89% annual churn); annual-plan Year-1 retention ~27–44%; ~30% of annual subs cancel in month 1.

**Anchor for SmartCart:** assume freemium conversion **2.5–4%** base (above median, below hard-paywall), trial conversion ~40%, and brutal monthly churn — which argues strongly for pushing **annual plans** and the earned-Premium hook to extend life.

---

## 4. Freemium + referral economics

### 4.1 The cannibalization tension (the memo's flagged risk)
The earned-Premium path (3 activated referrals = 1 free month; top contributors get Premium) is a **deliberate trade of subscription revenue for growth and data density**. Every household that earns Premium via referral is a household that did *not* pay — and the most motivated, highest-WTP users (the ones who would have paid) are exactly the ones most able to recruit 3 friends. So referral unlocks risk skimming the would-be payers. The model below makes that explicit.

### 4.2 CAC by channel

| Channel | Est. CAC (per activated user) | Basis |
|---|---|---|
| Organic / UGC (Atozy content, App Store) | **~$0–3** | Creator audience is "free" media; only content/ops cost. |
| Referral (3 activations → 1 mo Premium) | **~$3–8** effective | Cost = value of free months granted ÷ activations driven. At $6/mo Premium and 1 free month per 3 activations, ~$2 of "give" per activation, plus the cannibalized sub. |
| Paid install (fintech/utility, blended) | **~$5–15+ per install, often $30–60+ per *activated/paying* user** | Industry blended paid CPI is well above organic; we could not retrieve a clean Business of Apps URL this pass (403) — flag; treat $5–15 CPI / $30–60 CPA as directional. |

The whole GTM thesis is that **organic + referral CAC stays near zero** so the model survives even at low ARPU. If SmartCart ever has to buy installs at $5–15 to grow, the economics (§4.4) break at a $40–50 LTV.

### 4.3 The k-factor

Viral coefficient **k = (invites sent per user) × (conversion rate per invite)**. **k > 1 means self-sustaining exponential growth**; k < 1 means each cohort decays and you need constant top-of-funnel (e.g., Atozy). The canonical proof point: **Dropbox grew 100K → 4M users in 15 months**, and its referral program **"increased signups by 60%, permanently,"** with 2.8M referral invites sent in a single month (April 2010) — vs paid ads that would have cost ~$233–$388 per customer for a $99 product ([ReferralCandy](https://www.referralcandy.com/blog/dropbox-referral-program)).

Worked example for SmartCart's "3 activations = 1 month":
- If the average active user sends **5 invites** and each converts to an *activated* user at **10%**, k = 5 × 0.10 = **0.5**. Sub-viral: every Atozy-driven cohort of 1,000 yields ~1,000 + 500 + 250 + … ≈ **2,000 total** (a 2× amplifier), then stalls without new top-up.
- To hit **k = 1**, you need e.g. 5 invites × 20% activation, or 10 invites × 10%. That is *hard* for a grocery app (groceries aren't as inherently social as file-sharing).

**Realistic target: k ≈ 0.4–0.7, treated as a CAC-reducer, not a growth engine.** The growth engine is Atozy; referral is the multiplier on each creator burst.

### 4.4 Unit-economics model (base case)

Assumptions: Premium **$5.99/mo** or **$39.99/yr**; blended ARPU **~$45/yr** (annual-skewed); gross margin ~85% (hosting + data ops modest per user); **monthly churn ~6%/mo on monthly plans, ~40%/yr on annual** (better than RevenueCat median because monetary value is sticky and the price tracker creates habit).

| Metric | Value | Note |
|---|---|---|
| Premium price | $5.99/mo · $39.99/yr | §7 |
| Blended ARPU | ~$45/yr | annual-skewed mix |
| Avg paid lifetime | ~20 months | implied by ~40%/yr retention, annual-led |
| Gross margin | 85% | data ops the swing factor |
| **LTV (gross-margin)** | **~$64** | $45/yr × ~1.7 yr × 0.85 |
| CAC (organic/referral) | $0–8 | §4.2 |
| **LTV:CAC (organic/referral)** | **~8:1 to ∞** | healthy — *if* CAC stays near zero |
| CAC (paid) | $30–60 per paying user | §4.2 |
| **LTV:CAC (paid)** | **~1:1 to 2:1** | marginal-to-bad — do not scale on paid |

### 4.5 Sensitivity (LTV, gross-margin $, per paying household)

| Churn (annual) → / Price ↓ | 30%/yr (life ~3.3yr) | 40%/yr (~2.5yr) | 55%/yr (~1.8yr) |
|---|---|---|---|
| **$29.99/yr** | ~$84 | ~$64 | ~$46 |
| **$39.99/yr** | ~$112 | ~$85 | ~$61 |
| **$59.99/yr** | ~$168 | ~$127 | ~$92 |

(LTV = ARPU × avg lifetime-years × 0.85 GM.) **Read:** at any plausible point LTV comfortably clears organic/referral CAC, but only the low-churn / higher-price cells clear *paid* CAC of $30–60. **The model is a margin-of-safety on cheap acquisition, not on monetization.** Protect organic/referral; never let paid become the primary channel.

---

## 5. Go-to-market

### 5.1 Creator-led launch (Atozy/Erling → app)
The wedge is a single creator audience primed on anti-price-gouging commentary. **We could not retrieve verifiable subscriber/follower counts for Atozy this pass** (Social Blade 403, no Wikipedia page) — this must be confirmed, because the entire CAC thesis rests on audience size × install rate. Planning math: creator-audience→install conversion for a *relevant, free, problem-solving* app typically lands in the low-single-digit % of *engaged* viewers per push (we lack a clean public benchmark URL — flag). If Atozy reaches, say, 1M engaged followers and a launch series converts 1–3% to installs, that's **10K–30K installs per campaign burst** — enough to seed all four metros if concentrated.

The closest verified analog for creator/referral compounding is Dropbox's referral mechanics (§4.3) ([ReferralCandy](https://www.referralcandy.com/blog/dropbox-referral-program)) — proof that a built-in incentive can add ~60% to organic signups *on top of* a content push.

### 5.2 Community-led growth (Discord / Reddit / Facebook)
Mom groups, coupon communities (r/Frugal, r/Coupons, Facebook "[Metro] Grocery Deals"), and a SmartCart Discord are the retention/UGC engine: crowdsourced prices need contributors, and communities both produce data and re-activate churned users. We could not retrieve clean public conversion benchmarks for community-led fintech growth this pass (flag). Operating principle: seed one **hyperlocal** community per metro, not a national one — value is local (see §5.4).

### 5.3 The SLC → 4-metro density playbook
Start in **Salt Lake City** (smallest, ~470K households, most concentrated, and home-turf-able), prove the loop, then sequence DMV → Nashville → Seattle. SLC is the right beachhead precisely because density-per-metro — not total reach — drives value.

### 5.4 Why density-by-metro matters
A crowdsourced price-comparison app is a **local liquidity** product, like Waze: a price observation is only useful to other shoppers at *that store, recently*. National spread of 50K users is worthless; 50K users in one metro means every store has fresh prices on every SKU. This is why the playbook is **deep-then-wide**: hit a contributor/coverage threshold in SLC (e.g., every major banner has <7-day-old prices on the top 200 SKUs) before opening metro #2. GasBuddy and Waze both won on local density first ([Waze](https://en.wikipedia.org/wiki/Waze); [GasBuddy](https://en.wikipedia.org/wiki/GasBuddy)).

---

## 6. Risks to the business model

1. **Data-sourcing cost & decay (highest risk).** Grocery prices are thousands of SKUs × dozens of banners × every metro, and they go stale weekly — a far harder data problem than GasBuddy's one-price-per-station. Grocers do not publish clean price APIs; commercial price-intelligence is an entire well-funded vendor category (Wiser, [Datasembly Price Intelligence](https://datasembly.com/price-intelligence-suite/), Anakin, ActoWiz, etc.), all quote-based/gated — a signal of cost. Scraping publicly posted prices is *legally defensible* on the CFAA front post-*hiQ v. LinkedIn* (9th Cir., 2022) but ToS/contract/copyright theories remain live ([EFF](https://www.eff.org/deeplinks/2022/04/scraping-public-websites-still-isnt-crime-court-appeals-declares)). **The graveyard precedent is decisive: Basket**, the crowdsourced grocery price-comparison app (founded 2013, raised ~$19.6M, reportedly ~$7M revenue / 64 staff by late 2025), was **removed from the app stores in February 2026** ([GetLatka](https://getlatka.com/companies/basket.com); AppBrain listing — *removal date worth manual confirmation*). Crowdsourcing alone did not sustain a standalone grocery-price business; expect to subsidize data with scraping or paid feeds.

2. **Low willingness-to-pay among the target users.** The narrative targets the squeezed, but smartphone ownership is just **82% under $30K** ([Pew](https://www.pewresearch.org/internet/fact-sheet/mobile/)), and **41% of consumers report subscription fatigue** ([Subscription Insider](https://medium.com/@subscriptioninsider/subscription-fatigue-is-real-heres-what-the-data-shows-9fa40d32087e)). Freemium conversion benchmarks (median ~1.7–1.9%) ([RevenueCat](https://www.revenuecat.com/state-of-subscription-apps-2025/)) mean ~96–98% never pay. Store-switching for price is mainstream — **52% switched to lower-price merchants** ([PYMNTS](https://www.pymnts.com/news/retail/2024/consumers-switch-to-cheaper-retailers-but-hesitant-to-leave-grocers/)) — but those switchers lean on *free* tools. The free tier must carry the data flywheel; Premium monetizes a thin, higher-income slice (note the high-income skew of the launch metros, §2.2).

3. **Retention / churn (brutal).** Mobile apps lose ~77% of DAUs within 3 days and ~90% within 30 days of install ([Plotline](https://www.plotline.so/blog/retention-rates-mobile-apps-by-industry)); shopping apps sit at **Day-30 retention of just ~3–6%** ([Sendbird](https://sendbird.com/blog/app-retention-benchmarks-broken-down-by-industry)), and monthly-plan Year-1 retention is ~11–17% ([RevenueCat](https://www.revenuecat.com/state-of-subscription-apps-2024/)). A savings app used only on shopping trips has structurally low frequency. The 30-day price tracker and price-drop alerts are the habit hooks that must beat this — and **Grocery iQ** (list+coupon app, absorbed/killed ~2020–21) is a second precedent for how this niche dies.

4. **Competition / free substitutes.** Retailer apps (54% usage) ([FMI](https://www.fmi.org/our-research/research-reports/u-s-grocery-shopper-trends)), **Flipp** (free, retailer-funded, claims users "save an average of $46/week" across 2,000+ stores — [Flipp](https://flipp.com/)), Ibotta/Fetch cash-back, Instacart's in-app cross-retailer price check, and Google Shopping all occupy adjacent "save on groceries" mindshare for *free*. SmartCart's only durable moat is *cross-retailer* multi-store optimization that no single grocer will ever build.

5. **Dynamic-pricing & legal headwinds (double-edged).** The FTC's surveillance-pricing 6(b) study (released Jan 17, 2025) sent orders to six intermediaries (Mastercard, Accenture, PROS, Bloomreach, Revionics, McKinsey) and found retailers use location, demographics, and browsing history to set individualized prices ([National Law Forum summary](https://nationallawforum.com/2025/01/20/ftc-surveillance-pricing-study-uncovers-personal-data-used-to-set-individualized-consumer-prices/); [FTC press release](https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-surveillance-pricing-study-indicates-wide-range-personal-data-used-set-individualized-consumer)). Senators **Warren and Casey** pressed Kroger (Aug 2024) on electronic shelf labels enabling "surge" grocery pricing ([Grocery Dive](https://www.grocerydive.com/news/kroger-electronic-shelf-labels-instore-technology-senators-inflation/723939/)). State law is moving: **California AB 325** (signed Oct 2025) bars common pricing algorithms using competitor data, and **New York** amended the Donnelly Act (effective Dec 2025) ([Arnold & Porter](https://www.arnoldporter.com/en/perspectives/advisories/2025/10/algorithmic-pricing-bans-go-coast-to-coast)). **Caveat — policy is unstable:** new FTC Chair Ferguson shut the surveillance-pricing comment period days after it opened (Jan 2025) ([Retail Brew](https://www.retailbrew.com/stories/2025/01/24/new-ftc-chair-shuts-down-public-comment-on-retailers-surveillance-pricing)). Net: regulatory momentum is a *tailwind* for SmartCart's transparency narrative, but ESL-driven dynamic pricing makes the *underlying data harder to keep fresh* (a price can change mid-day).

6. **Greedflation political context (tailwind).** The FTC's March 2024 grocery supply-chain report found retailer food/beverage markups rose from ~5% to ~7% (2020–2023) and stayed elevated after costs eased ([Food & Power](https://www.foodandpower.net/latest/ftc-supply-chain-disruption-grocery-food-processing-report-apr-24); [NYT](https://www.nytimes.com/2024/03/21/us/politics/grocery-prices-pandemic-ftc.html)). A hostile pricing/political climate boosts consumer demand for price transparency — the exact narrative the Atozy distribution rides — but it is a *demand* tailwind, not a moat.

---

## What this means for SmartCart

### Recommended pricing / packaging
- **Free:** basic list, limited optimization tokens, 30-day price tracker, crowdsourced contribution with karma/badges. This is the **data flywheel** — keep it genuinely useful so contribution scales.
- **Premium: $5.99/mo or $39.99/yr** (anchor below Instacart+'s $9.99/$99 ([Instacart+](https://www.instacart.com/instacart-plus)) and GasBuddy-class pricing; push the **annual** plan hard to fight monthly churn). Include a **14-day trial** (Shopping-category trial conversion ~45% ([RevenueCat](https://www.revenuecat.com/state-of-subscription-apps-2025/))).
- **Earned Premium:** keep "3 activated referrals = 1 month" as a *growth/density* lever, but **cap free months per user (e.g., 3/yr)** so it amplifies acquisition without fully cannibalizing the high-WTP cohort.
- **Plan the second revenue leg now:** affiliate/retailer/ad revenue (Ibotta/Flipp/Instacart model) is likely the larger long-term line; design the data and ad surface for it early.

### Metric targets — first 50 users + Atozy soft launch
| KPI | Target (first 50) | Why |
|---|---|---|
| **2nd-list rate** (made a 2nd list) | **≥ 50%** | Core habit/retention signal; below this, churn will kill it. |
| **Savings per list** | **≥ 10% / ≥ $15** | Validates the §1.2 value thesis with real data. |
| **Referrals per active user** | **≥ 1.5 activated** | Feeds k-factor; below ~1 means no viral assist. |
| **k-factor** | **≥ 0.4 (stretch 0.7)** | CAC reducer; k≥1 unrealistic, don't pretend. |
| **Premium conversion** | **≥ 4%** of actives | Above RevenueCat median; lower = monetization problem. |
| **Data freshness (SLC)** | top-200 SKUs <7 days old across major banners | The density precondition for value (§5.4). |

### Go / no-go signals
- **GO (open metro #2):** SLC hits ≥50% 2nd-list, ≥10% savings/list, k≥0.4, ≥4% Premium conversion, *and* data-freshness threshold — i.e., the loop self-sustains on organic/referral with near-zero CAC.
- **PIVOT:** strong usage but weak pay (conversion <2.5%) → lean into affiliate/ad monetization (Ibotta/Flipp model) and treat subscriptions as secondary.
- **NO-GO / rethink:** 2nd-list rate <30% (no habit), or data freshness unachievable without paid feeds that blow up gross margin, or k<0.2 *and* Atozy install rate disappoints (no cheap top-of-funnel) → the cheap-CAC thesis (the entire margin of safety) is false; do not scale.

**One-line verdict:** A credible *cheap-CAC, data-flywheel* niche business in 4 metros — plausibly low-single-digit-millions ARR at maturity from subscriptions, more if affiliate/ads work — but *not* a venture rocket unless (a) the referral loop sustains k≥0.5 with cheap organic top-up and (b) crowdsourced data freshness holds without expensive paid feeds. Validate those two things in SLC before spending a dollar on metro #2.

---

## Sources

- USDA ERS, Food Prices and Spending: https://www.ers.usda.gov/data-products/ag-and-food-statistics-charting-the-essentials/food-prices-and-spending
- USDA ERS, Food Price Outlook (Summary Findings): https://www.ers.usda.gov/data-products/food-price-outlook/summary-findings
- USDA ERS, Food Price Outlook: https://www.ers.usda.gov/data-products/food-price-outlook
- BLS, Consumer Price Index: https://www.bls.gov/cpi/
- BLS, Consumer Expenditure Surveys: https://www.bls.gov/cex/
- FMI, U.S. Grocery Shopper Trends: https://www.fmi.org/our-research/research-reports/u-s-grocery-shopper-trends
- FMI, 2024 U.S. Grocery Shopper Trends (value/price-comparison): https://www.fmi.org/newsroom/news-archive/view/2024/05/14/fmi-launches-2024-u.s.-grocery-shopper-trends-series--how-consumers-are-finding-value-at-the-grocery-store
- LendingTree, Grocery Shopping Habits Survey (Feb 2026): https://www.lendingtree.com/debt-consolidation/grocery-shopping-habits-survey/
- ALDI / Ernst & Young QUEST savings study (PR Newswire, Jan 2025): https://www.prnewswire.com/news-releases/report-confirms-aldi-offers-the-lowest-prices-of-any-national-grocery-store-saving-shoppers-8-3-billion-per-year-302349728.html
- Consumer Reports, store-brand savings: https://www.consumerreports.org/money/store-private-label-brands/how-store-brand-groceries-can-help-you-save-a4379816935/
- Numerator, private-label vs national-brand price gap: https://www.numerator.com/press/price-gap-growing-between-private-label-and-national-brands/
- Sci-Tech Today (aggregating Statista), iPhone vs Android user income: https://www.sci-tech-today.com/stats/iphone-vs-android-user-statistics/
- Pew Research Center, Mobile Fact Sheet: https://www.pewresearch.org/internet/fact-sheet/mobile/
- StatCounter, US Mobile OS Market Share: https://gs.statcounter.com/os-market-share/mobile/united-states-of-america
- Census Reporter (ACS 2024 1-yr), United States: https://censusreporter.org/profiles/01000US-united-states/
- Census Reporter, Salt Lake City metro: https://censusreporter.org/profiles/31000US41620-salt-lake-city-ut-metro-area/
- Census Reporter, Washington–Arlington–Alexandria (DMV) metro: https://censusreporter.org/profiles/31000US47900-washington-arlington-alexandria-dc-va-md-wv-metro-area/
- Census Reporter, Nashville metro: https://censusreporter.org/profiles/31000US34980-nashville-davidson-murfreesboro-franklin-tn-metro-area/
- Census Reporter, Franklin, TN: https://censusreporter.org/profiles/16000US4727740-franklin-tn/
- Census Reporter, Seattle–Tacoma–Bellevue metro: https://censusreporter.org/profiles/31000US42660-seattle-tacoma-bellevue-wa-metro-area/
- Ibotta — Wikipedia: https://en.wikipedia.org/wiki/Ibotta
- Ibotta — Investor Relations: https://investors.ibotta.com
- Ibotta — StockAnalysis (financials): https://stockanalysis.com/stocks/IBTA/financials/
- Ibotta — StockAnalysis: https://stockanalysis.com/stocks/IBTA/
- Instacart — Wikipedia: https://en.wikipedia.org/wiki/Instacart
- Instacart — StockAnalysis (financials): https://stockanalysis.com/stocks/CART/financials/
- Instacart — StockAnalysis: https://stockanalysis.com/stocks/CART/
- Instacart+ pricing: https://www.instacart.com/instacart-plus
- Waze — Wikipedia: https://en.wikipedia.org/wiki/Waze
- GasBuddy — Wikipedia: https://en.wikipedia.org/wiki/GasBuddy
- Flipp — corporate about page: https://corp.flipp.com/about
- RevenueCat, State of Subscription Apps 2024: https://www.revenuecat.com/state-of-subscription-apps-2024/
- RevenueCat, State of Subscription Apps 2025: https://www.revenuecat.com/state-of-subscription-apps-2025/
- ReferralCandy, Dropbox referral program case study: https://www.referralcandy.com/blog/dropbox-referral-program
- FTC, Surveillance Pricing Staff Perspective: https://www.ftc.gov/reports/surveillance-pricing-staff-perspective
- Dynamic pricing (ESL, Wendy's, Maryland 2026 law) — Wikipedia: https://en.wikipedia.org/wiki/Dynamic_pricing
- Price gouging (US state-law context) — Wikipedia: https://en.wikipedia.org/wiki/Price_gouging
- National Law Forum, FTC surveillance pricing study summary: https://nationallawforum.com/2025/01/20/ftc-surveillance-pricing-study-uncovers-personal-data-used-to-set-individualized-consumer-prices/
- FTC press release, surveillance pricing study (Jan 2025): https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-surveillance-pricing-study-indicates-wide-range-personal-data-used-set-individualized-consumer
- Retail Brew, FTC chair shuts surveillance-pricing comment period: https://www.retailbrew.com/stories/2025/01/24/new-ftc-chair-shuts-down-public-comment-on-retailers-surveillance-pricing
- Grocery Dive, Kroger ESL Senate scrutiny (Warren/Casey): https://www.grocerydive.com/news/kroger-electronic-shelf-labels-instore-technology-senators-inflation/723939/
- Arnold & Porter, algorithmic pricing bans (CA AB 325, NY): https://www.arnoldporter.com/en/perspectives/advisories/2025/10/algorithmic-pricing-bans-go-coast-to-coast
- Food & Power, FTC grocery supply-chain / greedflation report: https://www.foodandpower.net/latest/ftc-supply-chain-disruption-grocery-food-processing-report-apr-24
- NYT, FTC grocery pricing report (March 2024): https://www.nytimes.com/2024/03/21/us/politics/grocery-prices-pandemic-ftc.html
- EFF, scraping public websites and the CFAA (hiQ v. LinkedIn): https://www.eff.org/deeplinks/2022/04/scraping-public-websites-still-isnt-crime-court-appeals-declares
- Datasembly, Price Intelligence Suite (grocery price-data vendor): https://datasembly.com/price-intelligence-suite/
- GetLatka, Basket (basket.com) company profile: https://getlatka.com/companies/basket.com
- PYMNTS, consumers switching to cheaper retailers: https://www.pymnts.com/news/retail/2024/consumers-switch-to-cheaper-retailers-but-hesitant-to-leave-grocers/
- Subscription Insider, subscription fatigue data: https://medium.com/@subscriptioninsider/subscription-fatigue-is-real-heres-what-the-data-shows-9fa40d32087e
- Plotline, mobile app retention rates by industry: https://www.plotline.so/blog/retention-rates-mobile-apps-by-industry
- Sendbird, app retention benchmarks by industry: https://sendbird.com/blog/app-retention-benchmarks-broken-down-by-industry
- Flipp, consumer app (savings claim): https://flipp.com/

### Sources flagged as needing verification (not citably retrieved this pass)
- Atozy subscriber/follower counts (Social Blade/YouTube blocked) — **critical to the CAC thesis; confirm before any external use.**
- Audience→install conversion rate for creator-led app launches (no clean public benchmark retrieved).
- Fetch Rewards user count / valuation; GasBuddy Premium current price; Instacart+ member count.
- Paid CPI/CAC fintech benchmarks (Business of Apps blocked) — $5–15 CPI / $30–60 CPA used as directional only.
- Basket app-store removal date (Feb 2026, per AppBrain via aggregator) — worth manual confirmation.
- The "Aldi ~36%" figure is from an ALDI-commissioned EY QUEST study (best-case, full switch); treat as a *ceiling*, not SmartCart's marginal saving.
