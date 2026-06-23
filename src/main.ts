// Entry point: bootstrap the app (with durable drivers if configured), seed the demo metro on
// first run, wire gateway middleware (identity + edge rate limit) and routes, and listen.
// Periodically flushes write-behind buffers and flushes on shutdown.

import { bootstrap } from "./bootstrap.ts";
import { type Config, loadConfig } from "./config.ts";
import { Router } from "./platform/http/router.ts";
import { identity, rateLimit, abuseGuard, cors } from "./platform/http/middleware.ts";
import { registerRoutes } from "./routes.ts";
import { seedDemo } from "./seed.ts";
import { isCityKey, seedCity } from "./seed-cities.ts";
import { Relay, consoleSink, httpSink, type Sink } from "./modules/outbox/relay.ts";

// Choose the outbox sink from config. Kafka is imported dynamically (zero-dep default path) and
// connects here so a down broker fails fast at startup rather than silently dropping the backlog.
async function resolveSink(config: Config): Promise<Sink> {
  if (config.outboxSink === "kafka") {
    if (config.kafkaBrokers.length === 0) throw new Error("OUTBOX_SINK=kafka requires KAFKA_BROKERS");
    const { createKafkaSink } = await import("./modules/outbox/kafka.ts");
    return createKafkaSink({ brokers: config.kafkaBrokers, topic: config.kafkaTopic });
  }
  if (config.outboxSink === "webhook") {
    if (config.outboxWebhookUrl === null) throw new Error("OUTBOX_SINK=webhook requires OUTBOX_WEBHOOK_URL");
    return httpSink(config.outboxWebhookUrl);
  }
  return consoleSink;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const durable = await bootstrap(config);
  const { app } = durable;

  // Seed the launch metro only when the catalog is empty (so durable restarts keep real data).
  // SEED_CITY selects a real metro (nyc/sea); anything else falls back to the SLC demo seed.
  if (app.catalog.listProducts().length === 0) {
    if (isCityKey(config.seedCity)) {
      const ref = await seedCity(app, config.seedCity);
      console.log(`Seeded ${ref.label}: ${ref.stores} stores, ${ref.products} products`);
    } else {
      await seedDemo(app);
    }
  }
  await durable.flush();

  const router = new Router({ maxBodyBytes: config.maxBodyBytes, requestTimeoutMs: config.requestTimeoutMs })
    .use(cors(config.corsOrigin)) // outermost: preflight + allow-headers for the web app build
    .use(identity((token) => app.auth.verifyAccess(token))) // verify access JWT (anonymous-ok)
    .use(rateLimit(app.cache, config.rateLimitPerMin)) // coarse first gate
    .use(abuseGuard(app.abuse)); // domain-specific anti-scraping score → decision
  registerRoutes(router, app);

  // Write-behind flush loop for the durable drivers.
  const flushTimer = setInterval(() => { void durable.flush().catch((e) => console.error("flush error:", e)); }, 2000);
  flushTimer.unref();

  // Outbox relay: fan the durable event log out to an external sink (console/webhook/Kafka).
  const sink = await resolveSink(config);
  const relay = new Relay({ outbox: app.outbox, sink });
  relay.start(1000);

  const server = router.listen(config.port, () => {
    console.log(`SmartCart listening on :${config.port} (store=${durable.drivers.store}, cache=${durable.drivers.cache}, relay=${sink.name})`);
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(flushTimer);
    relay.stop();
    // Stop accepting, let in-flight requests finish, then force-drop idle keep-alive sockets. A hard
    // deadline guarantees we exit even if a connection is wedged.
    server.close();
    server.closeIdleConnections();
    const deadline = setTimeout(() => server.closeAllConnections(), 10_000);
    deadline.unref();
    await durable.flush().catch(() => {});
    await sink.close?.().catch(() => {});
    await durable.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
