// Central configuration. The scaffold runs entirely on in-memory adapters so it needs no
// external services; env vars only matter when wiring real managed-cloud infra.

export type StoreDriver = "memory" | "postgres";
export type CacheDriver = "memory" | "redis";
export type OutboxSink = "console" | "webhook" | "kafka";

export type Config = {
  port: number;
  nodeEnv: string;
  storeDriver: StoreDriver;
  databaseUrl: string;
  cacheDriver: CacheDriver;
  redisUrl: string;
  rateLimitPerMin: number;
  h3Resolution: number;
  outboxSink: OutboxSink;
  outboxWebhookUrl: string | null;
  kafkaBrokers: string[];
  kafkaTopic: string;
  authSecret: string;
  accessTtlSec: number;
  refreshTtlSec: number;
  oidcGoogleAudiences: string[]; // Google OAuth client IDs accepted as id_token `aud`
  oidcAppleAudiences: string[]; // Apple service/app IDs accepted as id_token `aud`
  anthropicApiKey: string | null; // set → real VLM perception (OCR/extraction); else deterministic stub
  perceptionCheapModel: string;
  perceptionExpensiveModel: string;
  voyageApiKey: string | null; // set → real Voyage embeddings for matching; else local hashing embedder
  embeddingModel: string;
  maxBodyBytes: number;
  requestTimeoutMs: number;
  cacheRefreshMs: number; // Redis L1-mirror coherence poll (0 disables); makes reads see other nodes' writes
  corsOrigin: string; // Allow-Origin for the web app build ("*" in dev; set a concrete origin in prod)
  seedCity: string; // launch metro to seed on first boot ("nyc" | "sea"); see src/seed-cities.ts
};

function int(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

// Parse a comma-separated env var into a trimmed, non-empty list.
function csv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

// Pick the outbox sink: explicit OUTBOX_SINK wins; otherwise infer from what's configured
// (KAFKA_BROKERS → kafka, OUTBOX_WEBHOOK_URL → webhook, else the console default).
function resolveSink(env: NodeJS.ProcessEnv): OutboxSink {
  const explicit = env.OUTBOX_SINK as OutboxSink | undefined;
  if (explicit === "console" || explicit === "webhook" || explicit === "kafka") return explicit;
  if ((env.KAFKA_BROKERS ?? "").trim() !== "") return "kafka";
  if ((env.OUTBOX_WEBHOOK_URL ?? "").trim() !== "") return "webhook";
  return "console";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: int(env.PORT, 3000),
    nodeEnv: env.NODE_ENV ?? "development",
    storeDriver: (env.STORE_DRIVER as StoreDriver) ?? "memory",
    databaseUrl: env.DATABASE_URL ?? "postgres://smartcart:smartcart@localhost:5432/smartcart",
    cacheDriver: (env.CACHE_DRIVER as CacheDriver) ?? "memory",
    redisUrl: env.REDIS_URL ?? "redis://localhost:6379",
    rateLimitPerMin: int(env.RATELIMIT_PER_MIN, 120),
    h3Resolution: int(env.H3_RESOLUTION, 8),
    outboxSink: resolveSink(env),
    outboxWebhookUrl: env.OUTBOX_WEBHOOK_URL ?? null,
    kafkaBrokers: csv(env.KAFKA_BROKERS),
    kafkaTopic: env.KAFKA_TOPIC ?? "smartcart.events",
    authSecret: env.AUTH_SECRET ?? "dev-insecure-secret-change-me",
    accessTtlSec: int(env.ACCESS_TTL_SEC, 900), // 15 min
    refreshTtlSec: int(env.REFRESH_TTL_SEC, 1_209_600), // 14 days
    oidcGoogleAudiences: csv(env.GOOGLE_CLIENT_IDS),
    oidcAppleAudiences: csv(env.APPLE_CLIENT_IDS),
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? null,
    perceptionCheapModel: env.PERCEPTION_CHEAP_MODEL ?? "claude-haiku-4-5-20251001",
    perceptionExpensiveModel: env.PERCEPTION_EXPENSIVE_MODEL ?? "claude-opus-4-8",
    voyageApiKey: env.VOYAGE_API_KEY ?? null,
    embeddingModel: env.EMBEDDING_MODEL ?? "voyage-3",
    maxBodyBytes: int(env.MAX_BODY_BYTES, 8 * 1024 * 1024),
    requestTimeoutMs: int(env.REQUEST_TIMEOUT_MS, 30_000),
    cacheRefreshMs: int(env.CACHE_REFRESH_MS, 1_000),
    corsOrigin: env.CORS_ORIGIN ?? "*",
    seedCity: env.SEED_CITY ?? "nyc",
  };
}
