/**
 * POST /api/mcp
 *
 * Remote MCP endpoint (streamable HTTP). Stateless: each POST is one
 * JSON-RPC message, answered with application/json. Tools only read
 * published grades. Only served on Vercel.
 */
import { handleMcp, mcpCard } from "@/lib/mcp";
import { getIndex } from "@/server/catalog";
import { CORS, json, LIMITS, options, rateGate } from "@/server/http";

const MAX_BODY = 100_000;

export function GET(request: Request): Response {
  const accept = request.headers.get("accept") ?? "";
  const origin = new URL(request.url).origin;
  if (accept.includes("text/event-stream")) {
    return json(
      { error: "This server does not hold a stream open. POST a JSON-RPC message to this URL.", ...mcpCard(origin) },
      405,
      "no-store",
      { Allow: "POST, OPTIONS" },
    );
  }
  return json(mcpCard(origin), 200, "public, max-age=300");
}

export async function POST(request: Request): Promise<Response> {
  const gate = rateGate(request, "mcp", LIMITS.mcp);
  if (!gate.ok) return gate.response;
  const claimed = Number(request.headers.get("content-length") || 0);
  if (claimed > MAX_BODY) return json({ error: "Request body is too large." }, 413, "no-store", gate.headers);
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: "Request body is too large." }, 413, "no-store", gate.headers);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }, 400, "no-store", gate.headers);
  }
  const index = getIndex();
  const messages = Array.isArray(body) ? body : [body];
  const replies = messages.map((m) => handleMcp(m, index)).filter((r) => r !== null);
  if (!replies.length) return new Response(null, { status: 202, headers: { ...CORS, ...gate.headers } });
  const payload = Array.isArray(body) ? replies : replies[0];
  return json(payload, 200, "no-store", gate.headers);
}

export function OPTIONS(): Response {
  return options();
}
