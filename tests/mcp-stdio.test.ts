import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadAgents, loadReport } from "../src/lib/data";
import { answerLookup, howToGetGraded, lookupIndex, parseSearch, RECOMMENDATION_RULE, searchAgents } from "../src/lib/lookup";

const SITE = "https://robd-hub.github.io/agent-report-card";
const NOW = Date.parse("2026-11-19T12:00:00.000Z");

function frame(obj: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"), body]);
}

function start(file: string) {
  const child = spawn(process.execPath, [path.join(process.cwd(), "mcp", "server.mjs")], {
    env: { ...process.env, ARC_LOOKUP_FILE: file },
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  let buf = Buffer.alloc(0);
  const queue: { id?: unknown; result?: { content?: { text: string }[] }; error?: { message: string } }[] = [];
  const waiters: ((msg: (typeof queue)[number]) => void)[] = [];
  child.stdout.on("data", (chunk: Buffer) => {
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
      const startAt = headerEnd + 4;
      if (buf.length < startAt + len) return;
      const msg = JSON.parse(buf.slice(startAt, startAt + len).toString("utf8"));
      buf = buf.slice(startAt + len);
      const waiter = waiters.shift();
      if (waiter) waiter(msg);
      else queue.push(msg);
    }
  });
  const next = () => (queue.length ? Promise.resolve(queue.shift()!) : new Promise<(typeof queue)[number]>((resolve) => waiters.push(resolve)));
  const send = (obj: unknown) => child.stdin.write(frame(obj));
  return { child, next, send };
}

async function stop(child: ChildProcessWithoutNullStreams) {
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

function payload(msg: { result?: { content?: { text: string }[] } }) {
  return JSON.parse(msg.result?.content?.[0]?.text ?? "null");
}

test("stdio MCP reads a published index and matches the lookup library", { timeout: 20_000 }, async () => {
  const index = lookupIndex(loadAgents(), (id) => loadReport(id).runs, SITE, NOW);
  const file = path.join(os.tmpdir(), `arc-lookup-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(index));
  const server = start(file);
  try {
    server.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
    const init = await server.next();
    assert.equal((init.result as { serverInfo?: { name?: string } }).serverInfo?.name, "agent-report-card");
    server.send({ jsonrpc: "2.0", method: "notifications/initialized" });

    server.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "lookup_agent_grade", arguments: { agent: "https://www.openserv.ai/agents/39" } } });
    const looked = payload(await server.next());
    const expected = answerLookup("https://www.openserv.ai/agents/39", index);
    assert.equal(looked.agent.id, "coder");
    assert.equal(looked.grade, expected.grade);
    assert.equal(looked.score, expected.score);
    assert.equal(looked.recommendation, expected.recommendation);
    assert.equal(looked.judgesDisagree, expected.judgesDisagree);

    server.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "lookup_agent_grade", arguments: { agent: "not-a-real-agent" } } });
    const miss = payload(await server.next());
    assert.equal(miss.status, "not_graded");
    assert.equal(miss.recommendation, null);
    assert.equal(miss.message, 'No Agent Report Card grade for "not-a-real-agent" yet.');
    assert.equal(miss.getGraded.paid.priceUsd, 10);

    const parsed = parseSearch({ grade: "A", limit: "5" });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    server.send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "search_graded_agents", arguments: { grade: "A", limit: 5 } } });
    const found = payload(await server.next());
    const local = searchAgents(index.agents, parsed.query);
    assert.deepEqual(found.agents.map((a: { id: string }) => a.id), local.agents.map((a) => a.id));

    server.send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "how_to_get_graded", arguments: {} } });
    const how = payload(await server.next());
    assert.equal(how.paid.regradeUsd, 5);
    assert.equal(how.recommendationRule, RECOMMENDATION_RULE);
    assert.match(how.freeFirstGrade.offer, /free/i);
  } finally {
    await stop(server.child);
    fs.rmSync(file, { force: true });
  }
});

test("stdio MCP reports an ambiguous name instead of guessing", { timeout: 20_000 }, async () => {
  const file = path.join(os.tmpdir(), `arc-lookup-ambiguous-${process.pid}.json`);
  const record = (id: string) => ({
    agent: { id, name: "Twin", description: "twin" },
    status: "graded",
    grade: "B",
    score: 80,
    recommendation: "hire",
    why: "Grade B: hire.",
    reportUrl: `https://example.com/agents/${id}/`,
  });
  fs.writeFileSync(file, JSON.stringify({
    recommendationRule: RECOMMENDATION_RULE,
    howToGetGraded: howToGetGraded(),
    aliases: { "name:twin": ["a", "b"], "id:a": ["a"], "id:b": ["b"] },
    agents: [record("a"), record("b")],
  }));
  const server = start(file);
  try {
    server.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "lookup_agent_grade", arguments: { agent: "Twin" } } });
    const hit = payload(await server.next());
    assert.equal(hit.status, "ambiguous");
    assert.deepEqual(hit.matches.map((m: { id: string }) => m.id).sort(), ["a", "b"]);
  } finally {
    await stop(server.child);
    fs.rmSync(file, { force: true });
  }
});
