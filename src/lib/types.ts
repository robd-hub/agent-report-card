/** An agent we grade. */
export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  /** Where the agent lives, used to pick the adapter that calls it. */
  adapter: "openserv-marketplace" | "openai-compatible" | "http-json" | "virtuals-acp";
  /** OpenServ marketplace id, for adapter "openserv-marketplace". */
  marketplaceId?: number;
  /**
   * Endpoint (and model, for "openai-compatible"). "http-json" agents take
   * POST {"prompt": "..."} and reply with JSON or plain text.
   */
  endpoint?: string;
  model?: string;
  /**
   * For adapter "virtuals-acp": the agent's wallet on Virtuals, and the
   * offering we hire it through (each task is one paid job).
   */
  acpWallet?: string;
  acpOffering?: string;
  /** Test tasks the agent is given on every run. */
  tasks: TestTask[];
  /**
   * Set for an agent made by the same people who run Agent Report Card, so
   * its report card says so plainly. Holds a short note shown on the page.
   */
  selfGraded?: string;
  /**
   * Leaderboard group: research, writing, crypto, code-data or assistants
   * (see src/lib/categories.ts). Guessed from the description when missing.
   */
  category?: string;
  /** "weekly" for agents regraded on a schedule by .github/workflows/weekly-grade.yml. */
  schedule?: "weekly";
  /**
   * The agent's own Concordium Agent Registry badge (base58 CIS-2 token
   * address), when it has one. Its grade is written on-chain against it.
   */
  concordiumBadge?: string;
}

export interface TestTask {
  id: string;
  prompt: string;
  /** What a good answer looks like. Shown to SERV and to Reppo reviewers. */
  criteria: string;
  /**
   * What the task tests (see src/lib/taskKinds.ts). Tasks without one count
   * as "core", except the standard honesty tasks.
   */
  kind?: TaskKind;
  /**
   * Short phrases or numbers, any of which shows the answer has been given
   * (for example ["$92.40", "2 packs"]). Used by the answer-first check in
   * src/lib/shape.ts. Left out when a task has no single checkable answer.
   */
  answerKeys?: string[];
  /** The most words a complete, good answer needs. Used for the length score. */
  wordBudget?: number;
}

export type TaskKind = "core" | "format" | "unclear" | "scope" | "honesty";

/** SERV Reasoning's automatic check of one answer. */
export interface ServCheck {
  score: number; // 0-100
  summary: string;
}

/** Reppo's human evaluation of one answer. */
export type ReppoResult =
  | { status: "unconfigured" }
  /** Waiting its turn: Reppo allows one pending evaluation per account. */
  | { status: "queued" }
  | { status: "pending"; evalId: string }
  | { status: "done"; evalId: string; score: number; critiques: string[]; decision?: string; confidence?: string }
  | { status: "error"; message: string };

export interface TaskResult {
  taskId: string;
  /**
   * The exact prompt and criteria this answer was given and judged against,
   * saved with the answer so a later re-score grades the question the agent
   * actually saw, even if the task's wording has since been edited. Runs from
   * before this was added were filled in from git history (scripts/backfill-prompts.ts).
   */
  prompt?: string;
  criteria?: string;
  /** The task's kind when it was run, so the breakdown survives later edits to the task list. */
  kind?: TaskKind;
  /** The task's answer key and length budget when it was run (see TestTask). */
  answerKeys?: string[];
  wordBudget?: number;
  output: string;
  serv: ServCheck | null;
  reppo: ReppoResult;
  /** Set once an answer has been resent to Reppo after an error, so it's only retried once. */
  reppoRetried?: boolean;
  /**
   * Extra facts the agent reported about its own answer, when its reply
   * includes them (Cheap First says which model answered and what it cost).
   */
  meta?: { answeredBy?: string; model?: string; costUsd?: number };
}

export interface GradingRun {
  date: string; // ISO timestamp
  tasks: TaskResult[];
  score: number | null; // 0-100, null if nothing could be scored
  grade: Grade | null;
  /** True until every task has a finished Reppo evaluation. */
  provisional: boolean;
  summary: string;
}

/** The prompt and criteria an answer was judged on: its own saved copy, else the task's current wording. */
export function taskWording(t: TaskResult, agent: AgentConfig): { prompt: string; criteria: string } | null {
  if (t.prompt !== undefined) return { prompt: t.prompt, criteria: t.criteria ?? "" };
  const task = agent.tasks.find((x) => x.id === t.taskId);
  return task ? { prompt: task.prompt, criteria: task.criteria } : null;
}

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface AgentReport {
  agentId: string;
  runs: GradingRun[]; // oldest first
}
