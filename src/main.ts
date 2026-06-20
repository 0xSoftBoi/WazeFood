// Entry point: build the app, seed the demo metro, wire gateway middleware (identity +
// edge rate limit) and routes, and listen.

import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { Router } from "./platform/http/router.ts";
import { identity, rateLimit } from "./platform/http/middleware.ts";
import { registerRoutes } from "./routes.ts";
import { seedDemo } from "./seed.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = buildApp(config);
  const refs = await seedDemo(app);

  const router = new Router()
    .use(identity())
    .use(rateLimit(app.cache, config.rateLimitPerMin));
  registerRoutes(router, app);

  router.listen(config.port, () => {
    console.log(`SmartCart listening on :${config.port} (metro=${refs.metro}, store=memory, cache=memory)`);
    console.log(`Try: curl localhost:${config.port}/prices/best?productId=${refs.products.eggs}&lat=${refs.at.lat}&lng=${refs.at.lng}`);
  });
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
