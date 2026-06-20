# SmartCart — Proven Scale Patterns, East (阿里 · 美团 · 字节 · 腾讯/微信 · DeepSeek)

Western hyperscalers (TAO, H3, Netflix, Cloudflare) optimize for **scale**. The Chinese
giants operate at comparable scale **under brutal cost and peak constraints** — Singles' Day
(双11) traffic spikes, 60M food-delivery orders/day at razor-thin margins, billion-user
super-apps, and DeepSeek training a frontier model for ~1/10 the usual cost. So this is where
to learn **cost-efficiency at scale**, which is exactly what a bootstrapped grocery startup
needs. Sourced from the companies' own Mandarin engineering writing (美团技术团队, 阿里中间件,
字节火山引擎, 微信后台, DeepSeek 论文); terms kept in Chinese with translation.

| SmartCart problem | Who solved it (东) | Pattern adopted | Cost lever |
|---|---|---|---|
| Cheap compute at low average load with sharp peaks | **阿里 / 字节** 在离线混部 + 统一调度 | Co-locate online + offline on one pool; tidal scheduling | ~2× utilization → ~½ cost |
| Survive a grocery/holiday demand spike without 10× idle servers | **阿里** 双11 弹性 + 全链路压测 + Sentinel限流 | Rent cloud for peak then release; load-test per metro; shed load | Pay for peak only when it happens |
| Solve the cart/route optimization cheaply, in real time | **美团** 智能配送 运筹优化 | Layered OR+ML solver, precompute, <100ms real-time tier | Better routing = the savings we sell |
| Shard pricing/contribution data as cities grow | **美团** MTDDL/Zebra 分库分表 | Distributed data-access middleware, read/write split, online resharding | Scale storage linearly, no rewrite |
| Stay up + light under overload, on cheap phones | **微信** 海量之道 柔性可用 + 小程序 | FastReject overload protection; graceful degradation; mini-program-light client | Fewer servers; runs on low-end Android |
| Run OCR/vision/LLM on receipts without burning cash | **DeepSeek** MoE + MLA + FP8 | Sparse experts, KV-cache compression, low precision, cache+batch | 1/10 the naive AI cost |
| Turn conflicting crowd reports into truth | **真值发现 Truth Discovery** (学界) | Jointly estimate source reliability + value confidence, iterated | Trustworthy data without manual review |
| Don't over-build before you have scale | **创业 从0到1 架构演进 + 中台** | Monolith first; extract; shared "中台" capability layer | Minimal infra/team spend early |

---

## 1. The headline cost lever — 在离线混部 + 统一调度 (online/offline co-location)

**What 阿里 & 字节 do.** Online services are provisioned for peak but sit nearly idle most of
the time — Alibaba notes online clusters run **~10% CPU daily**, spiking only during promos.
The fix is **在离线混部** (co-locating online serving and offline batch jobs on the *same*
machines) under **one unified scheduler**, so the idle headroom does useful batch work.
ByteDance's **Gödel** scheduler pools microservices + batch + streaming + AI on one fabric
across **tens of thousands of nodes**, hitting **>60% CPU and >95% GPU utilization at peak**;
their **潮汐 (tidal) GPU** scheme lends 10k+ GPUs from online to offline at night, and
co-location **doubled overall utilization**. In ByteDance's own recsys (Monolith), dynamic
allocation raised average utilization **42% → 78%**.
([阿里在离线混部](https://www.alibabacloud.com/blog/the-evolution-of-large-scale-co-location-technology-at-alibaba_595595),
[字节 Gödel 统一调度 (SoCC)](https://developer.volcengine.com/articles/7359515064715935753),
[字节推荐系统绿色计算](https://blog.csdn.net/gitblog_00488/article/details/151288227))

**SmartCart application — this is the single biggest cost win.** SmartCart has the *exact*
shape: an online read path (price lookups) that's busy at shopping hours and idle overnight,
plus a heavy offline batch fleet (OCR, vision/product-match, embeddings, **confidence
re-scoring**, **optimization precompute**). Don't run two separate fleets:
- **Co-locate** the batch ML/optimization workers on the same nodes as online serving, low
  priority, so they soak up idle CPU/GPU. **Tidal-schedule** the optimizer/ML to run heavy
  jobs (re-score the day's contributions, precompute tomorrow's popular baskets per metro-cell)
  **overnight** when price-read traffic is near zero.
- Use a **single scheduler with priority classes** (online high / batch low, evictable). At MVP
  this is just Kubernetes priority + preemption; the *principle* — never let GPUs idle — is what
  matters. This roughly **halves infra cost** for the same work, which is decisive for a startup.

---

## 2. Peak handling — 双11 弹性 + 全链路压测 + 限流降级

**What 阿里 does.** Rather than own 10× hardware for one peak day, Alibaba builds a **混合云弹性**
(hybrid-cloud elastic) architecture: **rent cloud capacity for the spike, then release it** —
"一键建站 8 小时" (one-click stand up a unit in 8h), elastic scaling in 3h — and reports an
**8% YoY drop in compute cost per unit**. They de-risk peaks with **全链路压测** (full-link load
testing) at **千万级 QPS** using *thread-level isolated shadow data* on the real production
system, and protect themselves with **Sentinel** flow-control: throttle by thread count /
request rate / load, **auto-degrade weak dependencies to a "有损服务" (lossy but available)**
mode rather than fall over.
([双11高可用架构演进](https://developer.aliyun.com/article/159566),
[10年双11云化架构](https://www.alibabacloud.com/blog/594160))

**SmartCart application.** Grocery demand is spiky too — weekend mornings, the 1st-of-month,
holidays, and an Atozy video drop. Don't provision for the spike year-round:
- **Elastic for peak, release after.** Autoscale the stateless read/optimize/ML tiers on
  managed compute; scale to zero/low overnight. Pay for the Sunday rush only on Sunday.
- **全链路压测 before launching a metro.** Replay shadow traffic (isolated test data) through a
  new city's cell to size it *before* real users arrive — capacity planning by measurement, not
  guesswork.
- **Sentinel-style 限流降级.** Under overload, **degrade gracefully**: keep core price reads
  serving from cache, **defer** non-critical work (contribution scoring, leaderboard updates,
  precompute) and shed it first. "有损服务" beats an outage — and it means fewer reserve servers.

---

## 3. The optimizer — 美团 智能配送 运筹优化 (real-time OR at scale, cheaply)

**What 美团 does.** SmartCart's full-cart/route optimizer is a small cousin of Meituan's
dispatch — the world's largest minute-level delivery network: **>60M orders/day**, hundreds of
thousands of couriers, an **NP-hard** assignment+routing problem solved in **<100ms**, doing
**2.9 billion route-planning ops/hour** at peak. The architecture is **layered**: a **实时匹配层**
(real-time matching layer — highest frequency, shortest decision cycle) sits above heavier
planning layers, blending **运筹优化 (operations research) + machine learning**. The newer
**全域柔性调度** (global flexible dispatch) shares capacity across scenarios — explicitly
including **买菜 (grocery)**. Better algorithms cut **delivery distance 23.8%** and saved
**~$230M/year** — i.e. optimization quality *is* cost.
([美团运筹优化实战](https://tech.meituan.com/2020/02/20/meituan-delivery-operations-research.html),
[美团配送架构演进](https://www.cnblogs.com/kymdidicom/p/14249441.html),
[INFORMS: Meituan dispatching](https://pubsonline.informs.org/doi/10.1287/inte.2023.0084))

**SmartCart application.**
- **Layer the optimizer like Meituan.** A **real-time tier** answers most requests instantly
  from cached/heuristic plans (the precomputed popular-basket cache, keyed by `(cart, H3 cell,
  store set, price-version)`); a **planning tier** runs the heavier OR/ILP for novel carts and
  Max-Savings multi-store routing, async. Most users hit the cheap tier — exactly how Meituan
  keeps per-decision cost low at 60M orders/day.
- **OR + ML hybrid.** Use ML to prune the search (predict which stores/swaps matter for this
  user) and OR to produce the explainable, gas/time-adjusted plan — the same division of labor.
- **柔性 capacity across scenarios.** Item-compare, full-cart, and routing share one solver
  service with priority classes, instead of three fleets — flexible allocation = lower cost.

---

## 4. Data sharding as cities grow — 美团 MTDDL / Zebra (分库分表)

**What 美团 does.** Meituan built **MTDDL** and **Zebra** — distributed data-access middleware
giving **读写分离** (read/write splitting), **分库分表** (sharding), dynamic datasources,
distributed unique IDs, **SQL 流控** (flow control), and **online, no-downtime resharding** at
the **百亿级 (10-billion-row)** scale. Guidance: the **route key must exist and be unique in
every table and distribute evenly**; use **time as the archival key** for cold data.
([MTDDL 中间件](https://tech.meituan.com/2016/12/19/mtddl.html),
[美团百亿级分库分表不停机迁移](https://blog.csdn.net/crazymakercircle/article/details/131573734))

**SmartCart application.** This is the concrete recipe for the "metro = cell" data layer:
- **Shard pricing/contribution by `(metro, H3 cell)`** — the route key present in every relevant
  table, evenly distributed. **Read/write split**: the TAO-style hot read path goes to replicas;
  writes (ingestion) to the primary.
- **Online resharding when launching a city** — add a cell/shard with **no downtime**, exactly
  Meituan's no-stop migration, so growth never needs a maintenance window.
- **Time as the archive key** for `price_history` — roll old time-series to cold storage cheaply
  (also matches the Timescale retention plan).

---

## 5. Resilience + a light client — 微信 海量之道 (柔性可用) + 小程序

**What 微信 does.** WeChat serves **~1.4B MAU** on the **海量之道** ("the way of massive scale")
philosophy: **柔性可用** (elastic/graceful availability) and aggressive **过载保护** (overload
protection). Its **Svrkit** framework uses a QoS **FastReject** mechanism that **instantly sheds
requests beyond a service's capacity** to keep stable output under overload, and **PaxosStore**
provides HA strongly-consistent storage. On the client side, **小程序 (mini-programs)** —
**4M+** of them, **1.4B users** — are lightweight apps that run *inside* the shell **without
installation**, the ultimate "light on the device" model.
([微信后台演进](https://cloud.tencent.com/developer/article/2232218),
[微信读书后台架构](https://cloud.tencent.com/developer/article/2533072),
[WeChat 小程序生态](https://www.businessofapps.com/data/wechat-statistics/))

**SmartCart application.**
- **FastReject at the gateway.** Under a spike, instantly reject/queue *low-priority* work
  (extra optimization runs, image search) with a friendly "try again" while **guaranteeing the
  core price read** — protecting QoS with fewer reserve servers (cheaper than over-provisioning).
- **柔性可用 end to end.** Every degraded path returns *something useful* (last-known price +
  `as_of`, cached plan) instead of an error — the server-side twin of the offline-first client.
- **Mini-program-light surfaces.** Keep the app shell thin and load feature surfaces (deal feed,
  in-store mode, contributor tasks) as lightweight modules — directly serving the
  "fast on low-tier Android, frugal with mobile data" principle, and cheap to iterate.

---

## 6. AI cost — DeepSeek (MoE · MLA · FP8) for SmartCart's ML

**What DeepSeek does.** DeepSeek-V3 is the reference class in **cost-efficient AI**, and its
techniques are general:
- **MoE (混合专家):** 671B total params but **only 37B activated per token** → training cost
  **~1/10** of a same-size dense model. Sparse activation = pay only for the experts a request
  needs.
- **MLA (多头潜在注意力):** low-rank **KV-cache compression** to **~70 KB/token (≈1/7)**,
  slashing memory and boosting long-context throughput; V2 cut KV cache **93.3%** and lifted
  generation throughput **5.76×**.
- **FP8 低精度:** roughly **halves memory & compute** vs BF16 with **<0.25% quality loss**.
- **MTP / DualPipe:** multi-token prediction **+1.8× generation speed**; pipeline overlap
  **~2× throughput**. Net: frontier results on **2,048 H800s** doing the work of "tens of
  thousands."
([量子位: DeepSeek-V3 降本方法](https://www.qbitai.com/2025/05/283660.html),
[DeepSeek-V3 技术报告](https://arxiv.org/abs/2412.19437),
[DeepSeek-V2 (经济高效 MoE)](https://arxiv.org/abs/2405.04434))

**SmartCart application** — its biggest variable cost is ML on receipts/photos/queries:
- **Route cheap→expensive (MoE thinking).** Try the **small/on-device** model first (barcode,
  basic image filter, a small product-matcher); **escalate to a big model only on low
  confidence**. Don't run a giant model on every receipt — activate the "expert" the task needs.
- **Quantize (FP8/INT8)** the vision/OCR/embedding models — half the cost for sub-1% accuracy
  loss, plenty for grocery data with a confidence label already attached.
- **Cache + batch like an inference engine.** Dedup by **media hash** (a receipt re-uploaded on
  a flaky network is one inference, not many — pairs with the idempotency key); cache embeddings
  and product-match results; batch OCR/vision off the queue. KV/result caching is the cheapest
  GPU-hour — the one you never spend.

---

## 7. The Confidence Engine, formalized — 真值发现 (Truth Discovery)

**What the research says.** SmartCart's "turn conflicting price reports into a trusted price"
is the academic **真值发现 (truth discovery)** problem. Classic algorithms (e.g. **TruthFinder**)
**jointly and iteratively estimate two unknowns: each source's reliability and each value's
confidence** — a reliable source makes its claims more credible, and claims corroborated by
others make their sources look more reliable, until it converges. The crowdsourcing-quality
literature adds **worker-quality assessment/clustering** and pairs it with **anti-Sybil**
defenses.
([真值发现 / TruthFinder 笔记](https://blog.csdn.net/weixin_40530554/article/details/129282096),
[众包工人质量评估](https://blog.csdn.net/weixin_30847865/article/details/98323452))

**SmartCart application.** This is the formal backbone under the Waze-style engine (see
`proven-patterns.md` §6): compute `current_price` confidence by **truth discovery over the
recent reports for `(product, store, H3 cell)`**, weighting each report by its contributor's
reliability (karma/badges/history), and **update contributor reliability from how often their
reports agree with the converged truth** — the same virtuous loop, now with a named algorithm
instead of a hand-tuned formula. Cheap (it's iterative arithmetic over a small per-cell report
set) and it removes manual review from the hot path.

---

## 8. Don't over-build — 创业「从0到1」架构演进 + 中台

**What the Chinese startup-architecture canon says.** The consensus in the 从0到1 (zero-to-one)
literature: **start monolithic** (simple, fast, cheap); adopt microservices **only when business
volume + team size justify the added complexity and ops cost** — "简单业务系统单体架构优势更大."
The **中台 (middle platform)** idea: factor **shared, reusable capabilities** into a common layer
to raise **复用率 (reuse rate)** and cut duplicated build — a **数据中台** (data middle-platform)
for the core data asset, **业务中台** for capabilities reused across surfaces.
([从0到1 用架构套路节省创业公司机会成本](https://comet-project.gitbooks.io/cto-tech-manual/content/chapter2/longyin.html),
[单体到微服务再到中台](https://developer.aliyun.com/article/1541263))

**SmartCart application.** This independently confirms the plan's core strategy and sharpens it:
- **Modular monolith first; extract on trigger** — exactly `scaling-playbook.md`. The Chinese
  canon frames the cost explicitly: microservices' 运维成本 (ops cost) isn't worth it at 50 users.
- **Treat the price/data graph as SmartCart's 数据中台** — the one shared, reused-everywhere data
  asset (and the moat). **Entitlements, Identity, Gamification are 业务中台** — built once, reused
  across every surface (the "check entitlements once, everywhere" rule = 复用率).

---

## How the East changes the plan (deltas)

1. **Co-location + tidal scheduling (在离线混部) is the #1 cost lever:** one machine pool, online
   serving + low-priority batch ML/optimization, heavy jobs run overnight → ~2× utilization,
   ~½ infra cost. *New, and the biggest single saving.*
2. **Elastic-for-peak + 全链路压测 + Sentinel限流降级:** rent peak capacity then release;
   load-test a metro-cell before launch; shed low-priority work first ("有损服务" > outage).
3. **Layer the optimizer like Meituan:** cheap real-time tier (cache/heuristic) over an async
   OR+ML planning tier; flexible capacity across compare/cart/route. Optimization quality = the
   savings we sell.
4. **Sharding recipe is Meituan MTDDL/Zebra:** route key `(metro, H3 cell)` in every table,
   read/write split, **online no-downtime resharding** to add cities.
5. **微信 FastReject + 柔性可用:** gateway overload protection that guarantees core price reads;
   mini-program-light client surfaces for low-end Android.
6. **DeepSeek AI-cost playbook:** route cheap→expensive models (MoE-style), FP8/INT8 quantize,
   hash-dedup + cache + batch inference → ~order-of-magnitude lower ML spend.
7. **Confidence Engine = truth discovery:** named, iterative algorithm (source reliability ⇄
   value confidence) under the Waze loop.
8. **中台 framing:** the data graph is the 数据中台; entitlements/identity/gamification are
   业务中台 — confirms monolith-first + build-shared-capabilities-once.

> None of this is FAANG gold-plating. It's how operators on thin margins make a dollar of
> hardware do two dollars of work — which is exactly the constraint a community-funded grocery
> app launches under.

---

## Sources (来源)

- 阿里 — [双11高可用架构演进](https://developer.aliyun.com/article/159566) ·
  [10年双11云化架构](https://www.alibabacloud.com/blog/594160) ·
  [大规模在离线混部技术演进](https://www.alibabacloud.com/blog/the-evolution-of-large-scale-co-location-technology-at-alibaba_595595) ·
  [Double 11 全在阿里云](https://www.alibabagroup.com/en-US/document-1528849751804477440)
- 美团 — [智能配送系统的运筹优化实战](https://tech.meituan.com/2020/02/20/meituan-delivery-operations-research.html) ·
  [配送系统架构演进](https://www.cnblogs.com/kymdidicom/p/14249441.html) ·
  [MTDDL 分布式数据访问层中间件](https://tech.meituan.com/2016/12/19/mtddl.html) ·
  [INFORMS: Real-Time Intelligent Dispatching](https://pubsonline.informs.org/doi/10.1287/inte.2023.0084)
- 字节跳动 — [Gödel 统一资源调度 (SoCC 论文解读)](https://developer.volcengine.com/articles/7359515064715935753) ·
  [Spark 万卡模型推理](https://developer.volcengine.com/articles/7317465399778345011) ·
  [推荐系统绿色计算实践](https://blog.csdn.net/gitblog_00488/article/details/151288227)
- 腾讯/微信 — [微信后台系统的演进之路](https://cloud.tencent.com/developer/article/2232218) ·
  [微信读书后台架构演进](https://cloud.tencent.com/developer/article/2533072) ·
  [WeChat 统计与小程序生态](https://www.businessofapps.com/data/wechat-statistics/)
- DeepSeek — [量子位: V3 降本方法（梁文锋署名）](https://www.qbitai.com/2025/05/283660.html) ·
  [DeepSeek-V3 技术报告](https://arxiv.org/abs/2412.19437) ·
  [DeepSeek-V2: Economical & Efficient MoE](https://arxiv.org/abs/2405.04434)
- 真值发现 / 众包质量 — [TruthFinder 笔记](https://blog.csdn.net/weixin_40530554/article/details/129282096) ·
  [众包工人质量评估与聚类](https://blog.csdn.net/weixin_30847865/article/details/98323452)
- LBS 地理索引 — [LBS「附近的人」4种实现](https://zhuanlan.zhihu.com/p/130898985) ·
  [Redis GEO/GeoHash 查找附近的人](https://www.cnblogs.com/wmyskxz/p/12466945.html)
- 创业架构 — [从0到1 用架构套路节省创业公司机会成本](https://comet-project.gitbooks.io/cto-tech-manual/content/chapter2/longyin.html) ·
  [软件架构：从单体到微服务的演进](https://developer.aliyun.com/article/1541263)
