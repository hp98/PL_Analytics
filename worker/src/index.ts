// One-Stop FPL edge proxy (§3 hot plane). The FPL API sends no CORS headers, so
// the browser cannot call it directly; this Worker adds CORS and centralises
// caching so live polling never fans out per browser tab (§2).
//
// Behaviour (§10): cache-first with stale-while-revalidate, a best-effort per-IP
// throttle, and a circuit breaker that serves the last good payload when the
// upstream errors. Only public, read-only endpoints are proxied — never any
// authenticated endpoint, and never a login (§2/§4).

import { resolveRoute } from "./router";

const UA = "one-stop-fpl-worker/0.1 (+https://github.com/one-stop-fpl; educational)";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*", // public read-only data, no credentials
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

// Best-effort per-isolate rate limiter. Robust per-IP limiting needs a Durable
// Object or KV; this caps abusive bursts within one isolate and the shared cache
// absorbs the rest. Documented as a limitation for a production deployment.
const HITS = new Map<string, number[]>();
const RL_WINDOW_MS = 10_000;
const RL_MAX = 40;

function throttled(ip: string): boolean {
  const now = Date.now();
  const recent = (HITS.get(ip) ?? []).filter((ts) => now - ts < RL_WINDOW_MS);
  recent.push(now);
  HITS.set(ip, recent);
  return recent.length > RL_MAX;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

/** Fetch upstream and wrap into a self-managed, cacheable JSON response. */
async function buildCacheable(upstream: string): Promise<Response> {
  const res = await fetch(upstream, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  // Preserve the upstream content type: most routes are JSON, but the kit
  // images are PNG, so forcing JSON here would corrupt them.
  const contentType = res.headers.get("Content-Type") ?? "application/json; charset=utf-8";
  const body = contentType.startsWith("image/")
    ? await res.arrayBuffer()
    : await res.text();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "x-cached-at": String(Date.now()),
      // A long max-age lets the Cache API RETAIN the entry (it refuses to store
      // no-store/no-cache); real freshness + SWR is governed by `x-cached-at`
      // and the per-route TTL below, not by this header.
      "Cache-Control": "public, max-age=86400",
      ...CORS,
    },
  });
}

function withMeta(res: Response, cache: string): Response {
  const headers = new Headers(res.headers);
  headers.set("X-Cache", cache);
  return new Response(res.body, { status: res.status, headers });
}

async function revalidate(cache: Cache, key: Request, upstream: string): Promise<void> {
  try {
    const fresh = await buildCacheable(upstream);
    await cache.put(key, fresh);
  } catch {
    // Upstream down during revalidate — keep the existing stale entry (circuit
    // breaker): the last good payload continues to be served.
  }
}

export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/api") {
      return json({ service: "one-stop-fpl-worker", ok: true }, 200);
    }
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);

    const target = resolveRoute(url.pathname, url.search);
    if (!target) return json({ error: "not found" }, 404);

    const ip = request.headers.get("CF-Connecting-IP") ?? "local";
    if (throttled(ip)) return json({ error: "rate limited" }, 429);

    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: "GET" });
    const cached = await cache.match(cacheKey);

    if (cached) {
      const cachedAt = Number(cached.headers.get("x-cached-at") ?? 0);
      const fresh = Date.now() - cachedAt < target.ttl * 1000;
      if (fresh) return withMeta(cached, "HIT");
      // Stale: serve immediately and revalidate in the background (SWR).
      ctx.waitUntil(revalidate(cache, cacheKey, target.upstream));
      return withMeta(cached, "STALE");
    }

    // Cold miss: fetch upstream; if it errors there is no last-good to serve.
    try {
      const res = await buildCacheable(target.upstream);
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return withMeta(res, "MISS");
    } catch (err) {
      return json({ error: "upstream unavailable", detail: String(err) }, 502);
    }
  },
} satisfies ExportedHandler;
