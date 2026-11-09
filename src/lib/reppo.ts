import type { ReppoResult } from "./types";

/**
 * Client for the Reppo Evaluation API (https://eval.reppo.xyz/api/v1).
 *
 * Format from Reppo's agent guide (https://eval.reppo.xyz/agents.md, checked 2026-11-09):
 *   POST /agents/evals       { taskType: "response", input } -> 201 { id, status: "QUEUED" }
 *   GET  /agents/evals/{id}  -> { status: QUEUED | PROCESSING | COMPLETED | FAILED, result }
 * A panel of independent evaluators scores each answer, usually within 30-90
 * seconds. Each text evaluation costs 440 credits, charged only on COMPLETED.
 *
 * Nothing here invents a score: without REPPO_API_KEY every task stays
 * "unconfigured" and the grade stays provisional.
 */
const DEFAULT_URL = "https://eval.reppo.xyz/api/v1";

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
    const text =
      `User prompt: ${input.prompt}\n\n` +
      `What a good answer looks like: ${input.criteria}\n\n` +
      `AI response: ${input.output || "(empty answer)"}`;
    const res = await fetch(`${baseUrl()}/agents/evals`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ taskType: "response", input: text.slice(0, 50_000) }),
    });
    if (res.status === 409) return { status: "busy" };
    if (res.status === 402) return { status: "error", message: "Out of Reppo credits (402). Top up at eval.reppo.xyz." };
    if (!res.ok) return { status: "error", message: `Reppo returned ${res.status}: ${await res.text()}` };
    const body = (await res.json()) as { id?: string };
    const evalId = body.id;
    if (!evalId) return { status: "error", message: `Reppo gave no evalId: ${JSON.stringify(body)}` };
    return { status: "pending", evalId };
  } catch (e) {
    return { status: "error", message: String(e) };
  }
}

interface ReppoEval {
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  result: {
    score?: number;
    decision?: string;
    confidence?: string;
    route?: string;
    reason?: string;
    rubric_scores?: Record<string, number>;
  } | null;
  error?: unknown;
}

export async function fetchEvaluation(evalId: string): Promise<ReppoResult> {
  if (!reppoConfigured()) return { status: "unconfigured" };
  try {
    const res = await fetch(`${baseUrl()}/agents/evals/${evalId}`, { headers: headers() });
    if (!res.ok) return { status: "error", message: `Reppo returned ${res.status}: ${await res.text()}` };
    const body = (await res.json()) as ReppoEval;
    if (body.status === "FAILED") return { status: "error", message: `Reppo evaluation failed: ${JSON.stringify(body.error ?? "no reason given")}` };
    if (body.status !== "COMPLETED" || !body.result) return { status: "pending", evalId };
    const r = body.result;
    if (typeof r.score !== "number" || !Number.isFinite(r.score)) {
      return { status: "error", message: "Reppo completed but gave no overall score" };
    }
    const rubric = Object.entries(r.rubric_scores ?? {}).map(([k, v]) => `${k} ${v}/100`).join(", ");
    return {
      status: "done",
      evalId,
      score: Math.max(0, Math.min(100, Math.round(r.score))),
      decision: r.decision,
      confidence: r.confidence,
      critiques: [r.reason, rubric && `Scores by area: ${rubric}.`].filter((x): x is string => Boolean(x)),
    };
  } catch (e) {
    return { status: "error", message: String(e) };
  }
}
