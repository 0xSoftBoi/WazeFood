# SmartCart runs TypeScript directly on Node 22 (native type stripping) — no build step.
FROM node:22-alpine

WORKDIR /app

# Install production deps only (pg + redis; the memory default needs neither at runtime).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Drivers default to in-memory; the compose/orchestrator sets STORE_DRIVER=postgres /
# CACHE_DRIVER=redis + DATABASE_URL / REDIS_URL for a durable deployment.
ENV STORE_DRIVER=memory
ENV CACHE_DRIVER=memory

# Run as the unprivileged built-in `node` user.
USER node

# Liveness: /health. (Orchestrators should also gate traffic on readiness: /ready.)
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/main.ts"]
