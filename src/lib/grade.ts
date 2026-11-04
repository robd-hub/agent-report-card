import type { Grade, TaskResult } from "./types";

/** How much the human (Reppo) score counts versus the automatic (SERV) check. */
export const REPPO_WEIGHT = 0.7;

export function taskScore(t: TaskResult): number | null {
  const human = t.reppo.status === "done" ? t.reppo.score : null;
  const auto = t.serv ? t.serv.score : null;
  if (human !== null && auto !== null) return REPPO_WEIGHT * human + (1 - REPPO_WEIGHT) * auto;
  return human ?? auto;
}

export function runScore(tasks: TaskResult[]): number | null {
  const scores = tasks.map(taskScore).filter((s): s is number => s !== null);
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

export function letterGrade(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export function isProvisional(tasks: TaskResult[]): boolean {
  return tasks.some((t) => t.reppo.status !== "done");
}
