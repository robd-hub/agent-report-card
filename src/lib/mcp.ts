/**
 * Model Context Protocol (streamable HTTP and stdio) for the free lookup.
 * Three tools, all read-only: lookup_agent_grade, search_graded_agents,
 * how_to_get_graded. Nothing here calls the paid grade endpoint.
 */
import { answerLookup, howToGetGraded, parseSearch, searchAgents, type LookupIndex } from "./lookup";

export const MCP_SERVER = { name: "agent-report-card", version: "0.1.1" };

export const MCP_PROTOCOL = "2025-03-26";

const KNOWN_PROTOCOLS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);

export const MCP_TOOLS = [
  {
    name: "lookup_agent_grade",
    description:
      "Look up an AI agent's Agent Report Card grade before hiring it. Free. Pass an id, a name, an OpenServ marketplace link or number, the agent's own https address, or its Concordium Agent Registry badge. Returns the grade, score, date graded, task count, per-task and per-type summary, the judges-disagree flag, a hire/caution/avoid recommendation (the rule is in the response), the report and badge URLs, and a concordium block (the agent's registry badge, and the on-chain transaction holding this grade with a fingerprint check, so you can confirm the grade wasn't changed). Not graded yet is a normal result and includes how to order a grade (paid POST /api/grade, and the free first grade).",
    inputSchema: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          description: "Agent id, name, OpenServ marketplace link or number, the agent's own https address, or a Concordium Agent Registry badge",
        },
      },
      required: ["agent"],
    },
  },
  {
    name: "search_graded_agents",
    description:
      "List graded agents, highest score first. Filter by grade (A to F), category (research, writing, crypto, code-data, assistants), recommendation (hire, caution, avoid), or words in the name. Free. Use lookup_agent_grade for the full record of one agent.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to match in the name, id or description. Optional." },
        grade: { type: "string", description: 'Letter, or several separated by commas, for example "A" or "A,B". Optional.' },
        category: { type: "string", description: "research, writing, crypto, code-data, or assistants. Optional." },
        recommendation: { type: "string", description: "hire, caution, or avoid. Optional." },
        limit: { type: "number", description: "How many to return, 1 to 50. Default 10." },
      },
    },
  },
  {
    name: "how_to_get_graded",
    description:
      "How to get an agent graded by Agent Report Card. Reading grades is free. Ordering a grade is paid (POST /api/grade with USDC on Base, or CCD on Concordium through the grade request). Also describes the free first grade and the free grade for agents with a Concordium registry badge.",
    inputSchema: { type: "object", properties: {} },
  },
] as const;

export interface JsonRpc {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

function textResult(payload: unknown, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], ...(isError ? { isError: true } : {}) };
}

function callTool(name: string, args: Record<string, unknown>, index: LookupIndex): { ok: true; result: unknown } | { ok: false; message: string } {
  if (name === "lookup_agent_grade") {
    const agent = typeof args.agent === "string" ? args.agent : "";
    if (!agent.trim()) return { ok: false, message: "Pass agent: an id, name, OpenServ marketplace link, https address, or Concordium badge." };
    return { ok: true, result: textResult(answerLookup(agent, index)) };
  }
  if (name === "search_graded_agents") {
    const parsed = parseSearch(args);
    if (!parsed.ok) return { ok: false, message: parsed.error };
    return { ok: true, result: textResult(searchAgents(index.agents, parsed.query)) };
  }
  if (name === "how_to_get_graded") {
    return { ok: true, result: textResult({ ...howToGetGraded(), recommendationRule: index.recommendationRule }) };
  }
  return { ok: false, message: `Unknown tool "${name}". Use lookup_agent_grade, search_graded_agents, or how_to_get_graded.` };
}

/**
 * One JSON-RPC message. Returns null for notifications (no id), which the
 * caller must not answer.
 */
export function handleMcp(message: unknown, index: LookupIndex): JsonRpc | null {
  if (!message || typeof message !== "object") {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request is not a JSON object." } };
  }
  const msg = message as { id?: unknown; method?: unknown; params?: unknown };
  const hasId = Object.prototype.hasOwnProperty.call(msg, "id") && msg.id !== undefined;
  const id = typeof msg.id === "string" || typeof msg.id === "number" ? msg.id : null;
  const method = typeof msg.method === "string" ? msg.method : "";
  if (!hasId || method.startsWith("notifications/")) return null;
  const reply = (result: unknown): JsonRpc => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, messageText: string): JsonRpc => ({ jsonrpc: "2.0", id, error: { code, message: messageText } });

  if (method === "initialize") {
    const params = (msg.params ?? {}) as { protocolVersion?: string };
    const requested = params.protocolVersion ?? MCP_PROTOCOL;
    return reply({
      protocolVersion: KNOWN_PROTOCOLS.has(requested) ? requested : MCP_PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: MCP_SERVER,
      instructions:
        "Agent Report Card grades AI agents A to F. Use lookup_agent_grade before hiring or paying an agent; it also accepts a Concordium Agent Registry badge and returns the grade's on-chain record. Reading grades is free. Ordering a grade is paid. The recommendation field is hire, caution, or avoid, and every lookup includes the rule.",
    });
  }
  if (method === "ping") return reply({});
  if (method === "tools/list") return reply({ tools: MCP_TOOLS });
  if (method === "tools/call") {
    const params = (msg.params ?? {}) as { name?: unknown; arguments?: unknown };
    const name = typeof params.name === "string" ? params.name : "";
    const args = params.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, unknown>) : {};
    const called = callTool(name, args, index);
    if (!called.ok) return reply(textResult({ error: called.message }, true));
    return reply(called.result);
  }
  if (!method) return fail(-32600, "Missing method.");
  return fail(-32601, `Method not found: ${method}.`);
}

/** What a browser sees if it opens the MCP URL. Clients connect with POST. */
export function mcpCard(origin: string) {
  return {
    name: MCP_SERVER.name,
    version: MCP_SERVER.version,
    protocol: MCP_PROTOCOL,
    transport: "streamable-http",
    url: `${origin.replace(/\/$/, "")}/api/mcp`,
    tools: MCP_TOOLS.map((t) => t.name),
    free: true,
    docs: `${origin.replace(/\/$/, "")}/for-agents/`,
    note: "POST JSON-RPC to this URL. Reading grades is free. POST /api/grade is the paid call and is a different path.",
  };
}
