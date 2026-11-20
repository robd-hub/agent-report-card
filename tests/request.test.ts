import assert from "node:assert/strict";
import test from "node:test";
import { parseIssueForm } from "../scripts/auto-grade";
import { PAY_ADDRESS } from "../src/lib/links";
import { USDC_BASE } from "../src/lib/payment";
import { resetRateLimits } from "../src/lib/rateLimit";
import { POST } from "../src/server/request";

const TX = "0x" + "ab".repeat(32);
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const pad = (addr: string) => "0x" + addr.slice(2).toLowerCase().padStart(64, "0");

/** Answers Base JSON-RPC (a USDC transfer of `usdc` dollars) and GitHub from memory. */
function fakeFetch(usdc: number) {
  const created: { title: string; body: string }[] = [];
  const issues: { html_url: string; body: string }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("base.org")) {
      const { method } = JSON.parse(String(init?.body));
      if (method === "eth_getTransactionReceipt") {
        return Response.json({
          result: {
            status: "0x1",
            blockNumber: "0x10",
            logs: [{ address: USDC_BASE, topics: [TRANSFER, pad("0x" + "11".repeat(20)), pad(PAY_ADDRESS)], data: "0x" + (usdc * 1e6).toString(16) }],
          },
        });
      }
      return Response.json({ result: { timestamp: "0x" + Math.floor(Date.now() / 1000 - 60).toString(16) } });
    }
    if (url.includes("api.github.com") && init?.method === "POST") {
      const issue = JSON.parse(String(init.body));
      created.push(issue);
      const html_url = `https://github.com/robd-hub/agent-report-card/issues/${200 + created.length}`;
      issues.unshift({ html_url, body: issue.body });
      return Response.json({ html_url }, { status: 201 });
    }
    if (url.includes("api.github.com")) return Response.json(issues);
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return { created, restore: () => (globalThis.fetch = real) };
}

const send = async (body: Record<string, string>) => {
  const res = await POST(new Request("https://grader.designimp.com/api/request/", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as Record<string, string> };
};

const form = { agent: "https://example.com/agent", whatItDoes: "Writes research summaries.", payment: `https://basescan.org/tx/${TX}`, name: "Research Bot" };

test("a paid USDC request opens one grade request the bot can read", async () => {
  process.env.GITHUB_TOKEN = "ghp_x";
  resetRateLimits();
  const f = fakeFetch(10);
  try {
    const first = await send(form);
    assert.equal(first.status, 201);
    assert.equal(first.body.status, "opened");
    const parsed = parseIssueForm(f.created[0].body);
    assert.equal(parsed["Where can we find it?"], "https://example.com/agent");
    assert.equal(parsed["Payment transaction"], `https://basescan.org/tx/${TX}`);
    assert.equal(parsed["What does it do?"], "Writes research summaries.");
    // Sending the same payment again points to the same request.
    const again = await send(form);
    assert.equal(again.body.request, first.body.request);
    assert.equal(f.created.length, 1);
  } finally {
    f.restore();
  }
});

test("an unpaid or underpaid request opens nothing", async () => {
  process.env.GITHUB_TOKEN = "ghp_x";
  resetRateLimits();
  const f = fakeFetch(5);
  try {
    const short = await send(form);
    assert.equal(short.status, 400);
    assert.equal(short.body.field, "payment");
    assert.match(short.body.error, /costs 10/);
    assert.equal((await send({ ...form, payment: "not a hash" })).body.field, "payment");
    assert.equal((await send({ ...form, agent: "my agent" })).body.field, "agent");
    assert.equal((await send({ ...form, whatItDoes: "" })).body.field, "whatItDoes");
    assert.equal(f.created.length, 0);
  } finally {
    f.restore();
  }
});

test("an already-graded agent pays the regrade price", async () => {
  process.env.GITHUB_TOKEN = "ghp_x";
  resetRateLimits();
  const f = fakeFetch(5);
  try {
    const res = await send({ ...form, agent: "https://platform.openserv.ai/agents/1046", payment: TX.replace("ab", "cd") });
    assert.equal(res.status, 201);
    assert.equal(res.body.priceUsd as unknown as number, 5);
  } finally {
    f.restore();
  }
});
