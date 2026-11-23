/**
 * POST /api/lite: the free Lite Check (src/lib/lite.ts), for Agent Parrot.
 *
 * Private: only a caller holding LITE_SECRET (sent as "Authorization: Bearer
 * <secret>") may start a run, because each run spends a few cents of SERV.
 * Agent Parrot does the sign-in, the per-agent and per-member limits and the
 * monthly budget before it calls here. This endpoint only adds a per-minute
 * limit and the safe-address rules.
 *
 * Send {"agent": "<https address, or mcp: address>", "model": "...",
 * "whatItDoes": "...", "name": "...", "task": "..."}. The reply is the
 * LiteResult as JSON. Nothing is saved here: no issue, no data file, no
 * leaderboard entry.
 *
 * Switched off unless LITE_SECRET and SERV_API_KEY are set; LITE_ENABLED=0
 * switches it off again. Only served on Vercel (scripts/prepare-server.ts).
 */
import { timingSafeEqual } from "node:crypto";
import { runLite } from "@/lib/lite";
import { loadAgents } from "@/lib/data";
import { findEndpoint, findMarketplaceId, knownEndpointFor } from "@/lib/requests";
import { json, rateGate } from "./http";

const NO_STORE = "no-store";
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\r/g, "").trim().slice(0, max);

/** True when the request carries the shared secret. */
export function authorised(request: Request, secret = process.env.LITE_SECRET ?? ""): boolean {
  if (secret.length < 16) return false;
  const m = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const a = Buffer.from(m[1].trim());
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.LITE_ENABLED === "0" || !process.env.LITE_SECRET || !process.env.SERV_API_KEY) {
    return json({ status: "unavailable", error: "The Lite Check isn't switched on here." }, 503, NO_STORE);
  }
  if (!authorised(request)) return json({ status: "unauthorised", error: "The Lite Check is only open to Agent Parrot." }, 401, NO_STORE);
  const gate = rateGate(request, "lite", 20);
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ status: "invalid", error: "Send the request as JSON." }, 400, NO_STORE);
  }
  const agentLink = clean(body.agent, 500);
  const model = clean(body.model, 100);
  const whatItDoes = clean(body.whatItDoes, 2000);
  if (findMarketplaceId(agentLink)) {
    return json({ status: "invalid", field: "agent", error: "OpenServ marketplace agents aren't in the Lite Check yet. Use the agent's own https address, or order a full Polly Test." }, 400, NO_STORE);
  }
  const given = findEndpoint(agentLink, model);
  if (!given) {
    return json(
      { status: "invalid", field: "agent", error: "Use a public https address (OpenAI-style /chat/completions addresses also need the model name; for an MCP server, use its address, or write mcp: before it)." },
      400,
      NO_STORE,
    );
  }
  // A graded agent's home page becomes the address we grade it on (Cheap First: / -> /api/ask).
  const found = knownEndpointFor(given, loadAgents());
  if (whatItDoes.length < 10) return json({ status: "invalid", field: "whatItDoes", error: "Say in a sentence what the agent does, so the check can pick a fair task." }, 400, NO_STORE);

  const result = await runLite({
    adapter: found.adapter,
    endpoint: found.endpoint,
    model: found.model,
    whatItDoes,
    name: clean(body.name, 200) || undefined,
    task: clean(body.task, 1000) || undefined,
  });
  return json({ status: "ok", agent: found.endpoint, adapter: found.adapter, ...result }, 200, NO_STORE, gate.headers);
}
