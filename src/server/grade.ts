/**
 * POST /api/grade: request and pay for a grade in one call, with x402.
 *
 * Built for AI agents and scripts: no GitHub account needed. The caller sends
 *   {"agent": "<OpenServ marketplace link or a public https address>",
 *    "whatItDoes": "...", "task": "...", "model": "...", "contact": "..."}
 * and gets a 402 with the price ($10, or $5 for an agent already graded).
 * An x402 client pays and retries; we settle the payment, then open the
 * usual grade request issue with the payment transaction filled in, so the
 * grading bot (.github/workflows/auto-grade.yml) takes it from there.
 *
 * Only served on Vercel: scripts/prepare-server.ts writes the route file
 * (src/app/api/grade/route.ts) there before the build. The GitHub Pages
 * copy of the site is static and has no server.
 *
 * Needs GITHUB_TOKEN in Vercel: a fine-grained token for this repository with
 * "Issues: read and write". Without it the endpoint says it's unavailable
 * before asking for any payment.
 */
import { rateGate } from "./http";
import { probeMcp } from "@/lib/mcpClient";
import { findEndpoint, findMarketplaceId } from "@/lib/requests";
import { issueBody } from "@/lib/issueBody";

export { issueBody };
import { loadAgents } from "@/lib/data";
import { GRADE_PRICE_USD, REGRADE_PRICE_USD } from "@/lib/links";
import { decodePayment, encodeHeader, paymentFrom, paymentRequired, paymentRequiredV2, requirements, settlePayment, settlePaymentV2, verifyPayment, verifyPaymentV2, type Offer, type PaymentRequirements } from "@/lib/x402";

const REPO = process.env.GITHUB_REPOSITORY || "robd-hub/agent-report-card";
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://grader.designimp.com").replace(/\/$/, "");

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-PAYMENT, PAYMENT-SIGNATURE",
  "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE, PAYMENT-REQUIRED, PAYMENT-RESPONSE",
};

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS, ...extra } });
}

export function offer(priceUsd: number): Offer {
  return {
    description: `An independent A to F grade for an AI agent from Agent Report Card: real test tasks, a SERV Reasoning check and Reppo's independent judges, with a public report and badge.`,
    priceMicro: String(Math.round(priceUsd * 1e6)),
    example: {
      body: { agent: "https://platform.openserv.ai/agents/123", task: "Summarise this week's AI agent news in 5 bullet points", contact: "@yourhandle" },
      output: { status: "accepted", request: "https://github.com/robd-hub/agent-report-card/issues/42", report: null, transaction: "0x...", priceUsd: 10 },
    },
    outputSchema: {
      input: {
        type: "http",
        method: "POST",
        bodyType: "json",
        bodyFields: {
          agent: { type: "string", required: true, description: "OpenServ marketplace link or number, or a public https address that answers POST {\"prompt\": \"...\"}" },
          whatItDoes: { type: "string", required: false, description: "What the agent is for (required for agents off the marketplace)" },
          task: { type: "string", required: false, description: "A real request to include as a test task" },
          model: { type: "string", required: false, description: "Model name, for OpenAI-style /chat/completions addresses" },
          contact: { type: "string", required: false },
        },
      },
      output: { request: "string (URL of the grade request)", report: "string (URL the report will appear at)", transaction: "string" },
    },
  };
}

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\r/g, "").trim().slice(0, max);

/** A 402 in both x402 versions: a v1 JSON body, and the v2 offer in the PAYMENT-REQUIRED header. */
function challenge(resource: string, error: string, o: Offer, req: PaymentRequirements, extra: Record<string, string> = {}): Response {
  return json(paymentRequired(resource, error, o), 402, { "PAYMENT-REQUIRED": encodeHeader(paymentRequiredV2(resource, error, o, req)), ...extra });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

/** Describes the endpoint, for anyone who opens it in a browser. */
export function GET(): Response {
  return json({ about: "POST here to request and pay for a grade with x402.", price: { grade: GRADE_PRICE_USD, regrade: REGRADE_PRICE_USD, currency: "USDC on Base" }, ...offer(GRADE_PRICE_USD).outputSchema as object }, 200);
}

export async function POST(request: Request): Promise<Response> {
  if (!process.env.GITHUB_TOKEN) return json({ error: "Paying by API isn't switched on yet. Request a grade on the website instead." }, 503);

  const payment = paymentFrom(request);
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    if (payment) return json({ error: 'Send JSON like {"agent": "https://platform.openserv.ai/agents/123"}.' }, 400);
  }
  const resource = new URL(request.url).toString();
  const agentLink = clean(body.agent, 500);
  const model = clean(body.model, 100);
  const whatItDoes = clean(body.whatItDoes, 2000);
  const marketplaceId = findMarketplaceId(agentLink);
  const endpoint = marketplaceId ? null : findEndpoint(agentLink, model);

  // No payment yet: quote the price before checking the request, so a bare
  // probe (as x402 directories send) gets the 402 instead of a 400.
  if (!payment && !marketplaceId && !endpoint) {
    const o = offer(GRADE_PRICE_USD);
    return challenge(resource, `Payment required: $${GRADE_PRICE_USD} in USDC on Base per grade ($${REGRADE_PRICE_USD} for an agent already graded). Send {"agent": "<marketplace link or https address>"}.`, o, requirements(resource, o));
  }
  if (!marketplaceId && !endpoint) {
    return json({ error: "`agent` must be an OpenServ marketplace link or number, or a public https address (OpenAI-style /chat/completions addresses also need `model`; for an MCP server, use its address, or write mcp: before it)." }, 400);
  }
  if (!marketplaceId && whatItDoes.length < 10) return json({ error: "For agents off the marketplace, describe what it does in `whatItDoes`." }, 400);
  // Check an MCP server answers and lists a read-only tool before taking any money.
  if (endpoint?.adapter === "mcp") {
    const gate = rateGate(request, "mcp-probe", 20);
    if (!gate.ok) return gate.response;
    const probe = await probeMcp(endpoint.endpoint);
    if (!probe.ok) return json({ error: probe.reason }, 400);
  }

  const known = loadAgents().find((a) => (marketplaceId ? a.marketplaceId === marketplaceId : a.endpoint === endpoint!.endpoint));
  const price = known ? REGRADE_PRICE_USD : GRADE_PRICE_USD;
  const o = offer(price);
  const req = requirements(resource, o);

  if (!payment) return challenge(resource, `Payment required: $${price} in USDC on Base${known ? " (regrade)" : ""}.`, o, req);
  const v2 = payment.version === 2;
  const receiptHeader = v2 ? "PAYMENT-RESPONSE" : "X-PAYMENT-RESPONSE";
  const payload = decodePayment(payment.header);
  if (!payload) return challenge(resource, `The ${v2 ? "PAYMENT-SIGNATURE" : "X-PAYMENT"} header couldn't be read.`, o, req);
  try {
    const check = await (v2 ? verifyPaymentV2 : verifyPayment)(payload, req);
    if (!check.isValid) return challenge(resource, `Payment not accepted: ${check.invalidReason ?? "invalid payment"}.`, o, req);
  } catch (e) {
    console.error(e);
    return json({ error: "Couldn't check the payment right now. You haven't been charged. Please try again." }, 503);
  }

  let settled: Awaited<ReturnType<typeof settlePayment>>;
  try {
    settled = await (v2 ? settlePaymentV2 : settlePayment)(payload, req);
  } catch (e) {
    console.error(e);
    return challenge(resource, "The payment couldn't be settled. You haven't been charged.", o, req);
  }
  if (!settled.success || !settled.transaction) {
    return challenge(resource, `Payment couldn't be settled: ${settled.errorReason ?? "unknown reason"}. You haven't been charged.`, o, req, { [receiptHeader]: encodeHeader(settled) });
  }
  const tx = settled.transaction;
  const paidHeader = { [receiptHeader]: encodeHeader(settled) };

  const name = clean(body.name, 80) || known?.name || (marketplaceId ? `Marketplace agent ${marketplaceId}` : new URL(endpoint!.endpoint).hostname);
  const issue = {
    title: `Grade request: ${name}`,
    labels: ["grade-request"],
    body: issueBody({
      "Agent name": name,
      "Where can we find it?": agentLink,
      "Model name (OpenAI-style endpoints only)": model,
      "Payment transaction": `https://basescan.org/tx/${tx}`,
      "What does it do?": whatItDoes || "(sent through the pay-by-API endpoint)",
      "Tasks you'd like it tested on (optional)": clean(body.task, 1000),
      "How should we reach you? (optional)": clean(body.contact, 200),
    }) + "\n\n_Opened automatically after an x402 payment to /api/grade._",
  };
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "agent-report-card" },
      body: JSON.stringify(issue),
    });
    if (!res.ok) throw new Error(`GitHub returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const created = (await res.json()) as { html_url: string; number: number };
    const reportId = known?.id;
    return json(
      {
        status: "accepted",
        message: "Paid. Your grade request is open and the grading bot will reply on it, usually within half an hour.",
        request: created.html_url,
        report: reportId ? `${SITE}/agents/${reportId}/` : null,
        transaction: tx,
        priceUsd: price,
      },
      202,
      paidHeader,
    );
  } catch (e) {
    console.error(e);
    // The money has moved, so give the buyer what they need to finish by hand.
    return json(
      {
        status: "paid_but_not_opened",
        message: `Your payment went through, but we couldn't open the grade request automatically. Open one at https://github.com/${REPO}/issues/new?template=grade-request.yml and paste this transaction: https://basescan.org/tx/${tx}`,
        transaction: tx,
        priceUsd: price,
      },
      502,
      paidHeader,
    );
  }
}
