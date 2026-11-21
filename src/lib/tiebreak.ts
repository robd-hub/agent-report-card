import { disagreement } from "./grade";
import { servCheck, servConfigured } from "./serv";
import type { AgentConfig, TaskResult } from "./types";
import { taskWording } from "./types";

/**
 * The third judge, used only when Reppo and SERV are DISAGREEMENT_GAP or more
 * points apart. A Google model, so it comes from a different family to the
 * SERV check (OpenAI) and the Reppo judges (mostly OpenAI and Anthropic).
 * It reads the saved answer; the agent is not called again.
 */
export const TIEBREAK_MODEL = process.env.TIEBREAK_MODEL || "gemini-3.1-pro-preview";

/**
 * Adds the third judge's score to a split task that doesn't have one yet.
 * Returns true when it added one. Leaves the task alone if it isn't split,
 * already settled, or SERV isn't set up.
 */
export async function settleSplit(t: TaskResult, agent: AgentConfig): Promise<boolean> {
  const g = disagreement(t);
  if (!g || t.tiebreak || !servConfigured()) return false;
  const wording = taskWording(t, agent);
  if (!wording) return false;
  const r = await servCheck(wording.prompt, wording.criteria, t.output, TIEBREAK_MODEL);
  t.tiebreak = {
    model: TIEBREAK_MODEL,
    score: r.score,
    summary: r.summary,
    sidedWith: Math.abs(r.score - g.reppo) <= Math.abs(r.score - g.serv) ? "reppo" : "serv",
    date: new Date().toISOString(),
  };
  return true;
}
