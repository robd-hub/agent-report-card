import { HONESTY_TASK_IDS, taskScore } from "./grade";
import type { AgentConfig, TaskKind, TaskResult, TestTask } from "./types";

/**
 * The kinds of task in a full grade, so one lucky or unlucky answer can't
 * decide it and a reader can see where an agent is strong or weak.
 */
export const TASK_KINDS: { kind: TaskKind; label: string; about: string }[] = [
  { kind: "core", label: "Core job", about: "Real requests for the agent's own job, from easy to hard, most with a checkable right answer." },
  { kind: "format", label: "Follows instructions", about: "A request with a strict length or format rule, to see if the agent keeps to it." },
  { kind: "unclear", label: "Handles unclear requests", about: "A request with missing or ambiguous details, where a good agent asks or states its assumption instead of guessing." },
  { kind: "scope", label: "Knows its limits", about: "A request it shouldn't do as asked (outside its job or harmful), where it should say so and offer a sensible alternative." },
  { kind: "honesty", label: "Honesty", about: "Questions it can't answer from what it knows or was given, where the right move is to say so." },
];

/** The mix of tasks in a full ten-task grade. Two honesty tasks are standard; the rest are written for each agent. */
export const FULL_GRADE_MIX: Record<TaskKind, number> = { core: 5, format: 1, unclear: 1, scope: 1, honesty: 2 };
export const FULL_GRADE_TASKS = Object.values(FULL_GRADE_MIX).reduce((a, b) => a + b, 0);

/** The kinds to ask for when writing `n` tasks for an agent (honesty tasks are added separately). */
export function writtenKinds(n: number): TaskKind[] {
  const extra: TaskKind[] = ["format", "unclear", "scope"];
  if (n < 6) return Array(n).fill("core");
  return [...Array(n - extra.length).fill("core"), ...extra];
}

export function kindOf(task: Pick<TestTask, "id" | "kind"> | undefined, taskId?: string): TaskKind {
  const id = task?.id ?? taskId ?? "";
  if (HONESTY_TASK_IDS.includes(id)) return "honesty";
  return task?.kind ?? "core";
}

/** The average task score for each kind in a run, for kinds the run has. */
export function kindScores(tasks: TaskResult[], agent: Pick<AgentConfig, "tasks">): { kind: TaskKind; label: string; score: number | null; count: number }[] {
  return TASK_KINDS.map(({ kind, label }) => {
    const mine = tasks.filter((t) => kindOf(agent.tasks.find((x) => x.id === t.taskId) ?? (t.kind ? { id: t.taskId, kind: t.kind } : undefined), t.taskId) === kind);
    const scores = mine.map(taskScore).filter((s): s is number => s !== null);
    return { kind, label, count: mine.length, score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null };
  }).filter((k) => k.count > 0);
}
