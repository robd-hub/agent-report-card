import assert from "node:assert/strict";
import test from "node:test";
import { bandFor, bandOfLetter, explainAgentError, findings, LITE_FORMAT_POOL, LITE_HONESTY_POOL, LITE_MAX_SERV_CALLS, LITE_MAX_TOKENS, pickFromPool, runLite, taskFields, type LiteChat } from "../src/lib/lite";
import type { McpTool } from "../src/lib/mcpClient";
import { loadAgents } from "../src/lib/data";
import { findEndpoint, knownEndpointFor } from "../src/lib/requests";
import type { AgentConfig } from "../src/lib/types";
import { resetRateLimits } from "../src/lib/rateLimit";
import { authorised, POST } from "../src/server/lite";
import { STANDARD_TASKS } from "../scripts/auto-grade";

/** A fake SERV: writes a task, picks a tool, or judges with the given scores in turn. */
function fakeChat(scores: number[]) {
  const calls: string[] = [];
  let i = 0;
  const chat: LiteChat = async (system) => {
    if (system.includes("design one fair test task")) {
      calls.push("write");
      return { text: JSON.stringify({ prompt: "What is 12 x 7?", criteria: "Says 84.", answer_keys: ["84"], word_budget: 20 }), inputTokens: 500, outputTokens: 60 };
    }
    if (system.includes("neutral test driver")) {
      calls.push("pick");
      return { text: JSON.stringify({ tool: "get_forecast", arguments: { city: "Leeds" } }), inputTokens: 800, outputTokens: 30 };
    }
    calls.push("judge");
    const score = scores[i++ % scores.length];
    return { text: JSON.stringify({ score, summary: `Scored ${score}.` }), inputTokens: 900, outputTokens: 40 };
  };
  return { chat, calls };
}

test("bands follow the average, and a failed honesty task keeps an agent out of strong", () => {
  assert.equal(bandFor(92, false), "strong");
  assert.equal(bandFor(80, false), "strong");
  assert.equal(bandFor(79, false), "mixed");
  assert.equal(bandFor(60, false), "mixed");
  assert.equal(bandFor(59, false), "weak");
  assert.equal(bandFor(95, true), "mixed");
  assert.equal(bandFor(null, false), "couldnt-check");
  assert.equal(bandOfLetter("A"), "strong");
  assert.equal(bandOfLetter("D"), "mixed");
  assert.equal(bandOfLetter("F"), "weak");
});

test("each SERV reply has room for the model's reasoning as well as its answer", () => {
  assert.ok(LITE_MAX_TOKENS >= 4000);
});

test("lite pool tasks never repeat a paid grade's standard tasks", () => {
  const paid = new Set(STANDARD_TASKS.map((t) => t.prompt));
  for (const t of [...LITE_FORMAT_POOL, ...LITE_HONESTY_POOL]) assert.equal(paid.has(t.prompt), false, t.id);
  assert.equal(pickFromPool(LITE_HONESTY_POOL, "a|2026-11", "h"), pickFromPool(LITE_HONESTY_POOL, "a|2026-11", "h"));
});

test("an agent gets three tasks, at most five SERV calls, and a band with findings that need fixing", async () => {
  const { chat, calls } = fakeChat([90, 60, 100]);
  const asked: string[] = [];
  const r = await runLite(
    { adapter: "http-json", endpoint: "https://agent.example.com/ask", whatItDoes: "Does arithmetic for people." },
    { chat, ask: async (p) => (asked.push(p), p.includes("12 x 7") ? "84." : "I don't know that, sorry."), seed: "x" },
  );
  assert.equal(asked.length, 3);
  assert.ok(calls.length <= LITE_MAX_SERV_CALLS);
  assert.equal(calls.filter((c) => c === "write").length, 1);
  assert.equal(r.tasks.length, 3);
  assert.equal(r.average, 83);
  assert.equal(r.band, "strong");
  // The 90 and 100 tasks are praise, so only the 60 is a finding.
  assert.deepEqual(r.findings.map((f) => f.text), ["Scored 60."]);
  assert.ok(r.cost.estimatedUsd > 0 && r.cost.estimatedUsd < 0.05);
  assert.equal(r.checks.find((c) => c.id === "reach")?.status, "pass");
  assert.match(r.note, /10 tasks and two independent judges/);
});

test("a failed honesty task caps the band at mixed", async () => {
  const { chat } = fakeChat([95, 95, 20]);
  const r = await runLite({ adapter: "http-json", endpoint: "https://agent.example.com/ask", whatItDoes: "Does arithmetic for people." }, { chat, ask: async () => "84", seed: "x" });
  // Judges run in task order: core, format, honesty.
  assert.equal(r.tasks.find((t) => t.kind === "honesty")?.score, 20);
  assert.equal(r.band, "mixed");
});

test("an agent that never answers gets couldn't check, not a weak band", async () => {
  const { chat, calls } = fakeChat([50]);
  const r = await runLite(
    { adapter: "http-json", endpoint: "https://agent.example.com/ask", whatItDoes: "Does arithmetic for people." },
    { chat, ask: async () => { throw new Error("Agent lite-check returned 500"); } },
  );
  assert.equal(r.band, "couldnt-check");
  assert.equal(r.average, null);
  assert.equal(calls.filter((c) => c === "judge").length, 0);
  assert.equal(r.checks.find((c) => c.id === "reach")?.status, "fail");
});

test("a wrapped or failed task write is retried once, and an unwritten task isn't held against the agent", async () => {
  assert.deepEqual(taskFields({ task: { prompt: "p", criteria: "c" } }), { prompt: "p", criteria: "c" });
  assert.deepEqual(taskFields([{ prompt: "p" }]), { prompt: "p" });
  for (const [first, second, expectCore] of [
    ["Sorry, here it is: nothing", JSON.stringify({ task: { prompt: "What is 12 x 7?", criteria: "Says 84." } }), true],
    ["{}", "{}", false],
  ] as const) {
    let writes = 0;
    const chat: LiteChat = async (system) => {
      if (system.includes("design one fair test task")) return { text: writes++ === 0 ? first : second, inputTokens: 1, outputTokens: 1 };
      return { text: JSON.stringify({ score: 85, summary: "Fine." }), inputTokens: 1, outputTokens: 1 };
    };
    const r = await runLite({ adapter: "http-json", endpoint: "https://agent.example.com/ask", whatItDoes: "Does arithmetic." }, { chat, ask: async () => "84", seed: "x" });
    assert.equal(writes, 2);
    assert.equal(r.tasks.find((t) => t.kind === "core")?.score !== null, expectCore);
    assert.equal(r.checks.find((c) => c.id === "reach")?.status, "pass");
    assert.equal(r.cost.servCalls <= LITE_MAX_SERV_CALLS, true);
  }
});

test("praise isn't a finding: tasks scoring 90 or more are left out", () => {
  const f = findings(
    [{ id: "reach", label: "Answers", status: "pass", detail: "ok" }],
    [
      { kind: "core", label: "Core job", score: 70, summary: "Missed a step." },
      { kind: "format", label: "Follows instructions", score: 95, summary: "Followed the format exactly." },
    ] as never,
  );
  assert.deepEqual(f, [{ from: "Core job", text: "Missed a step." }]);
});

test("findings prefer the weakest task, then a free check that didn't pass", () => {
  const f = findings(
    [
      { id: "reach", label: "Answers", status: "pass", detail: "ok" },
      { id: "shape", label: "Answer shape", status: "warn", detail: "Buried answer." },
    ],
    [
      { kind: "core", label: "Core job", score: 95, summary: "Great.", ms: 1 },
      { kind: "format", label: "Follows instructions", score: 40, summary: "Broke the word limit.", ms: 1 },
    ],
  );
  assert.deepEqual(f, [
    { from: "Follows instructions", text: "Broke the word limit." },
    { from: "Answer shape", text: "Buried answer." },
  ]);
});

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;
function withFetch(handler: Handler) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => handler(new URL(String(input)), init)) as typeof fetch;
  return () => (globalThis.fetch = real);
}

function mcpServer(tools: McpTool[], onCall: (name: string, args: Record<string, unknown>) => { text: string; isError?: boolean } | "rpc-error") {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const handler: Handler = (_url, init) => {
    if (init?.method === "DELETE") return new Response(null, { status: 200 });
    const msg = JSON.parse(String(init?.body)) as { id?: number; method: string; params?: { name: string; arguments: Record<string, unknown> } };
    if (msg.id === undefined) return new Response(null, { status: 202 });
    if (msg.method === "initialize") return Response.json({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "Weather" } } });
    if (msg.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: msg.id, result: { tools } });
    calls.push({ name: msg.params!.name, args: msg.params!.arguments });
    const r = onCall(msg.params!.name, msg.params!.arguments);
    if (r === "rpc-error") return Response.json({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "city is required" } });
    return Response.json({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: r.text }], isError: r.isError ?? false } });
  };
  return { handler, calls };
}

const forecast: McpTool = { name: "get_forecast", description: "Forecast for a city", inputSchema: { type: "object", properties: { city: { type: "string" }, days: { type: "number" } }, required: ["city"] } };

test("an MCP server gets free tool checks, a bad call and one judged real call", async () => {
  const tools: McpTool[] = [forecast, { name: "send_alert", inputSchema: { type: "object" } }, { name: "list_cities" }];
  const server = mcpServer(tools, (_n, args) => (args.city ? { text: "Leeds: 12C, light rain" } : { text: "city is required", isError: true }));
  const restore = withFetch(server.handler);
  try {
    const { chat, calls } = fakeChat([85]);
    const r = await runLite({ adapter: "mcp", endpoint: "https://weather.example.com/mcp", whatItDoes: "Weather forecasts for any city." }, { chat });
    assert.equal(r.kind, "mcp");
    assert.equal(r.band, "strong");
    assert.equal(calls.length, 3); // write, pick, judge
    const status = Object.fromEntries(r.checks.map((c) => [c.id, c.status]));
    assert.equal(status.reach, "pass");
    assert.equal(status.descriptions, "fail"); // 2 of 3 tools undescribed
    assert.equal(status.schemas, "warn"); // list_cities has none
    assert.equal(status.powers, "warn"); // send_alert
    assert.equal(status["bad-call"], "pass");
    // send_alert is never called.
    assert.ok(server.calls.every((c) => c.name !== "send_alert"));
    assert.deepEqual(server.calls.at(-1), { name: "get_forecast", args: { city: "Leeds" } });
  } finally {
    restore();
  }
});

test("a bad call that returns an error passes, and one that returns a normal result warns", async () => {
  for (const [reply, expected] of [["rpc-error", "pass"], [{ text: "ok, here is nothing" }, "warn"]] as const) {
    const restore = withFetch(mcpServer([forecast], (_n, a) => (a.city ? { text: "Leeds: 12C" } : reply)).handler);
    try {
      const { chat } = fakeChat([70]);
      const r = await runLite({ adapter: "mcp", endpoint: "https://weather.example.com/mcp", whatItDoes: "Weather forecasts for any city." }, { chat });
      assert.equal(r.checks.find((c) => c.id === "bad-call")?.status, expected);
    } finally {
      restore();
    }
  }
});

test("an MCP server that can't be reached is couldn't check, with no AI spend", async () => {
  const restore = withFetch(() => new Response("no", { status: 401 }));
  try {
    const { chat, calls } = fakeChat([70]);
    const r = await runLite({ adapter: "mcp", endpoint: "https://weather.example.com/mcp", whatItDoes: "Weather forecasts for any city." }, { chat });
    assert.equal(r.band, "couldnt-check");
    assert.equal(calls.length, 0);
    assert.equal(r.cost.servCalls, 0);
  } finally {
    restore();
  }
});

test("POST /api/lite is off without its secret, and refuses callers without it", async () => {
  resetRateLimits();
  const env = { ...process.env };
  try {
    delete process.env.LITE_SECRET;
    process.env.SERV_API_KEY = "k";
    const req = (auth?: string, body: unknown = { agent: "https://agent.example.com/ask", whatItDoes: "Does arithmetic." }) =>
      new Request("https://grader.designimp.com/api/lite/", { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify(body) });
    assert.equal((await POST(req())).status, 503);
    process.env.LITE_SECRET = "s".repeat(32);
    assert.equal((await POST(req())).status, 401);
    assert.equal((await POST(req("Bearer wrong"))).status, 401);
    assert.equal(authorised(req(`Bearer ${"s".repeat(32)}`)), true);
    assert.equal((await POST(req(`Bearer ${"s".repeat(32)}`, { agent: "http://localhost/x", whatItDoes: "Does arithmetic." }))).status, 400);
    assert.equal((await POST(req(`Bearer ${"s".repeat(32)}`, { agent: "https://openserv.ai/agents/833", whatItDoes: "Does arithmetic." }))).status, 400);
    process.env.LITE_ENABLED = "0";
    assert.equal((await POST(req(`Bearer ${"s".repeat(32)}`))).status, 503);
  } finally {
    process.env = env;
  }
});

test("a graded agent's home page is swapped for the address we grade it on", () => {
  const agents = [
    { id: "cheap-first", name: "Cheap First", description: "", adapter: "http-json", endpoint: "https://cheap-first.vercel.app/api/ask", tasks: [] },
    { id: "a", name: "A", description: "", adapter: "http-json", endpoint: "https://shared.example.com/a", tasks: [] },
    { id: "b", name: "B", description: "", adapter: "http-json", endpoint: "https://shared.example.com/b", tasks: [] },
  ] as unknown as AgentConfig[];
  const home = findEndpoint("https://cheap-first.vercel.app/", "")!;
  assert.deepEqual(knownEndpointFor(home, agents), { endpoint: "https://cheap-first.vercel.app/api/ask", adapter: "http-json" });
  assert.equal(knownEndpointFor(findEndpoint("https://Cheap-First.vercel.app", "")!, agents).endpoint, "https://cheap-first.vercel.app/api/ask");
  // A real path is left alone, and so is a host with more than one graded agent.
  assert.equal(knownEndpointFor(findEndpoint("https://cheap-first.vercel.app/api/other", "")!, agents).endpoint, "https://cheap-first.vercel.app/api/other");
  assert.equal(knownEndpointFor(findEndpoint("https://shared.example.com/", "")!, agents).endpoint, "https://shared.example.com/");
  assert.equal(knownEndpointFor(findEndpoint("https://unknown.example.com/", "")!, agents).endpoint, "https://unknown.example.com/");
  // The real catalogue maps Cheap First's home page too.
  assert.equal(knownEndpointFor(home, loadAgents()).endpoint, "https://cheap-first.vercel.app/api/ask");
});

test("a 404 or 405 from the agent is explained as a web page, not the agent's API", () => {
  assert.match(explainAgentError("Agent lite-check returned 405"), /web page rather than the agent's own API/);
  assert.match(explainAgentError("Agent lite-check returned 404"), /wasn't found \(404\)/);
  assert.equal(explainAgentError("Agent lite-check returned 500"), "Agent lite-check returned 500");
});
