/**
 * GET /api/lookup?agent=<id, name, OpenServ marketplace link, or endpoint>
 *
 * Free pre-hire check. Reads the published grades and nothing else, so the
 * call costs us nothing and the caller nothing. Only served on Vercel;
 * scripts/prepare-server.ts writes the route file there. The same records
 * are static files at /lookup/<id>.json.
 */
import { answerLookup, cleanQuery } from "@/lib/lookup";
import { getIndex } from "@/server/catalog";
import { CACHE_MINUTE, json, LIMITS, options, rateGate } from "@/server/http";

export function GET(request: Request): Response {
  const gate = rateGate(request, "lookup", LIMITS.lookup);
  if (!gate.ok) return gate.response;
  const raw = new URL(request.url).searchParams.get("agent") ?? "";
  if (raw.length > 500) return json({ error: "That agent query is too long." }, 400, "no-store", gate.headers);
  return json(answerLookup(cleanQuery(raw), getIndex()), 200, CACHE_MINUTE, gate.headers);
}

export function OPTIONS(): Response {
  return options();
}
