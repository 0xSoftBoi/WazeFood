// Central configuration. The scaffold runs entirely on in-memory adapters so it needs no
// external services; env vars only matter when wiring real managed-cloud infra.

export type StoreDriver = "memory" | "postgres";
export type CacheDriver = "memory" | "redis";

export type Config = {
  port: number;
  nodeEnv: string;
  storeDriver: StoreDriver;
  databaseUrl: string;
  cacheDriver: CacheDriver;
  redisUrl: string;
  rateLimitPerMin: number;
  h3Resolution: number;
  outboxWebhookUrl: string | null;
};

function int(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
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
    outboxWebhookUrl: env.OUTBOX_WEBHOOK_URL ?? null,
  };
}
