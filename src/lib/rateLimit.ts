/**
 * A small in-memory limit for the free read endpoints. It only stops a
 * runaway loop from one address. Reading a grade does not call a paid API,
 * so the limits are high. On Vercel each instance has its own memory, which
 * is enough for this: a real flood is spread out, and a single stuck client
 * still gets told to slow down.
 */

interface Hit {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

const buckets = new Map<string, number[]>();

/** Drops every bucket. Tests use this so one case does not trip the next. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Sliding window. `now` is injectable so tests don't depend on the clock.
 * When the map gets huge (lots of distinct keys), it is cleared: the limit
 * is a courtesy, not a lock.
 */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): Hit {
  if (buckets.size > 8000) buckets.clear();
  const cutoff = now - windowMs;
  const prev = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (prev.length >= limit) {
    buckets.set(key, prev);
    const retryAfterSec = Math.max(1, Math.ceil((prev[0] + windowMs - now) / 1000));
    return { ok: false, remaining: 0, retryAfterSec };
  }
  prev.push(now);
  buckets.set(key, prev);
  return { ok: true, remaining: Math.max(0, limit - prev.length), retryAfterSec: 0 };
}

/** The caller's address, as the host reports it. Falls back to "local". */
export function clientIp(request: Request): string {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  return "local";
}
