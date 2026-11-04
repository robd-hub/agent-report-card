/**
 * Runs every agent's test tasks, checks each answer with SERV Reasoning,
 * sends it to Reppo for human evaluation, and saves a grading run.
 *
 *   npm run grade                 # grade every agent
 *   npm run grade -- serv-baseline  # grade one agent
 *   npm run grade -- --refresh    # only re-check pending Reppo evaluations
 */
import { runAgent } from "../src/lib/adapters";
import { isProvisional, letterGrade, runScore } from "../src/lib/grade";
import { loadAgents, loadReport, saveReport } from "../src/lib/data";
import { fetchEvaluation, reppoConfigured, submitEvaluation } from "../src/lib/reppo";
import { servCheck, servChat, servConfigured } from "../src/lib/serv";
import type { AgentConfig, GradingRun, TaskResult } from "../src/lib/types";

async function gradeAgent(agent: AgentConfig): Promise<void> {
  console.log(`\nGrading ${agent.name}`);
  const tasks: TaskResult[] = [];
  for (const task of agent.tasks) {
    let output: string;
    try {
      output = await runAgent(agent, task.prompt);
    } catch (e) {
      console.log(`  ${task.id}: could not run (${(e as Error).message})`);
      return;
    }
    const serv = servConfigured() ? await servCheck(task.prompt, task.criteria, output) : null;
    const reppo = await submitEvaluation({ prompt: task.prompt, criteria: task.criteria, output });
    console.log(`  ${task.id}: SERV ${serv ? serv.score : "skipped"}, Reppo ${reppo.status}`);
    tasks.push({ taskId: task.id, output, serv, reppo });
  }
  const report = loadReport(agent.id);
  report.runs.push(await buildRun(agent, tasks));
  saveReport(report);
}

async function refreshAgent(agent: AgentConfig): Promise<void> {
  const report = loadReport(agent.id);
  const run = report.runs.at(-1);
  if (!run || !run.provisional) return;
  for (const t of run.tasks) {
    if (t.reppo.status === "pending") t.reppo = await fetchEvaluation(t.reppo.evalId);
  }
  report.runs[report.runs.length - 1] = await buildRun(agent, run.tasks, run.date);
  saveReport(report);
  console.log(`${agent.name}: ${report.runs.at(-1)!.provisional ? "still waiting on Reppo" : "all evaluations in"}`);
}

async function buildRun(agent: AgentConfig, tasks: TaskResult[], date = new Date().toISOString()): Promise<GradingRun> {
  const score = runScore(tasks);
  return {
    date,
    tasks,
    score,
    grade: score === null ? null : letterGrade(score),
    provisional: isProvisional(tasks),
    summary: await writeSummary(agent, tasks),
  };
}

async function writeSummary(agent: AgentConfig, tasks: TaskResult[]): Promise<string> {
  if (!servConfigured()) return "";
  const notes = tasks
    .map((t) => {
      const critiques = t.reppo.status === "done" ? t.reppo.critiques.join("; ") : "none yet";
      return `Task ${t.taskId}: automatic check: ${t.serv?.summary ?? "n/a"}. Human critiques: ${critiques}.`;
    })
    .join("\n");
  return servChat(
    "You write short, plain-English report cards for AI agents. Two to three sentences: one strength, the biggest weakness, and what would most improve the grade.",
    `Agent: ${agent.name}\n${notes}`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const refresh = args.includes("--refresh");
  const only = args.filter((a) => !a.startsWith("--"));
  const agents = loadAgents().filter((a) => only.length === 0 || only.includes(a.id));
  if (!servConfigured()) console.log("Note: SERV_API_KEY is not set, so agents on SERV can't run and SERV checks are skipped.");
  if (!reppoConfigured()) console.log("Note: Reppo isn't configured, so grades stay provisional.");
  for (const agent of agents) await (refresh ? refreshAgent(agent) : gradeAgent(agent));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
