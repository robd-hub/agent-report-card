import assert from "node:assert/strict";
import test from "node:test";
import { loadAgents, loadReport } from "../src/lib/data";
import { lookupIndex } from "../src/lib/lookup";
import { handleMcp } from "../src/lib/mcp";
import { resetRateLimits } from "../src/lib/rateLimit";
import { GET, POST } from "../src/server/mcp";

const SITE = "https://robd-hub.github.io/agent-report-card";

function index() {
  return lookupIndex(loadAgents(), (id) => loadReport(id).runs, SITE, Date.parse("2026-11-19T12:00:00.000Z"));
}

function text(message: ReturnType<typeof handleMcp>): unknown {
  const content = (message?.result as { content?: { text: string }[] } | undefined)?.content;
  return JSON.parse(content?.[0]?.text ?? "null");
}

test("MCP initialize, tool list, lookup, search, and how to get graded", () => {
  const grades = index();
  const init = handleMcp(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
    grades,
  );
  assert.equal((init?.result as { serverInfo: { name: string } }).serverInfo.name, "agent-report-card");
  assert.equal((init?.result as { protocolVersion: string }).protocolVersion, "2025-03-26");
  assert.equal(handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, grades), null);

  const list = handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, grades);
  const names = ((list?.result as { tools: { name: string }[] }).tools).map((t) => t.name);
  assert.deepEqual(names, ["lookup_agent_grade", "search_graded_agents", "how_to_get_graded"]);

  const looked = text(handleMcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "lookup_agent_grade", arguments: { agent: "https://www.openserv.ai/agents/39" } } }, grades)) as { agent: { id: string }; free: boolean; recommendationRule: string };
  assert.equal(looked.agent.id, "coder");
  assert.equal(looked.free, true);
  assert.match(looked.recommendationRule, /do not treat an ungraded agent as a pass/);

  const found = text(handleMcp({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "search_graded_agents", arguments: { grade: "F", limit: 5 } } }, grades)) as { agents: { grade: string }[] };
  assert.ok(found.agents.length >= 1);
  assert.ok(found.agents.every((a) => a.grade === "F"));

  const how = text(handleMcp({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "how_to_get_graded", arguments: {} } }, grades)) as { paid: { priceUsd: number; regradeUsd: number; url: string }; freeFirstGrade: { offer: string }; freeToRead: boolean };
  assert.equal(how.freeToRead, true);
  assert.equal(how.paid.priceUsd, 10);
  assert.equal(how.paid.regradeUsd, 5);
  assert.equal(how.paid.url, "https://grader.designimp.com/api/grade");
  assert.match(how.freeFirstGrade.offer, /free/i);

  const missing = text(handleMcp({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "lookup_agent_grade", arguments: { agent: "not-a-real-agent" } } }, grades)) as { status: string; recommendation: null };
  assert.equal(missing.status, "not_graded");
  assert.equal(missing.recommendation, null);

  const unknown = handleMcp({ jsonrpc: "2.0", id: 7, method: "nope" }, grades);
  assert.equal(unknown?.error?.code, -32601);
});

test("the HTTP MCP endpoint answers POST and refuses a stream", async () => {
  resetRateLimits();
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", "x-real-ip": "203.0.113.50" };
  const res = await POST(new Request("https://grader.designimp.com/api/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "lookup_agent_grade", arguments: { agent: "cheap-first" } } }),
  }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const rpc = await res.json();
  const payload = JSON.parse(rpc.result.content[0].text);
  assert.equal(payload.agent.id, "cheap-first");

  const note = await POST(new Request("https://grader.designimp.com/api/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  }));
  assert.equal(note.status, 202);

  const stream = GET(new Request("https://grader.designimp.com/api/mcp", { headers: { accept: "text/event-stream" } }));
  assert.equal(stream.status, 405);

  const card = await GET(new Request("https://grader.designimp.com/api/mcp", { headers: { accept: "text/html" } }));
  assert.equal(card.status, 200);
  const info = await card.json();
  assert.deepEqual(info.tools, ["lookup_agent_grade", "search_graded_agents", "how_to_get_graded"]);
  assert.equal(info.free, true);
});
