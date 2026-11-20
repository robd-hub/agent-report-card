/**
 * Card payments: turns a paid Stripe checkout into a grade request issue, so
 * a card buyer needs no GitHub account. Two ways in, sharing one function:
 *
 *   POST /api/stripe-webhook  Stripe calls this when a checkout completes.
 *                             Signed with STRIPE_WEBHOOK_SECRET.
 *   GET  /api/card-order?session=cs_...[&create=1]
 *                             The /paid page asks this after the buyer comes
 *                             back from Stripe, to show the request link. With
 *                             create=1 (sent after a short wait, in case the
 *                             webhook is slow or not set up) it opens the
 *                             request itself.
 *
 * Either way the grading bot checks the payment with Stripe again before it
 * grades, and refuses a checkout id that was already used, so a duplicate
 * request can't get a second grade.
 *
 * Only served on Vercel (scripts/prepare-server.ts writes the route files).
 * Needs STRIPE_SECRET_KEY (restricted, "Checkout Sessions: read") and
 * GITHUB_TOKEN ("Issues: read and write"); the webhook also needs
 * STRIPE_WEBHOOK_SECRET.
 */
import { getSession, isTestSession, requestFromSession, SESSION_ID, testAllowed, verifyWebhook, type StripeSession } from "@/lib/stripe";
import { json, rateGate } from "./http";

const REPO = process.env.GITHUB_REPOSITORY || "robd-hub/agent-report-card";
const NO_STORE = "no-store";

const gh = (path: string, init: RequestInit = {}) =>
  fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "agent-report-card",
    },
  });

/** The grade request already opened for this checkout, if any (newest 100 requests). */
export async function findRequest(sessionId: string): Promise<string | null> {
  const res = await gh(`/issues?labels=grade-request&state=all&sort=created&direction=desc&per_page=100`);
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  const issues = (await res.json()) as { html_url: string; body?: string | null }[];
  return issues.find((i) => (i.body ?? "").includes(sessionId))?.html_url ?? null;
}

/**
 * Opens the grade request for a paid checkout, unless one is already open.
 * Returns its link, or null when the Payment Link didn't collect the agent's
 * link (the buyer then fills in the form by hand).
 */
export async function ensureRequest(session: StripeSession): Promise<string | null> {
  const existing = await findRequest(session.id);
  if (existing) return existing;
  const issue = requestFromSession(session);
  if (!issue) return null;
  const res = await gh(`/issues`, { method: "POST", body: JSON.stringify(issue) });
  if (!res.ok) throw new Error(`GitHub returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { html_url: string }).html_url;
}

const ready = () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.GITHUB_TOKEN);

export async function webhookPOST(request: Request): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !ready()) return json({ error: "Card payments aren't switched on here." }, 503, NO_STORE);
  const raw = await request.text();
  const event = verifyWebhook(raw, request.headers.get("stripe-signature"), secret);
  if (!event) return json({ error: "Bad signature." }, 400, NO_STORE);
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    return json({ received: true, ignored: event.type }, 200, NO_STORE);
  }
  const session = event.data?.object;
  if (!session?.id || !SESSION_ID.test(session.id)) return json({ received: true, ignored: "no checkout id" }, 200, NO_STORE);
  if (session.payment_status !== "paid") return json({ received: true, ignored: "not paid yet" }, 200, NO_STORE);
  if (isTestSession(session.id) && !testAllowed()) return json({ received: true, ignored: "test payment" }, 200, NO_STORE);
  try {
    const url = await ensureRequest(session);
    return json({ received: true, request: url }, 200, NO_STORE);
  } catch (e) {
    console.error(e);
    // A 500 makes Stripe try again later.
    return json({ error: "Couldn't open the grade request yet." }, 500, NO_STORE);
  }
}

export async function orderGET(request: Request): Promise<Response> {
  const gate = rateGate(request, "card-order", 30);
  if (!gate.ok) return gate.response;
  const url = new URL(request.url);
  const id = url.searchParams.get("session") ?? "";
  if (!SESSION_ID.test(id)) return json({ status: "invalid", error: "That isn't a Stripe payment code." }, 400, NO_STORE);
  if (isTestSession(id) && !testAllowed()) return json({ status: "invalid", error: "That's a Stripe test payment." }, 400, NO_STORE);
  if (!ready()) return json({ status: "manual" }, 200, NO_STORE);
  try {
    const session = await getSession(id);
    if (!session) return json({ status: "invalid", error: "Stripe doesn't know that payment code." }, 404, NO_STORE);
    if (session.payment_status !== "paid") return json({ status: "pending" }, 200, NO_STORE);
    const existing = await findRequest(id);
    if (existing) return json({ status: "opened", request: existing }, 200, NO_STORE);
    if (!requestFromSession(session)) return json({ status: "manual" }, 200, NO_STORE);
    if (url.searchParams.get("create") !== "1") return json({ status: "waiting" }, 200, NO_STORE);
    const opened = await ensureRequest(session);
    return json(opened ? { status: "opened", request: opened } : { status: "manual" }, 200, NO_STORE);
  } catch (e) {
    console.error(e);
    return json({ status: "manual" }, 200, NO_STORE);
  }
}
