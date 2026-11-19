/**
 * Shared response helpers for the free read endpoints. No payment headers.
 */
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After",
};

/** One minute in the browser, five on a shared cache, then serve stale while revalidating. */
export const CACHE_MINUTE = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

/** Badges are images on other people's pages, so they can sit a little longer. */
export const CACHE_BADGE = "public, max-age=300, s-maxage=300, stale-while-revalidate=86400";

export const LIMITS = { lookup: 120, search: 60, badge: 600, mcp: 120 } as const;

export function json(body: unknown, status = 200, cache = CACHE_MINUTE, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body, null, 2) + "\n", {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache, ...CORS, ...extra },
  });
}

export function rateGate(
  request: Request,
  scope: string,
  limit: number,
): { ok: true; headers: Record<string, string> } | { ok: false; response: Response } {
  const hit = rateLimit(`${scope}:${clientIp(request)}`, limit, 60_000);
  const headers = { "X-RateLimit-Limit": String(limit), "X-RateLimit-Remaining": String(hit.remaining) };
  if (hit.ok) return { ok: true, headers };
  return {
    ok: false,
    response: json(
      { error: "Too many requests. Reading grades is free; this limit only stops a runaway loop.", retryAfterSec: hit.retryAfterSec },
      429,
      "no-store",
      { ...headers, "Retry-After": String(hit.retryAfterSec) },
    ),
  };
}

export function options(): Response {
  return new Response(null, { status: 204, headers: CORS });
}
