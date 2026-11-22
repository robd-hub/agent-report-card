/**
 * POST /api/request: the website's grade request form, for buyers who paid
 * in USDC on Base and don't have (or don't want to use) a GitHub account.
 *
 * The form sends
 *   {"agent": "...", "whatItDoes": "...", "payment": "<Basescan link or 0x hash>",
 *    "name": "...", "model": "...", "task": "...", "contact": "..."}
 * With "check": true (and no payment) it only checks the form and quotes the
 * price, for the wallet button to call before it asks the wallet to pay.
 * We check the payment on Base first (so nobody can open requests without
 * paying), then open the usual grade request issue, exactly as if the buyer
 * had filled in the GitHub form. The grading bot checks the payment again
 * and refuses one that was already used, so this adds no new way to get a
 * free or double grade.
 *
 * Only served on Vercel (scripts/prepare-server.ts writes the route file).
 * The GitHub Pages copy of the site sends its form here too (CORS is open).
 * Needs GITHUB_TOKEN ("Issues: read and write").
 */
import { loadAgents } from "@/lib/data";
import { issueBody } from "@/lib/issueBody";
import { GRADE_PRICE_USD, REGRADE_PRICE_USD } from "@/lib/links";
import { checkPayment, findTxHash, isCardPayment } from "@/lib/payment";
import { probeMcp } from "@/lib/mcpClient";
import { findEndpoint, findMarketplaceId } from "@/lib/requests";
import { findRequest } from "./card";
import { json, options, rateGate } from "./http";

const REPO = process.env.GITHUB_REPOSITORY || "robd-hub/agent-report-card";
const NO_STORE = "no-store";
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\r/g, "").trim().slice(0, max);

export const OPTIONS = options;

export async function POST(request: Request): Promise<Response> {
  const gate = rateGate(request, "request", 10);
  if (!gate.ok) return gate.response;
  if (!process.env.GITHUB_TOKEN) return json({ status: "unavailable", error: "The request form isn't switched on here." }, 503, NO_STORE);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ status: "invalid", error: "Send the form as JSON." }, 400, NO_STORE);
  }
  const agentLink = clean(body.agent, 500);
  const model = clean(body.model, 100);
  const whatItDoes = clean(body.whatItDoes, 2000);
  const paymentText = clean(body.payment, 300);

  const marketplaceId = findMarketplaceId(agentLink);
  const endpoint = marketplaceId ? null : findEndpoint(agentLink, model);
  if (!marketplaceId && !endpoint) {
    return json(
      { status: "invalid", field: "agent", error: "Use your agent's OpenServ marketplace link, or a public https address (OpenAI-style /chat/completions addresses also need the model name; for an MCP server, use its address, or write mcp: before it)." },
      400,
      NO_STORE,
    );
  }
  if (whatItDoes.length < 10) return json({ status: "invalid", field: "whatItDoes", error: "Tell us in a sentence what your agent does, so we can pick fair test tasks." }, 400, NO_STORE);
  const known = loadAgents().find((a) => (marketplaceId ? a.marketplaceId === marketplaceId : a.endpoint === endpoint!.endpoint));
  const price = known ? REGRADE_PRICE_USD : GRADE_PRICE_USD;
  // The wallet button asks first, so the buyer only pays once the form is
  // right, and pays the right price ($5 for an agent we've already graded).
  // An MCP server is also checked: it must answer and list a read-only tool,
  // so nobody pays for a test that can't run.
  if (body.check === true) {
    if (endpoint?.adapter === "mcp") {
      const probe = await probeMcp(endpoint.endpoint);
      if (!probe.ok) return json({ status: "invalid", field: "agent", error: probe.reason }, 400, NO_STORE);
      return json({ status: "ok", priceUsd: price, regrade: Boolean(known), agentType: "mcp", mcp: { name: probe.name ?? null, tools: probe.tools?.length ?? 0, usableTools: probe.usable ?? 0 } }, 200, NO_STORE);
    }
    return json({ status: "ok", priceUsd: price, regrade: Boolean(known), agentType: endpoint?.adapter ?? "openserv-marketplace" }, 200, NO_STORE);
  }

  const tx = findTxHash(paymentText);
  if (!tx) return json({ status: "invalid", field: "payment", error: "Paste the Basescan link or the transaction hash (it starts with 0x) for your USDC payment." }, 400, NO_STORE);
  if (isCardPayment(tx)) {
    return json({ status: "invalid", field: "payment", error: "That's a card payment code. Card payments open their request by themselves; check the page Stripe sent you to after paying." }, 400, NO_STORE);
  }

  try {
    // Same payment already has a request? Send them to it instead of opening another.
    const existing = await findRequest(tx);
    if (existing) return json({ status: "opened", request: existing, existing: true }, 200, NO_STORE);

    const check = await checkPayment(tx, price);
    if (!check.ok) return json({ status: "invalid", field: "payment", error: check.reason }, 400, NO_STORE);

    const name = clean(body.name, 80) || known?.name || (marketplaceId ? `Marketplace agent ${marketplaceId}` : new URL(endpoint!.endpoint).hostname);
    const issue = {
      title: `Grade request: ${name}`,
      labels: ["grade-request"],
      body:
        issueBody({
          "Agent name": name,
          "Where can we find it?": agentLink,
          "Model name (OpenAI-style endpoints only)": model,
          "Payment transaction": `https://basescan.org/tx/${tx}`,
          "What does it do?": whatItDoes,
          "Tasks you'd like it tested on (optional)": clean(body.task, 1000),
          "How should we reach you? (optional)": clean(body.contact, 200),
        }) + "\n\n_Sent from the request form on the website._",
    };
    const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "agent-report-card" },
      body: JSON.stringify(issue),
    });
    if (!res.ok) throw new Error(`GitHub returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const created = (await res.json()) as { html_url: string };
    return json({ status: "opened", request: created.html_url, priceUsd: price }, 201, NO_STORE);
  } catch (e) {
    console.error(e);
    return json({ status: "unavailable", error: "We couldn't open your request just now. Please try again in a minute." }, 503, NO_STORE);
  }
}
