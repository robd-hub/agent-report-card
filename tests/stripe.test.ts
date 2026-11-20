import assert from "node:assert/strict";
import test from "node:test";
import { parseIssueForm } from "../scripts/auto-grade";
import { checkPayment, findTxHash } from "../src/lib/payment";
import { requestFromSession, signWebhook, verifyWebhook, type StripeSession } from "../src/lib/stripe";
import { resetRateLimits } from "../src/lib/rateLimit";
import { orderGET, webhookPOST } from "../src/server/card";

const LIVE = "cs_live_a1B2c3D4e5F6g7H8i9J0";
const TEST = "cs_test_a1B2c3D4e5F6g7H8i9J0";
const SECRET = "whsec_testsecret";

function session(id: string, over: Partial<StripeSession> = {}): StripeSession {
  return {
    id,
    object: "checkout.session",
    payment_status: "paid",
    amount_total: 1000,
    currency: "usd",
    created: Math.floor(Date.now() / 1000) - 60,
    custom_fields: [
      { key: "agentlink", label: { custom: "Agent link" }, text: { value: "https://platform.openserv.ai/agents/123" } },
      { key: "whatitdoes", label: { custom: "What does it do?" }, text: { value: "Writes research summaries." } },
      { key: "agentname", label: { custom: "Agent name" }, text: { value: "Research Bot" } },
    ],
    ...over,
  };
}

/** Swaps global fetch for one that answers Stripe and GitHub from memory. */
function fakeFetch(sessions: Record<string, StripeSession>, issues: { html_url: string; body: string }[] = []) {
  const created: { title: string; body: string; labels: string[] }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const stripe = url.match(/api\.stripe\.com\/v1\/checkout\/sessions\/([^/?]+)/);
    if (stripe) {
      const s = sessions[decodeURIComponent(stripe[1])];
      return new Response(JSON.stringify(s ?? { error: {} }), { status: s ? 200 : 404 });
    }
    if (url.includes("api.github.com") && init?.method === "POST") {
      const issue = JSON.parse(String(init.body));
      created.push(issue);
      const html_url = `https://github.com/robd-hub/agent-report-card/issues/${100 + created.length}`;
      issues.unshift({ html_url, body: issue.body });
      return new Response(JSON.stringify({ html_url, number: 100 + created.length }), { status: 201 });
    }
    if (url.includes("api.github.com")) return new Response(JSON.stringify(issues), { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return { created, restore: () => (globalThis.fetch = real) };
}

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  return async () => {
    const old: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
      old[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(old)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
}

const KEYS = { STRIPE_SECRET_KEY: "rk_test_x", GITHUB_TOKEN: "ghp_x", STRIPE_WEBHOOK_SECRET: SECRET };

test("webhook signatures: good, tampered, stale", () => {
  const body = JSON.stringify({ type: "checkout.session.completed", data: { object: session(LIVE) } });
  assert.ok(verifyWebhook(body, signWebhook(body, SECRET), SECRET));
  assert.equal(verifyWebhook(body + " ", signWebhook(body, SECRET), SECRET), null);
  assert.equal(verifyWebhook(body, signWebhook(body, "whsec_other"), SECRET), null);
  assert.equal(verifyWebhook(body, signWebhook(body, SECRET, Math.floor(Date.now() / 1000) - 600), SECRET), null);
  assert.equal(verifyWebhook(body, null, SECRET), null);
});

test("a paid checkout becomes an issue body the grading bot reads", () => {
  const req = requestFromSession(session(LIVE))!;
  assert.equal(req.title, "Grade request: Research Bot");
  assert.deepEqual(req.labels, ["grade-request"]);
  const form = parseIssueForm(req.body);
  assert.equal(form["Where can we find it?"], "https://platform.openserv.ai/agents/123");
  assert.equal(form["What does it do?"], "Writes research summaries.");
  assert.equal(findTxHash(form["Payment transaction"]), LIVE);
  assert.doesNotMatch(req.body, /@/, "no email in the public issue");
});

test("dashboard-made fields are found by label, and a model name can follow the link", () => {
  const s = session(LIVE, {
    custom_fields: [
      { key: "whereisyouragent", label: { custom: "Where is your agent? (link)" }, text: { value: "https://example.com/v1/chat/completions my-model" } },
      { key: "whatdoesitdo", label: { custom: "What does it do?" }, text: { value: "Answers support tickets." } },
    ],
  });
  const form = parseIssueForm(requestFromSession(s)!.body);
  assert.equal(form["Where can we find it?"], "https://example.com/v1/chat/completions");
  assert.equal(form["Model name (OpenAI-style endpoints only)"], "my-model");
  assert.equal(form["What does it do?"], "Answers support tickets.");
});

test("a checkout without the agent link field opens nothing", () => {
  assert.equal(requestFromSession(session(LIVE, { custom_fields: [] })), null);
});

test(
  "the bot accepts a live card payment and refuses test ones unless allowed",
  withEnv({ STRIPE_SECRET_KEY: "rk_test_x", STRIPE_ALLOW_TEST: undefined }, async () => {
    const f = fakeFetch({ [LIVE]: session(LIVE), [TEST]: session(TEST) });
    try {
      const live = await checkPayment(LIVE, 10);
      assert.ok(live.ok && live.amountUsd === 10 && !live.test);
      const test1 = await checkPayment(TEST, 10);
      assert.ok(!test1.ok && /test payment/.test(test1.reason));
      process.env.STRIPE_ALLOW_TEST = "1";
      const test2 = await checkPayment(TEST, 10);
      assert.ok(test2.ok && test2.test, "test payment checked and flagged, so the bot won't grade it");
    } finally {
      f.restore();
    }
  }),
);

test(
  "a $5 card payment doesn't cover a new $10 grade",
  withEnv({ STRIPE_SECRET_KEY: "rk_test_x" }, async () => {
    const f = fakeFetch({ [LIVE]: session(LIVE, { amount_total: 500 }) });
    try {
      const check = await checkPayment(LIVE, 10);
      assert.ok(!check.ok && /costs \$10/.test(check.reason));
      assert.ok((await checkPayment(LIVE, 5)).ok);
    } finally {
      f.restore();
    }
  }),
);

test(
  "webhook opens one grade request per checkout, even when Stripe retries",
  withEnv({ ...KEYS, STRIPE_ALLOW_TEST: undefined }, async () => {
    const f = fakeFetch({});
    try {
      const body = JSON.stringify({ type: "checkout.session.completed", data: { object: session(LIVE) } });
      const send = (raw: string, sig = signWebhook(raw, SECRET)) =>
        webhookPOST(new Request("https://grader.designimp.com/api/stripe-webhook/", { method: "POST", body: raw, headers: { "stripe-signature": sig } }));
      assert.equal((await send(body)).status, 200);
      assert.equal((await send(body)).status, 200);
      assert.equal(f.created.length, 1);
      assert.equal((await send(body, "t=1,v1=bad")).status, 400);
      // Test payments are ignored unless STRIPE_ALLOW_TEST is set.
      const testBody = JSON.stringify({ type: "checkout.session.completed", data: { object: session(TEST) } });
      await send(testBody);
      assert.equal(f.created.length, 1);
    } finally {
      f.restore();
    }
  }),
);

test(
  "the /paid page lookup waits for the webhook, then opens the request itself",
  withEnv(KEYS, async () => {
    resetRateLimits();
    const f = fakeFetch({ [LIVE]: session(LIVE), cs_live_unpaidXXXXXXXXXX: session("cs_live_unpaidXXXXXXXXXX", { payment_status: "unpaid" }) });
    const ask = async (q: string) => (await orderGET(new Request(`https://grader.designimp.com/api/card-order/?${q}`))).json();
    try {
      assert.equal((await ask(`session=${LIVE}`)).status, "waiting");
      const opened = await ask(`session=${LIVE}&create=1`);
      assert.equal(opened.status, "opened");
      assert.equal((await ask(`session=${LIVE}&create=1`)).request, opened.request);
      assert.equal(f.created.length, 1);
      assert.equal((await ask("session=cs_live_unpaidXXXXXXXXXX")).status, "pending");
      assert.equal((await ask("session=nonsense")).status, "invalid");
    } finally {
      f.restore();
    }
  }),
);
