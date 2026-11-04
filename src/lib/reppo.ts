import type { ReppoResult } from "./types";

/**
 * Client for the Reppo Evaluation API (eval.reppo.xyz).
 *
 * Reppo's public docs don't yet spell out the request and response shapes,
 * so the paths below must be confirmed against the docs in the console
 * before the first live run. Until both REPPO_API_KEY and REPPO_API_URL are
 * set, every task is marked "unconfigured" and the grade stays provisional.
 * Nothing here invents a score.
 */
export function reppoConfigured(): boolean {
  return Boolean(process.env.REPPO_API_KEY && process.env.REPPO_API_URL);
}

export async function submitEvaluation(input: { prompt: string; criteria: string; output: string }): Promise<ReppoResult> {
  if (!reppoConfigured()) return { status: "unconfigured" };
  try {
    const res = await fetch(`${process.env.REPPO_API_URL}/evaluations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.REPPO_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: input.prompt, criteria: input.criteria, output: input.output }),
    });
    if (!res.ok) return { status: "error", message: `Reppo returned ${res.status}: ${await res.text()}` };
    const body = (await res.json()) as { id: string };
    return { status: "pending", evalId: body.id };
  } catch (e) {
    return { status: "error", message: String(e) };
  }
}

export async function fetchEvaluation(evalId: string): Promise<ReppoResult> {
  if (!reppoConfigured()) return { status: "unconfigured" };
  try {
    const res = await fetch(`${process.env.REPPO_API_URL}/evaluations/${evalId}`, {
      headers: { Authorization: `Bearer ${process.env.REPPO_API_KEY}` },
    });
    if (!res.ok) return { status: "error", message: `Reppo returned ${res.status}: ${await res.text()}` };
    const body = (await res.json()) as { status: string; score?: number; critiques?: string[] };
    if (body.status !== "completed" || body.score === undefined) return { status: "pending", evalId };
    return { status: "done", evalId, score: body.score, critiques: body.critiques ?? [] };
  } catch (e) {
    return { status: "error", message: String(e) };
  }
}
