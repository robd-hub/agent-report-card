/** An agent we grade. */
export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  /** Where the agent lives, used to pick the adapter that calls it. */
  adapter: "openserv-marketplace" | "openai-compatible";
  /** OpenServ marketplace id, for adapter "openserv-marketplace". */
  marketplaceId?: number;
  /** Endpoint and model, for adapter "openai-compatible". */
  endpoint?: string;
  model?: string;
  /** Test tasks the agent is given on every run. */
  tasks: TestTask[];
}

export interface TestTask {
  id: string;
  prompt: string;
  /** What a good answer looks like. Shown to SERV and to Reppo reviewers. */
  criteria: string;
}

/** SERV Reasoning's automatic check of one answer. */
export interface ServCheck {
  score: number; // 0-100
  summary: string;
}

/** Reppo's human evaluation of one answer. */
export type ReppoResult =
  | { status: "unconfigured" }
  | { status: "pending"; evalId: string }
  | { status: "done"; evalId: string; score: number; critiques: string[] }
  | { status: "error"; message: string };

export interface TaskResult {
  taskId: string;
  output: string;
  serv: ServCheck | null;
  reppo: ReppoResult;
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

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface AgentReport {
  agentId: string;
  runs: GradingRun[]; // oldest first
}
