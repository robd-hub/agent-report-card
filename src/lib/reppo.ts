import type { ReppoResult } from "./types";

/**
 * Client for the Reppo Evaluation API (https://eval.reppo.xyz/api/v1).
 *
 * Format confirmed from Reppo's Evaluation API docs (Reppo-Labs/docs PR #9):
 *   POST /agents/eval-requests/submit   -> 201 { id, evalId, status: "PENDING" }
 *   GET  /agents/eval-requests/{evalId} -> { status: PENDING | SETTLED | FAILED, result, ... }
 * Each evaluation costs 100 credits, settles after a window of at least
 * 10 minutes, and an account may only have ONE pending evaluation at a time
 * (a second submit returns 409). The grading script therefore queues tasks
 * and sends them to Reppo one by one.
 *
 * Nothing here invents a score: without REPPO_API_KEY every task stays
 * "unconfigured" and the grade stays provisional.
 */
const DEFAULT_URL = "https://eval.reppo.xyz/api/v1";

/** Settlement window in minutes. Allowed: 10, 15, 30, 60, 120, 360, 720, 1440. */
const SETTLEMENT_MINUTES = Number(process.env.REPPO_SETTLEMENT_MINUTES || 10);

function baseUrl(): string {
  return (process.env.REPPO_API_URL || DEFAULT_URL).replace(/\/$/, "");
}

export function reppoConfigured(): boolean {
  return Boolean(process.env.REPPO_API_KEY);
}

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${process.env.REPPO_API_KEY}`, "Content-Type": "application/json" };
}

export type SubmitOutcome = ReppoResult | { status: "busy" };

export async function submitEvaluation(input: { prompt: string; criteria: string; output: string }): Promise<SubmitOutcome> {
  if (!reppoConfigured()) return { status: "unconfigured" };
  try {
    const res = await fetch(`${baseUrl()}/agents/eval-requests/submit`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        type: "answer",
        payload: input.output.slice(0, 50_000) || "(empty answer)",
        criteria: splitCriteria(input.criteria),
        context: `Task given to the AI agent:\n${input.prompt}`.slice(0, 32_000),
        settlementMinutes: SETTLEMENT_MINUTES,
      }),
    });
    if (res.status === 409) return { status: "busy" };
    if (res.status === 402) return { status: "error", message: "Out of Reppo credits (402). Top up at eval.reppo.xyz." };
    if (!res.ok) return { status: "error", message: `Reppo returned ${res.status}: ${await res.text()}` };
    const body = (await res.json()) as { evalId?: string; id?: string };
    const evalId = body.evalId ?? body.id;
    if (!evalId) return { status: "error", message: `Reppo gave no evalId: ${JSON.stringify(body)}` };
    return { status: "pending", evalId };
  } catch (e) {
    return { status: "error", message: String(e) };
  }
}

interface ReppoVerdict {
  verdict?: { scale?: string; score?: number; decision?: string; confidence?: string };
  verdicts?: { criterion: string; score: number; critique: string }[];
  reason?: string;
}

export async function fetchEvaluation(evalId: string): Promise<ReppoResult> {
  if (!reppoConfigured()) return { status: "unconfigured" };
  try {
    const res = await fetch(`${baseUrl()}/agents/eval-requests/${evalId}`, { headers: headers() });
    if (!res.ok) return { status: "error", message: `Reppo returned ${res.status}: ${await res.text()}` };
    const body = (await res.json()) as { status: string; result: ReppoVerdict | null; humanContributors?: unknown };
    if (body.status === "PENDING" || !body.result) return { status: "pending", evalId };
    if (body.status === "FAILED") return { status: "error", message: `Reppo evaluation failed: ${body.result.reason ?? "no reason given"}` };
    const r = body.result;
    const score = r.verdict?.score;
    if (typeof score !== "number" || !Number.isFinite(score)) {
      return { status: "error", message: "Reppo settled but gave no overall score" };
    }
    return {
      status: "done",
      evalId,
      score: Math.max(0, Math.min(100, Math.round(score))),
      decision: r.verdict?.decision,
      confidence: r.verdict?.confidence,
      critiques: (r.verdicts ?? []).map((v) => `${v.criterion}: ${v.critique}`),
    };
  } catch (e) {
    return { status: "error", message: String(e) };
  }
}

/** Reppo takes criteria as a list (max 10, 2 KB each). Each task stores one criteria sentence, sent as-is. */
function splitCriteria(criteria: string): string[] {
  return [criteria.slice(0, 2000)];
}
