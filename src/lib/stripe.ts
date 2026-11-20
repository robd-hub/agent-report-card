/**
 * Card payments through Stripe Payment Links.
 *
 * A buyer pays on a Stripe Payment Link that asks for the agent's link and
 * what it does (Stripe "custom fields"). Once Stripe says the checkout is
 * paid, the server (src/server/card.ts) opens the usual grade request issue
 * with the checkout id as the payment, and the grading bot
 * (scripts/auto-grade.ts) checks it with Stripe again before grading.
 *
 * No Stripe library: two plain API calls and the webhook signature check.
 */
import crypto from "node:crypto";
import { issueBody } from "./issueBody";

/** The custom field keys the Payment Links use (set when creating the link in Stripe). */
export const FIELD_AGENT_LINK = "agentlink";
export const FIELD_WHAT_IT_DOES = "whatitdoes";
export const FIELD_AGENT_NAME = "agentname";

export const SESSION_ID = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;

export interface StripeSession {
  id: string;
  object?: string;
  livemode?: boolean;
  payment_status?: string;
  status?: string;
  amount_total?: number;
  currency?: string;
  created?: number;
  custom_fields?: { key: string; label?: { custom?: string | null } | null; text?: { value?: string | null } | null }[];
}

/** Reads one Checkout Session. Needs a key that can read Checkout Sessions. */
export async function getSession(id: string, key = process.env.STRIPE_SECRET_KEY): Promise<StripeSession | null> {
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Stripe returned ${res.status}`);
  return (await res.json()) as StripeSession;
}

/** Test payments (cs_test_) only count when STRIPE_ALLOW_TEST is set. */
export const testAllowed = (env = process.env) => Boolean(env.STRIPE_ALLOW_TEST && env.STRIPE_ALLOW_TEST !== "0");
export const isTestSession = (id: string) => id.startsWith("cs_test_");

/**
 * Checks a Stripe-Signature header (https://docs.stripe.com/webhooks#verify-manually)
 * and returns the event, or null if the signature doesn't match or is older
 * than five minutes.
 */
export function verifyWebhook(rawBody: string, header: string | null, secret: string, now = Date.now()): { type: string; data: { object: StripeSession } } | null {
  if (!header || !secret) return null;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!t || !/^\d+$/.test(t) || sigs.length === 0) return null;
  if (Math.abs(now / 1000 - Number(t)) > 300) return null;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) return null;
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

/** Builds a valid signature header, for tests. */
export function signWebhook(rawBody: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
}

/** Which of our fields a dashboard-made custom field is, from words in its label. */
function kindFromLabel(label: string): string | null {
  if (/name/i.test(label)) return FIELD_AGENT_NAME;
  if (/link|address|url|where/i.test(label)) return FIELD_AGENT_LINK;
  if (/what|does|describe|about/i.test(label)) return FIELD_WHAT_IT_DOES;
  return null;
}

/**
 * A custom field's answer, found by its key or, for links made in the Stripe
 * dashboard (which may pick its own keys), by words in its label.
 */
function field(s: StripeSession, key: string): string {
  const fields = s.custom_fields ?? [];
  const hit = fields.find((f) => f.key === key) ?? fields.find((f) => kindFromLabel(f.label?.custom ?? "") === key);
  return String(hit?.text?.value ?? "").replace(/\r/g, "").trim();
}

/**
 * The grade request for a paid checkout, in the issue form the bot reads, or
 * null when the buyer's Payment Link didn't ask for the agent's link (then
 * the buyer fills in the request form by hand, with the code shown on /paid).
 *
 * The agent link field may also hold a model name after a space, for
 * OpenAI-style /chat/completions addresses. The buyer's email stays in
 * Stripe: grade requests are public.
 */
export function requestFromSession(s: StripeSession): { title: string; labels: string[]; body: string } | null {
  const raw = field(s, FIELD_AGENT_LINK);
  if (!raw) return null;
  const [link, ...rest] = raw.split(/\s+/);
  const model = rest.join(" ").replace(/^model[:=]\s*/i, "").slice(0, 100);
  const name = field(s, FIELD_AGENT_NAME).replace(/\n+/g, " ").slice(0, 80);
  const test = isTestSession(s.id) ? " (test payment)" : "";
  return {
    title: `Grade request: ${name || link.slice(0, 80)}${test}`,
    labels: ["grade-request"],
    body:
      issueBody({
        "Agent name": name,
        "Where can we find it?": link,
        "Model name (OpenAI-style endpoints only)": model,
        "Payment transaction": s.id,
        "What does it do?": field(s, FIELD_WHAT_IT_DOES),
        "How should we reach you? (optional)": "Paid by card. We'll reply here; your receipt email stays private in Stripe.",
      }) + "\n\n_Opened automatically after a card payment through Stripe._",
  };
}
