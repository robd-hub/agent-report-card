import assert from "node:assert/strict";
import test from "node:test";
import { formatAnswer, isSafeTool, probeMcp, resultText, runMcpTask, textParam, type McpTool } from "../src/lib/mcpClient";
import { resetRateLimits } from "../src/lib/rateLimit";
import { findEndpoint, looksLikeMcpUrl } from "../src/lib/requests";
import { POST } from "../src/server/request";

const SIGNAL = () => AbortSignal.timeout(10_000);

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

function withFetch(handler: Handler) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => handler(new URL(String(input)), init)) as typeof fetch;
  return () => (globalThis.fetch = real);
}

/**
 * A streamable-HTTP MCP server in memory. Tool calls are answered by `onCall`.
 * With `sse`, replies come back as an event stream instead of JSON.
 */
function fakeServer(tools: McpTool[], onCall: (name: string, args: Record<string, unknown>) => string, opts: { sse?: boolean; status?: number } = {}) {
  const seen: { method: string; session: string | null; protocol: string | null }[] = [];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const handler: Handler = (url, init) => {
    if (opts.status) return new Response("no", { status: opts.status });
    if (init?.method === "DELETE") return new Response(null, { status: 200 });
    const headers = new Headers(init?.headers);
    const msg = JSON.parse(String(init?.body)) as { id?: number; method: string; params?: { name: string; arguments: Record<string, unknown> } };
    seen.push({ method: msg.method, session: headers.get("mcp-session-id"), protocol: headers.get("mcp-protocol-version") });
    if (msg.id === undefined) return new Response(null, { status: 202 });
    let result: unknown;
    if (msg.method === "initialize") result = { protocolVersion: "2025-03-26", serverInfo: { name: "Weather" }, capabilities: { tools: {} }, instructions: "Public weather data." };
    else if (msg.method === "tools/list") result = { tools };
    else if (msg.method === "tools/call") {
      calls.push({ name: msg.params!.name, args: msg.params!.arguments });
      result = { content: [{ type: "text", text: onCall(msg.params!.name, msg.params!.arguments) }] };
    }
    const reply = { jsonrpc: "2.0", id: msg.id, result };
    const extra: Record<string, string> = msg.method === "initialize" ? { "Mcp-Session-Id": "sess-1" } : {};
    if (opts.sse) {
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: {} })}\n\ndata: ${JSON.stringify(reply)}\n\n`, {
        headers: { "Content-Type": "text/event-stream", ...extra },
      });
    }
    return Response.json(reply, { headers: extra });
  };
  return { handler, seen, calls };
}

const forecast: McpTool = { name: "get_forecast", description: "Forecast for a city", inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } };

test("MCP addresses are told apart from other agents", () => {
  assert.equal(findEndpoint("https://example.com/mcp", "")?.adapter, "mcp");
  assert.equal(findEndpoint("https://example.com/api/mcp/", "")?.adapter, "mcp");
  assert.equal(findEndpoint("https://example.com/sse", "")?.adapter, "mcp");
  assert.equal(findEndpoint("https://mcp.example.com/", "")?.adapter, "mcp");
  assert.deepEqual(findEndpoint("mcp: https://example.com/rpc#x", ""), { endpoint: "https://example.com/rpc", adapter: "mcp" });
  assert.equal(findEndpoint("https://example.com/agent", "")?.adapter, "http-json");
  assert.equal(findEndpoint("https://example.com/v1/chat/completions", "m")?.adapter, "openai-compatible");
  assert.equal(findEndpoint("mcp:http://localhost/mcp", ""), null);
  assert.equal(looksLikeMcpUrl("https://example.com/mcpx"), false);
});

test("only read-only tools are called, and plain-text tools take the task as is", () => {
  assert.equal(isSafeTool({ name: "send_email" }), false);
  assert.equal(isSafeTool({ name: "deleteFile" }), false);
  assert.equal(isSafeTool({ name: "search_docs" }), true);
  assert.equal(isSafeTool({ name: "lookup", annotations: { destructiveHint: true } }), false);
  assert.equal(isSafeTool({ name: "create_summary", annotations: { readOnlyHint: true } }), true);
  assert.equal(textParam(forecast), "city");
  assert.equal(textParam({ name: "q", inputSchema: { properties: { query: { type: "string" } } } }), "query");
  assert.equal(textParam({ name: "q", inputSchema: { properties: { a: { type: "string" }, b: { type: "number" } }, required: ["a", "b"] } }), null);
  assert.equal(textParam({ name: "q", inputSchema: { properties: { unit: { type: "string", enum: ["c", "f"] } }, required: ["unit"] } }), null);
});

test("tool results are read as text", () => {
  assert.deepEqual(resultText({ content: [{ type: "text", text: "a" }, { type: "image", data: "x" }] }), { text: "a\n\n[image returned]", isError: false });
  assert.equal(resultText({ content: [], structuredContent: { t: 1 } }).text, '{\n  "t": 1\n}');
  assert.equal(resultText({ content: [{ type: "text", text: "bad" }], isError: true }).isError, true);
  assert.match(formatAnswer([]), /no tool was called/);
});

test("a one-tool server is called with the task, keeping its session", async () => {
  const s = fakeServer([forecast], (_n, a) => `Sunny in ${a.city}`);
  const restore = withFetch(s.handler);
  try {
    const answer = await runMcpTask({ id: "w", endpoint: "https://weather.example/mcp" }, "Paris", SIGNAL(), async () => assert.fail("no model needed"));
    assert.match(answer, /Tool `get_forecast` called with \{"city":"Paris"\}/);
    assert.match(answer, /Sunny in Paris/);
    assert.deepEqual(s.seen.map((x) => x.method), ["initialize", "notifications/initialized", "tools/list", "tools/call"]);
    assert.equal(s.seen[0].session, null);
    assert.equal(s.seen[3].session, "sess-1");
    assert.equal(s.seen[3].protocol, "2025-03-26");
  } finally {
    restore();
  }
});

test("replies sent as an event stream are read", async () => {
  const s = fakeServer([forecast], () => "Rain", { sse: true });
  const restore = withFetch(s.handler);
  try {
    assert.match(await runMcpTask({ id: "w", endpoint: "https://weather.example/mcp" }, "Oslo", SIGNAL()), /Rain/);
  } finally {
    restore();
  }
});

test("with several tools the driver picks, can chain calls, and never reaches a tool that changes things", async () => {
  const tools: McpTool[] = [
    { name: "search", inputSchema: { properties: { q: { type: "string" } }, required: ["q"] } },
    { name: "fetch_page", inputSchema: { properties: { id: { type: "string" } }, required: ["id"] } },
    { name: "send_message", inputSchema: { properties: { to: { type: "string" } } } },
  ];
  const s = fakeServer(tools, (n, a) => (n === "search" ? "id=42" : `Page ${a.id}: the answer is 7`));
  const restore = withFetch(s.handler);
  const offered: string[][] = [];
  let step = 0;
  const chat = async (_sys: string, user: string) => {
    offered.push([...user.matchAll(/^- (\w+):/gm)].map((m) => m[1]));
    step++;
    if (step === 1) return '{"tool": "search", "arguments": {"q": "answer"}}';
    if (step === 2) return 'Sure: {"tool": "fetch_page", "arguments": {"id": "42"}}';
    return '{"tool": null}';
  };
  try {
    const answer = await runMcpTask({ id: "d", endpoint: "https://docs.example/mcp" }, "What is the answer?", SIGNAL(), chat);
    assert.deepEqual(s.calls.map((c) => c.name), ["search", "fetch_page"]);
    assert.match(answer, /the answer is 7/);
    assert.ok(offered.every((names) => !names.includes("send_message")));
    // A driver that names an unsafe tool is refused, not obeyed.
    await assert.rejects(runMcpTask({ id: "d", endpoint: "https://docs.example/mcp" }, "x", SIGNAL(), async () => '{"tool": "send_message", "arguments": {}}'), /doesn't offer/);
  } finally {
    restore();
  }
});

test("the older SSE transport works", async () => {
  const enc = new TextEncoder();
  let push: (s: string) => void = () => {};
  const restore = withFetch(async (url, init) => {
    if (!init?.method || init.method === "GET") {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          push = (s) => c.enqueue(enc.encode(s));
          push("event: endpoint\ndata: /messages?session=9\n\n");
        },
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    }
    assert.equal(url.pathname, "/messages");
    const msg = JSON.parse(String(init.body)) as { id?: number; method: string };
    if (msg.id !== undefined) {
      const result =
        msg.method === "initialize" ? { protocolVersion: "2024-11-05", serverInfo: { name: "Old" } } : msg.method === "tools/list" ? { tools: [forecast] } : { content: [{ type: "text", text: "Fog" }] };
      setTimeout(() => push(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n\n`), 5);
    }
    return new Response("Accepted", { status: 202 });
  });
  try {
    assert.match(await runMcpTask({ id: "old", endpoint: "https://old.example/sse" }, "Lima", SIGNAL()), /Fog/);
  } finally {
    restore();
  }
});

test("probing explains servers we can't test", async () => {
  let restore = withFetch(fakeServer([], () => "", { status: 401 }).handler);
  try {
    assert.match((await probeMcp("https://locked.example/mcp")).reason ?? "", /sign-in or API key/);
  } finally {
    restore();
  }
  restore = withFetch(fakeServer([{ name: "delete_all" }], () => "").handler);
  try {
    const p = await probeMcp("https://danger.example/mcp");
    assert.equal(p.ok, false);
    assert.match(p.reason ?? "", /read-only/);
  } finally {
    restore();
  }
});

test("the request form checks an MCP server before quoting a price", async () => {
  process.env.GITHUB_TOKEN = "ghp_x";
  resetRateLimits();
  const send = async (agent: string) => {
    const res = await POST(new Request("https://grader.designimp.com/api/request/", { method: "POST", body: JSON.stringify({ agent, whatItDoes: "Gives weather forecasts.", check: true }) }));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  let restore = withFetch(fakeServer([forecast], () => "").handler);
  try {
    const ok = await send("https://weather.example/mcp");
    assert.equal(ok.status, 200);
    assert.equal(ok.body.priceUsd, 10);
    assert.equal(ok.body.agentType, "mcp");
    assert.deepEqual(ok.body.mcp, { name: "Weather", tools: 1, usableTools: 1 });
  } finally {
    restore();
  }
  restore = withFetch(fakeServer([], () => "", { status: 403 }).handler);
  try {
    const refused = await send("https://locked.example/mcp");
    assert.equal(refused.status, 400);
    assert.equal(refused.body.field, "agent");
  } finally {
    restore();
  }
});
