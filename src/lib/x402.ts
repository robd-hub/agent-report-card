/**
 * Minimal x402 ("HTTP 402 Payment Required") support, in USDC on Base.
 * Copied from Cheap First (robd-hub/cheap-first, src/x402.ts) with the price
 * made a parameter, so an AI agent or script can pay for a grade itself.
 *
 * The flow (x402 version 1, "exact" scheme):
 *   1. A request with no X-PAYMENT header gets a 402 listing what to pay.
 *   2. The client signs a USDC transfer authorization and resends the request
 *      with it in the X-PAYMENT header (base64 JSON).
 *   3. We ask an x402 facilitator to verify it, answer the question, then ask
 *      the facilitator to settle (submit the transfer on Base). The settlement
 *      receipt goes back in the X-PAYMENT-RESPONSE header.
 *
 * We settle before opening the grade request, so a request is only opened
 * once the money has moved.
 *
 * x402 version 2 is supported alongside version 1: the 402 also carries a
 * PAYMENT-REQUIRED header (base64 JSON, network "eip155:8453", the "bazaar"
 * discovery extension describing the request body), and a payment can arrive
 * in the v2 PAYMENT-SIGNATURE header instead of X-PAYMENT; its receipt then
 * goes back in PAYMENT-RESPONSE. The JSON body of the 402 stays version 1, so
 * older clients keep working. Directories such as x402scan list only v2.
 */

/** Circle's native USDC on Base. Its EIP-712 domain is name "USD Coin", version "2". */
import { PAY_ADDRESS } from "./links";

export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** Where payments go. Override with PAY_TO_ADDRESS. */
export const PAY_TO = PAY_ADDRESS;


/** The facilitator that verifies and settles payments. Override with X402_FACILITATOR_URL. */
export const FACILITATOR = (process.env.X402_FACILITATOR_URL || "https://facilitator.payai.network").replace(/\/$/, "");

export interface PaymentRequirements {
  scheme: "exact";
  network: "base";
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  outputSchema?: unknown;
  extra: { name: string; version: string };
}

export interface Offer {
  description: string;
  outputSchema: unknown;
  /** Price in USDC micro-units (6 decimals): 10000000 = $10. */
  priceMicro: string;
  /** Example request and response, shown by x402 directories (the v2 "bazaar" extension). */
  example?: { body: Record<string, unknown>; output: unknown };
}

/** The name x402 directories show for this service. */
export const SERVICE_NAME = "Agent Report Card";

export function requirements(resource: string, offer: Offer): PaymentRequirements {
  return {
    scheme: "exact",
    network: "base",
    maxAmountRequired: offer.priceMicro,
    resource,
    description: offer.description,
    mimeType: "application/json",
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
    asset: USDC_BASE,
    outputSchema: offer.outputSchema,
    extra: { name: "USD Coin", version: "2" },
  };
}

/** The body of a 402 response. */
export function paymentRequired(resource: string, error: string, offer: Offer) {
  return { x402Version: 1, error, accepts: [requirements(resource, offer)] };
}

/** Decodes the X-PAYMENT header (base64 JSON). Returns null if it isn't valid. */
export function decodePayment(header: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ---- x402 version 2 ----

/** Base mainnet, as x402 v2 names networks (CAIP-2). */
export const NETWORK_V2 = "eip155:8453";

export interface RequirementsV2 {
  scheme: "exact";
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string };
}

export function requirementsV2(req: PaymentRequirements): RequirementsV2 {
  return { scheme: "exact", network: NETWORK_V2, amount: req.maxAmountRequired, asset: req.asset, payTo: req.payTo, maxTimeoutSeconds: req.maxTimeoutSeconds, extra: req.extra };
}

interface FieldDef {
  type?: string;
  required?: boolean;
  description?: string;
}

/**
 * The v2 "bazaar" discovery extension: the request body as a JSON Schema plus
 * an example, built from the v1 outputSchema's bodyFields.
 */
export function bazaar(offer: Offer): unknown {
  const v1 = (offer.outputSchema ?? {}) as { input?: { bodyFields?: Record<string, FieldDef> }; output?: unknown };
  const fields = v1.input?.bodyFields ?? {};
  const properties: Record<string, { type: string; description?: string }> = {};
  for (const [name, f] of Object.entries(fields)) properties[name] = { type: f.type || "string", ...(f.description ? { description: f.description } : {}) };
  const required = Object.entries(fields).filter(([, f]) => f.required).map(([name]) => name);
  return {
    info: {
      input: { type: "http", method: "POST", bodyType: "json", body: offer.example?.body ?? {} },
      output: { type: "json", example: offer.example?.output ?? v1.output ?? {} },
    },
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        input: {
          type: "object",
          properties: {
            type: { type: "string", const: "http" },
            method: { type: "string", enum: ["POST"] },
            bodyType: { type: "string", enum: ["json"] },
            body: { type: "object", properties, required },
          },
          required: ["type", "method", "bodyType", "body"],
          additionalProperties: false,
        },
        output: { type: "object", properties: { type: { type: "string" }, example: { type: "object" } }, required: ["type"] },
      },
      required: ["input"],
    },
  };
}

/** The v2 PaymentRequired object, sent base64-encoded in the PAYMENT-REQUIRED header. */
export function paymentRequiredV2(resource: string, error: string, offer: Offer, req: PaymentRequirements = requirements(resource, offer)) {
  return {
    x402Version: 2,
    error,
    resource: { url: resource, description: offer.description, mimeType: "application/json", serviceName: SERVICE_NAME },
    accepts: [requirementsV2(req)],
    extensions: { bazaar: bazaar(offer) },
  };
}

/** A payment from either version: v2's PAYMENT-SIGNATURE header, or v1's X-PAYMENT. */
export function paymentFrom(request: Request): { version: 1 | 2; header: string } | null {
  const v2 = request.headers.get("payment-signature");
  if (v2) return { version: 2, header: v2 };
  const v1 = request.headers.get("x-payment");
  return v1 ? { version: 1, header: v1 } : null;
}

export async function verifyPaymentV2(payload: unknown, req: PaymentRequirements): Promise<{ isValid: boolean; invalidReason?: string; payer?: string }> {
  return facilitator("verify", payload, requirementsV2(req), 2);
}

export async function settlePaymentV2(payload: unknown, req: PaymentRequirements): Promise<{ success: boolean; errorReason?: string; transaction?: string; network?: string; payer?: string }> {
  return facilitator("settle", payload, requirementsV2(req), 2);
}

async function facilitator<T>(path: "verify" | "settle", paymentPayload: unknown, paymentRequirements: PaymentRequirements | RequirementsV2, x402Version: 1 | 2 = 1): Promise<T> {
  const res = await fetch(`${FACILITATOR}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ x402Version, paymentPayload, paymentRequirements }),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Facilitator ${path} returned ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok && !(body && typeof body === "object")) throw new Error(`Facilitator ${path} returned ${res.status}`);
  return body as T;
}

export async function verifyPayment(payload: unknown, req: PaymentRequirements): Promise<{ isValid: boolean; invalidReason?: string; payer?: string }> {
  return facilitator("verify", payload, req);
}

export async function settlePayment(payload: unknown, req: PaymentRequirements): Promise<{ success: boolean; errorReason?: string; transaction?: string; network?: string; payer?: string }> {
  return facilitator("settle", payload, req);
}

export function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}
