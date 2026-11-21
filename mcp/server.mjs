#!/usr/bin/env node
/**
 * Stdio MCP server for Agent Report Card.
 *
 * Speaks MCP over stdin/stdout and answers from the published grade list
 * (the static /lookup/index.json on GitHub Pages), so it never calls the
 * paid grade endpoint and needs no API key. Set ARC_LOOKUP_FILE to a local
 * index, or ARC_LOOKUP_URL to point somewhere else.
 *
 * The alias keys match src/lib/lookup.ts queryKeys(). Cursor and Claude
 * Desktop config is in the README, under "For agents".
 */
import fs from "node:fs";

const PAGES_INDEX = "https://robd-hub.github.io/agent-report-card/lookup/index.json";
const PROTOCOL = "2025-03-26";
const KNOWN = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);

const TOOLS = [
  {
    name: "lookup_agent_grade",
    description:
      "Look up an AI agent's Agent Report Card grade before hiring it. Free. Pass an id, a name, an OpenServ marketplace link or number, or the agent's own https address. Returns the grade, score, date graded, task summary, the judges-disagree flag, a hire/caution/avoid recommendation, and the report and badge URLs. Not graded yet is a normal result and includes how to order a grade.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Agent id, name, OpenServ marketplace link or number, or the agent's own https address" },
      },
      required: ["agent"],
    },
  },
  {
    name: "search_graded_agents",
    description:
      "List graded agents, highest score first. Filter by grade (A to F), category (research, writing, crypto, code-data, assistants), recommendation (hire, caution, avoid), or words in the name. Free.",
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
      "How to get an agent graded by Agent Report Card. Reading grades is free. Ordering a grade is paid (POST /api/grade, USDC on Base). Also describes the free first grade.",
    inputSchema: { type: "object", properties: {} },
  },
];

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function endpointKey(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return (u.host + u.pathname).replace(/\/+$/, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Same order as queryKeys() in src/lib/lookup.ts. */
function queryKeys(query) {
  const q = String(query ?? "").trim();
  if (!q) return [];
  if (/^https?:\/\//i.test(q)) {
    const keys = [];
    const badge = findBadge(q);
    if (badge) keys.push(`badge:${badge}`);
    const market = q.match(/agents?\/(\d+)/i)?.[1];
    if (market) keys.push(`market:${market}`);
    const ep = endpointKey(q);
    if (ep) keys.push(`endpoint:${ep}`);
    return keys;
  }
  if (/^\d+$/.test(q)) return [`market:${q}`];
  const badge = findBadge(q);
  return [...(badge ? [`badge:${badge}`] : []), `id:${q.toLowerCase()}`, `name:${norm(q)}`];
}

/** Same as findBadge() in src/lib/concordium.ts: a Concordium registry badge (base58 token address). */
function findBadge(text) {
  const m = text.match(/(?:badge-check|check-badge|cis-2:)\/?([1-9A-HJ-NP-Za-km-z]{12,40})/) ?? text.trim().match(/^([1-9A-HJ-NP-Za-km-z]{12,40})$/);
  return m ? m[1] : null;
}

function resolveQuery(query, index) {
  const records = index.agents ?? [];
  const aliases = index.aliases ?? {};
  for (const key of queryKeys(query)) {
    const ids = aliases[key];
    if (!ids?.length) continue;
    const found = ids.map((id) => records.find((r) => r.agent?.id === id)).filter(Boolean);
    if (found.length > 1) return { kind: "ambiguous", records: found };
    if (found.length === 1) return { kind: "one", record: found[0] };
  }
  return { kind: "none" };
}

function notGraded(query, index, message) {
  return {
    version: 1,
    free: true,
    source: "Agent Report Card",
    status: query ? "not_graded" : "not_graded",
    recommendation: null,
    recommendationRule: index.recommendationRule,
    why: message,
    graded: false,
    grade: null,
    score: null,
    gradedAt: null,
    taskCount: 0,
    message,
    query,
    getGraded: index.howToGetGraded,
  };
}

function lookup(query, index) {
  const q = String(query ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 500);
  if (!q) {
    const message = "Pass agent as an id, a name, an OpenServ marketplace link, or the agent's own https address.";
    return notGraded(q, index, message);
  }
  const hit = resolveQuery(q, index);
  if (hit.kind === "one") return hit.record;
  if (hit.kind === "ambiguous") {
    const message = `More than one agent matches "${q}". Look one up by its id.`;
    return {
      ...notGraded(q, index, message),
      status: "ambiguous",
      matches: hit.records.map((r) => ({ id: r.agent.id, name: r.agent.name, grade: r.grade, reportUrl: r.reportUrl })),
    };
  }
  const message = `No Agent Report Card grade for "${q}" yet.`;
  return { ...notGraded(q, index, message), why: `${message} We can't recommend an agent we haven't graded.` };
}

const GRADES = ["A", "B", "C", "D", "F"];
const RECS = ["hire", "caution", "avoid"];
const CATEGORIES = ["research", "writing", "crypto", "code-data", "assistants"];

function search(args, index) {
  const q = String(args.query ?? args.q ?? "").trim().slice(0, 200);
  const grades = String(args.grade ?? "")
    .split(/[,\s]+/)
    .map((g) => g.toUpperCase())
    .filter(Boolean);
  for (const g of grades) {
    if (!GRADES.includes(g)) return { error: `Unknown grade "${g}". Use one of: ${GRADES.join(", ")}.` };
  }
  const category = String(args.category ?? "").toLowerCase();
  if (category && !CATEGORIES.includes(category)) return { error: `Unknown category "${category}". Use one of: ${CATEGORIES.join(", ")}.` };
  const recommendation = String(args.recommendation ?? "").toLowerCase();
  if (recommendation && !RECS.includes(recommendation)) return { error: `Unknown recommendation "${recommendation}". Use one of: ${RECS.join(", ")}.` };
  const limit = Math.min(50, Math.max(1, Math.floor(Number(args.limit) || 10)));
  const words = norm(q).split(" ").filter(Boolean);
  let rows = (index.agents ?? []).filter((r) => r.status === "graded");
  if (grades.length) rows = rows.filter((r) => grades.includes(r.grade));
  if (category) rows = rows.filter((r) => r.category === category);
  if (recommendation) rows = rows.filter((r) => r.recommendation === recommendation);
  if (words.length) {
    rows = rows.filter((r) => {
      const hay = norm(`${r.agent?.name ?? ""} ${r.agent?.description ?? ""} ${r.agent?.id ?? ""} ${r.category ?? ""}`);
      return words.every((w) => hay.includes(w));
    });
  }
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (a.agent?.name ?? "").localeCompare(b.agent?.name ?? ""));
  const agents = rows.slice(0, limit).map((r) => ({
    id: r.agent.id,
    name: r.agent.name,
    category: r.category,
    grade: r.grade,
    score: r.score,
    gradedAt: r.gradedAt,
    taskCount: r.taskCount,
    judgesDisagree: r.judgesDisagree,
    recommendation: r.recommendation,
    why: r.why,
    selfGraded: r.selfGraded,
    reportUrl: r.reportUrl,
    badgeUrl: r.badgeUrl,
    liveBadgeUrl: r.liveBadgeUrl,
  }));
  return {
    version: 1,
    free: true,
    source: "Agent Report Card",
    recommendationRule: index.recommendationRule,
    count: rows.length,
    limit,
    agents,
    ...(agents.length ? {} : { message: "No agents match. Reading grades is free; ordering a grade is paid." }),
    getGraded: index.howToGetGraded,
  };
}

let cached = null;
let cachedAt = 0;

async function loadIndex() {
  if (cached && Date.now() - cachedAt < 10 * 60 * 1000) return cached;
  if (process.env.ARC_LOOKUP_FILE) {
    cached = JSON.parse(fs.readFileSync(process.env.ARC_LOOKUP_FILE, "utf8"));
    cachedAt = Date.now();
    return cached;
  }
  const url = process.env.ARC_LOOKUP_URL || PAGES_INDEX;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Grade list responded ${res.status} from ${url}`);
  cached = await res.json();
  cachedAt = Date.now();
  return cached;
}

function textResult(payload, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], ...(isError ? { isError: true } : {}) };
}

async function handle(msg) {
  const hasId = Object.prototype.hasOwnProperty.call(msg, "id") && msg.id !== undefined;
  const id = typeof msg.id === "string" || typeof msg.id === "number" ? msg.id : null;
  const method = typeof msg.method === "string" ? msg.method : "";
  if (!hasId || method.startsWith("notifications/")) return null;
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (method === "initialize") {
    const requested = msg.params?.protocolVersion ?? PROTOCOL;
    return reply({
      protocolVersion: KNOWN.has(requested) ? requested : PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "agent-report-card", version: "0.1.1" },
      instructions:
        "Agent Report Card grades AI agents A to F. Use lookup_agent_grade before hiring an agent. Reading grades is free. Ordering a grade is paid. The recommendation field is hire, caution, or avoid, and every lookup includes the rule.",
    });
  }
  if (method === "ping") return reply({});
  if (method === "tools/list") return reply({ tools: TOOLS });
  if (method === "tools/call") {
    const name = typeof msg.params?.name === "string" ? msg.params.name : "";
    const args = msg.params?.arguments && typeof msg.params.arguments === "object" ? msg.params.arguments : {};
    let index;
    try {
      index = await loadIndex();
    } catch (e) {
      return reply(textResult({ error: `Couldn't read the public grade list. ${(e && e.message) || e}` }, true));
    }
    if (name === "lookup_agent_grade") {
      if (!String(args.agent ?? "").trim()) return reply(textResult({ error: "Pass agent: an id, name, OpenServ marketplace link, or https address." }, true));
      return reply(textResult(lookup(args.agent, index)));
    }
    if (name === "search_graded_agents") {
      const found = search(args, index);
      if (found.error) return reply(textResult({ error: found.error }, true));
      return reply(textResult(found));
    }
    if (name === "how_to_get_graded") return reply(textResult({ ...index.howToGetGraded, recommendationRule: index.recommendationRule }));
    return reply(textResult({ error: `Unknown tool "${name}". Use lookup_agent_grade, search_graded_agents, or how_to_get_graded.` }, true));
  }
  if (!method) return fail(-32600, "Missing method.");
  return fail(-32601, `Method not found: ${method}.`);
}

function send(obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

let buf = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const headerEnd = buf.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buf.slice(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buf = buf.slice(headerEnd + 4);
      continue;
    }
    const len = Number(match[1]);
    const start = headerEnd + 4;
    if (buf.length < start + len) return;
    const raw = buf.slice(start, start + len).toString("utf8");
    buf = buf.slice(start + len);
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } });
      continue;
    }
    Promise.resolve(handle(msg))
      .then((res) => {
        if (res) send(res);
      })
      .catch((e) => {
        const id = msg && (typeof msg.id === "string" || typeof msg.id === "number") ? msg.id : null;
        send({ jsonrpc: "2.0", id, error: { code: -32603, message: (e && e.message) || "Internal error" } });
      });
  }
});

process.stderr.write("agent-report-card mcp (stdio) ready\n");
