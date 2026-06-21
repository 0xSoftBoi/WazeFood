// Entry point: bootstrap the app (with durable drivers if configured), seed the demo metro on
// first run, wire gateway middleware (identity + edge rate limit) and routes, and listen.
// Periodically flushes write-behind buffers and flushes on shutdown.

import { bootstrap } from "./bootstrap.ts";
import { loadConfig } from "./config.ts";
import { Router } from "./platform/http/router.ts";
import { identity, rateLimit } from "./platform/http/middleware.ts";
import { registerRoutes } from "./routes.ts";
import { seedDemo } from "./seed.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const durable = await bootstrap(config);
  const { app } = durable;

  // Seed the demo metro only when the catalog is empty (so durable restarts keep real data).
  if (app.catalog.listProducts().length === 0) {
    await seedDemo(app);
  }
  await durable.flush();

  const router = new Router()
    .use(identity())
    .use(rateLimit(app.cache, config.rateLimitPerMin));
  registerRoutes(router, app);

  // Write-behind flush loop for the durable drivers.
  const flushTimer = setInterval(() => { void durable.flush().catch((e) => console.error("flush error:", e)); }, 2000);
  flushTimer.unref();

  const server = router.listen(config.port, () => {
    console.log(`SmartCart listening on :${config.port} (store=${durable.drivers.store}, cache=${durable.drivers.cache})`);
  });

  const shutdown = async () => {
    clearInterval(flushTimer);
    server.close();
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
