# Self-Managed vs. Managed Cloud — Architecture, Economics & Scale

A comparison of two ways to build SmartCart's backend: the **traditional "build & run it
yourself" scalable-architecture** approach (the Netflix/Meta/自建 lineage) versus **renting
managed primitives from a hyperscaler (AWS / Azure / GCP)**. It covers the **engineering
philosophy**, a **service-by-service equivalents map**, the **payment & contracting** models
(on-demand → reserved → spot → enterprise commitments → startup credits → egress/lock-in), and
the **enormous scale gap** between a startup and a hyperscaler — then a recommendation for
SmartCart. (Pricing/credits are as of 2026 and move constantly — verify before committing.)

---

## 1. Two philosophies

| | **Self-managed / DIY** (build the platform) | **Managed cloud** (rent the platform) |
|---|---|---|
| Goal | Maximum control, no lock-in, lowest unit cost **at huge scale** | Maximum velocity, minimal ops, **pay only for what you use** |
| You operate | OS, DBs, Kafka, k8s, patching, HA, backups, on-call for infra | Your code + config; the provider runs the undifferentiated heavy lifting |
| Cost shape | High fixed + people cost; cheap per-unit **once utilization is high** | ~Zero fixed; higher per-unit; cost tracks usage |
| Who wins with it | Hyperscalers at their own scale (Netflix on AWS but with deep custom tooling; Meta/Alibaba run **their own** data centers) | Startups, and almost everyone below ~$10M+/yr cloud spend |
| Failure mode | Small team drowns in infra ops instead of building product | Bill creep; lock-in; paying retail for idle capacity |
| Philosophy quote | "Control the whole stack; optimize every layer" | "Undifferentiated heavy lifting is someone else's job" |

The nuance most people miss: even the DIY exemplars are **hybrid**. Netflix builds elaborate
custom resilience tooling (Hystrix, EVCache, chaos) **but runs it on AWS**. Meta and Alibaba go
fully self-hosted **only because they operate at a scale where building data centers is cheaper
than renting** (see §5). A grocery startup is nowhere near that line — for SmartCart, "self-
managed" means *self-managed software on rented machines*, and the real choice is **managed
services vs. self-run open-source on VMs**.

---

## 2. The service-equivalents map ("what do I actually rent?")

Each SmartCart component (from `ARCHITECTURE.md`) → the managed service on each cloud, vs. the
self-run OSS you'd otherwise operate. **Choosing managed = deleting an on-call rotation.**

| SmartCart need | Self-run OSS | AWS | Azure | GCP |
|---|---|---|---|---|
| Run the API / workers | k8s on VMs you patch | ECS/EKS, Lambda, App Runner | AKS, Functions, Container Apps | GKE, Cloud Run, Cloud Functions |
| OLTP + PostGIS + pgvector | Postgres you operate | RDS / Aurora Postgres | Azure DB for PostgreSQL | Cloud SQL / AlloyDB |
| Time-series (price history) | TimescaleDB self-run | Timestream / Timescale on RDS | Azure Data Explorer | Bigtable / Timescale |
| Hot cache / leaderboards / metering | Redis you operate | ElastiCache / MemoryDB | Azure Cache for Redis | Memorystore |
| Search + vectors | OpenSearch self-run | OpenSearch Service | Azure AI Search | Vertex Vector Search |
| Object store (receipts/photos) | MinIO self-run | S3 | Blob Storage | Cloud Storage |
| Event stream | Kafka you operate | MSK / Kinesis | Event Hubs | Pub/Sub |
| Job queue | RabbitMQ self-run | SQS | Service Bus / Queue Storage | Cloud Tasks / Pub/Sub |
| Warehouse (KPIs) | ClickHouse self-run | Redshift | Synapse / Fabric | BigQuery |
| Edge / CDN / anti-scrape | nginx + custom WAF | CloudFront + WAF + Shield | Front Door + WAF | Cloud CDN + Cloud Armor |
| ML (OCR / vision / LLM) | self-host models | Bedrock + Textract + Rekognition | Azure OpenAI + AI Vision/Doc Intelligence | Vertex AI + Document AI |

> The **metadata/control-plane** difference: with managed services the provider's API *is* your
> ops layer — provisioning, scaling, backups, failover, patching, metrics are all just API/IaC
> calls (CloudFormation/Terraform, ARM/Bicep, Deployment Manager). With self-run OSS you build
> and own that control plane yourself. That control-plane labor — not the raw compute — is what
> you're really buying or building.

---

## 3. Payment & contracting — the part that actually decides your bill

Same hardware, wildly different prices depending on **how you pay**. Ascending commitment,
descending price:

| Model | What it is | Typical discount | Fit for SmartCart |
|---|---|---|---|
| **On-demand** | Pay per second/hour, no commitment | baseline (0%) | Default at MVP — unpredictable load |
| **Spot / Preemptible / Spot VMs** | Spare capacity, can be reclaimed anytime | **up to ~70–90% off** | **Batch ML, optimization precompute, re-scoring** — interruptible by design (pairs perfectly with the East "co-location/tidal" idea) |
| **GCP Sustained-Use** | Automatic discount for running >25% of the month | **~30%, no commitment** | Free money on GCP for always-on services |
| **Reserved Instances / Reservations** | Commit to an instance type, 1–3 yr | **~40% (1yr) → ~72% (3yr)** | Only once baseline load is steady (post-PMF) |
| **Savings Plans (AWS) / Savings Plan (Azure)** | Commit to **$/hour spend**, flexible across families | ~up to 66–72% | Better than RIs once spend is predictable |
| **GCP Committed Use Discounts** | Commit to vCPU/RAM in a region | **~37% (1yr) → ~55% (3yr)** | GCP's flexible commit |

**Enterprise contracting (the "签约" layer)** — you don't touch this until you're big, but it's
how the scale gap shows up in pricing:
- **AWS EDP** (Enterprise Discount Program) / **Private Pricing**: extra negotiated % for a
  multi-year total-spend commitment.
- **Azure MACC** (Microsoft Azure Consumption Commitment) + **EA**: e.g. a ~22% EDP-style
  discount **stacks** on a ~40% 3-yr reservation → paying ~**52% of on-demand**. MACC renewals
  in 2026 are reportedly getting **3–7 more points** vs. 2023–24 terms.
- **GCP custom contracts** on top of CUDs.
The lesson: **published prices are a starting point; large committed spend negotiates down hard.**
A startup pays nearly retail; a hyperscaler-scale buyer pays a fraction — pricing power *is* the
scale gap.

**Startup credits (how SmartCart should actually pay early) — 2026:**
- **AWS Activate:** Founders **$1K** self-serve; **up to $100K** via accelerator/VC; **GenAI up to $300K**.
- **Microsoft for Startups Founders Hub:** **up to $150K** Azure over ~4 yrs (drip-fed ~$25–50K/yr); self-serve without an investor now **~$5K**.
- **Google for Startups Cloud Program:** **up to $100K** (2 yrs); **up to $350K** for AI startups via partners — the most generous for AI.
→ For SmartCart this can mean **1–2 years of effectively free infrastructure**, which dwarfs any
per-unit price difference between providers. **Optimize for credits + portability, not list price.**

**Egress & lock-in (the exit cost):** providers historically charged **$0.05–$0.12/GB** to move
data *out*, which quietly locks you in (compute is competitive; **egress is the moat**). Under
**EU Data Act pressure, AWS/Azure/GCP now waive egress when you fully leave** — but only on
**account closure, full migration, within ~60 days**, not for normal multi-cloud operation; the
Act mandates switching fees disappear by **2027**. Practically: **assume moving providers is
expensive**, so keep portable seams (next section).

---

## 4. The scale gap — and why it dictates the decision

The distance between SmartCart and a hyperscaler is not 10× or 100×; it's **many orders of
magnitude**, and that gap is exactly why renting beats building:

| Dimension | A hyperscaler / giant | SmartCart at launch |
|---|---|---|
| Reads/sec | Meta TAO: **>1B reads/sec**; WeChat **1.4B MAU** | dozens → thousands/sec |
| Fleet | ByteDance Gödel: **tens of thousands of nodes**, >95% GPU util | a handful of containers |
| Peak engineering | Alibaba 双11: **千万-QPS** load tests, 8-hr elastic builds | one weekend rush |
| AI | DeepSeek trains on **2,048 H800s**; Netflix EVCache **400M ops/s** | a few managed-inference calls |
| Data centers | **Owned, globally** (cheaper than renting *at their scale*) | zero — rent everything |
| Pricing power | Negotiated EDP/MACC → fraction of list | retail, minus startup credits |

**Implications for SmartCart:**
1. **Don't rebuild what you can rent.** Every system in §2 took these companies hundreds of
   engineer-years. You get them as an API call. Building your own Kafka/Cassandra/k8s at 50 users
   is pure opportunity-cost destruction (the 从0到1 canon in `proven-patterns-east.md` §8 says the
   same: monolith + managed first).
2. **You rent their scale curve.** Managed autoscaling, multi-AZ HA, and global edge mean
   SmartCart inherits hyperscaler-grade reliability without operating it — the cell-based,
   active-active, edge patterns in `proven-patterns.md` are mostly **configuration** on top of
   managed services, not infrastructure you build.
3. **Their cost-efficiency tricks still apply to you — via the same primitives.** Spot/preemptible
   VMs + a scheduler give you the East's **在离线混部 / tidal** win (§3 here, `proven-patterns-east.md`
   §1) without owning a data center: run batch ML/optimization on Spot, co-located, overnight.
4. **The DIY break-even is real but far away.** Self-hosting (or repatriating, à la 37signals)
   only wins once utilization is high and spend is large and steady — a post-PMF, $1M+/yr-spend
   question, governed by the same trigger discipline as service extraction in `scaling-playbook.md`.

---

## 5. Recommendation for SmartCart

1. **Start fully managed on one cloud, funded by startup credits.** Pick the provider with the
   best credit + managed-Postgres/AI fit (GCP is strong for AI credits + BigQuery + AlloyDB;
   AWS for breadth; Azure if the OpenAI stack matters). **Optimize for credits and velocity, not
   list price** — credits dwarf per-unit differences at this stage.
2. **Keep portable seams** (the lock-in hedge): standard **Postgres**, **S3-compatible** object
   storage, **Kafka-API** streaming, **OCI containers**, **Terraform** IaC. This keeps the EU-Data-
   Act exit realistic and preserves negotiating leverage. Avoid deep proprietary lock-in for
   *core* data; proprietary is fine for *non-core* convenience (e.g. managed OCR).
3. **Pay smart from day one:** on-demand/serverless for spiky online tiers (scale to ~zero
   overnight), **Spot/preemptible for all batch ML & optimization precompute** (interruptible by
   design = the cheapest compute), and GCP sustained-use if on GCP. **Defer reserved/committed
   discounts until load is steady** (post-PMF) — don't lock in capacity you can't yet predict.
4. **Don't self-host infrastructure until a component hits its cost/scale trigger** — same
   discipline as extracting a service. The first candidate to ever bring in-house is usually the
   **ML inference** (DeepSeek-style owned models) once per-call managed-AI cost dominates the bill;
   everything else stays managed far longer.

> Bottom line: the West's DIY *architecture patterns* (TAO/H3/Netflix/cells) are what to **design**;
> the hyperscalers' *managed services* are what to **run them on**; the East's *cost techniques*
> (co-location/tidal/quantized AI) are how to **run them cheaply** — and **startup credits +
> Spot + portable seams** are how a community-funded grocery app affords all of it.

---

## Sources

- Commitment discounts — [AWS vs Azure vs GCP pricing 2026](https://www.usage.ai/blog/cloud-pricing-comparison-aws-azure-gcp) ·
  [Reserved vs Savings vs Spot](https://www.cloudoptimo.com/blog/reserved-instances-vs-savings-plans-vs-spot-what-actually-saves-more/) ·
  [AWS Savings Plans vs RIs 2026](https://holori.com/aws-savings-plans-vs-reserved-instances-which-should-you-choose-in-2026/)
- Startup credits — [AWS Activate / MS Founders Hub / Google for Startups 2026](https://cloudkompas.com/blog/free-cloud-credits-for-startups-AWS-azure-google-cloud-oci) ·
  [Microsoft for Startups 2026](https://cloudkompas.com/blog/microsoft-for-startups-2026) ·
  [AWS startup credits guide](https://creditforstartups.com/resources/aws-startup-credits)
- Egress & lock-in — [Microsoft joins AWS/Google on free egress (CIO Dive)](https://www.ciodive.com/news/microsoft-azure-eliminates-cloud-data-egress-fees/710367/) ·
  [EU Data Act & egress (Computer Weekly)](https://www.computerweekly.com/news/366630430/EU-Data-Act-prompts-Google-to-scrap-data-transfer-fees-for-UK-multicloud-users) ·
  [Egress fees compared](https://lowcloud.io/en/blog/cloud-egress-fees)
