// A tiny dependency-free router on node:http. Real deployments would front this with a
// managed gateway/CDN (docs/cloud-vs-self-managed.md), but the routing + middleware shape
// is the same.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AppError } from "../errors.ts";

export type Ctx = {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  headers: IncomingMessage["headers"];
  // Identity attached by middleware (anonymous-first: deviceId always, userId when known).
  deviceId: string;
  userId: string | null;
};

export type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
export type Route = (ctx: Ctx) => Reply | Promise<Reply>;
export type Middleware = (ctx: Ctx, next: () => Promise<Reply>) => Promise<Reply>;

type Compiled = { method: string; segments: string[]; handler: Route };

export class Router {
  private readonly routes: Compiled[] = [];
  private readonly middleware: Middleware[] = [];

  use(mw: Middleware): this {
    this.middleware.push(mw);
    return this;
  }

  add(method: string, pattern: string, handler: Route): this {
    this.routes.push({
      method: method.toUpperCase(),
      segments: pattern.split("/").filter((s) => s.length > 0),
      handler,
    });
    return this;
  }

  get(p: string, h: Route): this {
    return this.add("GET", p, h);
  }
  post(p: string, h: Route): this {
    return this.add("POST", p, h);
  }
  patch(p: string, h: Route): this {
    return this.add("PATCH", p, h);
  }

  private match(method: string, path: string): { handler: Route; params: Record<string, string> } | undefined {
    const parts = path.split("/").filter((s) => s.length > 0);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i] as string;
        const part = parts[i] as string;
        if (seg.startsWith(":")) {
          params[seg.slice(1)] = decodeURIComponent(part);
        } else if (seg !== part) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return undefined;
  }

  // Dispatch is exposed directly so tests can drive routes without opening a socket.
  async dispatch(input: {
    method: string;
    url: string;
    headers?: IncomingMessage["headers"];
    body?: unknown;
  }): Promise<Reply> {
    const url = new URL(input.url, "http://local");
    const found = this.match(input.method.toUpperCase(), url.pathname);
    const ctx: Ctx = {
      method: input.method.toUpperCase(),
      path: url.pathname,
      params: found?.params ?? {},
      query: url.searchParams,
      body: input.body,
      headers: input.headers ?? {},
      deviceId: "",
      userId: null,
    };

    const run = async (): Promise<Reply> => {
      if (found === undefined) return { status: 404, body: { error: "not_found" } };
      try {
        return await found.handler(ctx);
      } catch (e) {
        if (e instanceof AppError) {
          return { status: e.status, body: { error: e.code, message: e.message, details: e.details } };
        }
        return { status: 500, body: { error: "internal", message: (e as Error).message } };
      }
    };

    // Compose middleware around the handler.
    let chain = run;
    for (let i = this.middleware.length - 1; i >= 0; i--) {
      const mw = this.middleware[i] as Middleware;
      const next = chain;
      chain = () => mw(ctx, next);
    }
    return chain();
  }

  listen(port: number, onReady?: () => void) {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", async () => {
        let body: unknown = undefined;
        if (chunks.length > 0) {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            body = raw.length > 0 ? JSON.parse(raw) : undefined;
          } catch {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "bad_request", message: "invalid JSON" }));
            return;
          }
        }
        const reply = await this.dispatch({
          method: req.method ?? "GET",
          url: req.url ?? "/",
          headers: req.headers,
          body,
        });
        // String bodies are sent raw (HTML/text); everything else is JSON.
        const isRaw = typeof reply.body === "string";
        const contentType = reply.headers?.["content-type"] ?? (isRaw ? "text/plain; charset=utf-8" : "application/json");
        res.writeHead(reply.status, { ...(reply.headers ?? {}), "content-type": contentType });
        if (reply.body === undefined) res.end("");
        else res.end(isRaw ? (reply.body as string) : JSON.stringify(reply.body));
      });
    });
    server.listen(port, onReady);
    return server;
  }
}
