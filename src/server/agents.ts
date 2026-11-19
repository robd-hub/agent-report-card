/**
 * GET /api/agents?grade=A&category=research&recommendation=hire&q=polymarket&limit=10
 *
 * Free list of graded agents, highest score first. Same grades as
 * GET /api/lookup, in a shorter shape. Only served on Vercel.
 */
import { parseSearch, searchAgents } from "@/lib/lookup";
import { getIndex } from "@/server/catalog";
import { CACHE_MINUTE, json, LIMITS, options, rateGate } from "@/server/http";

export function GET(request: Request): Response {
  const gate = rateGate(request, "search", LIMITS.search);
  if (!gate.ok) return gate.response;
  const params = new URL(request.url).searchParams;
  const input: Record<string, string> = {};
  for (const key of ["q", "query", "grade", "category", "recommendation", "limit", "offset", "sort", "graded"]) {
    const value = params.get(key);
    if (value !== null) input[key] = value;
  }
  const parsed = parseSearch(input);
  if (!parsed.ok) return json({ error: parsed.error }, 400, "no-store", gate.headers);
  return json(searchAgents(getIndex().agents, parsed.query), 200, CACHE_MINUTE, gate.headers);
}

export function OPTIONS(): Response {
  return options();
}
