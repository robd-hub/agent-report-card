/**
 * Runs every agent's test tasks, checks each answer with SERV Reasoning,
 * sends it to Reppo for human evaluation, and saves a grading run.
 *
 *   npm run grade                 # grade every agent
 *   npm run grade -- serv-baseline  # grade one agent
 *   npm run grade -- --refresh    # move the Reppo queue along once and stop
 *   npm run grade -- --watch      # keep moving the Reppo queue until every grade is final
 *
 * Reppo allows one pending evaluation per account and each takes at least
 * 10 minutes to settle, so answers are queued and sent to Reppo one at a time.
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
    const reppo: TaskResult["reppo"] = reppoConfigured() ? { status: "queued" } : { status: "unconfigured" };
    console.log(`  ${task.id}: SERV ${serv ? serv.score : "skipped"}, Reppo ${reppo.status}`);
    tasks.push({ taskId: task.id, output, serv, reppo });
  }
  const report = loadReport(agent.id);
  report.runs.push(await buildRun(agent, tasks));
  saveReport(report);
}

/**
 * Moves the Reppo queue along: checks the one pending evaluation, and if
 * none is pending, submits the next queued answer. Returns how many answers
 * are still waiting on Reppo across all agents.
 */
async function stepReppoQueue(agents: AgentConfig[]): Promise<number> {
  const reports = agents.map((a) => ({ agent: a, report: loadReport(a.id) }));
  const open = reports.flatMap(({ agent, report }) => {
    const run = report.runs.at(-1);
    if (!run) return [];
    return run.tasks.map((t) => ({ agent, report, run, t }));
  });

  let busy = false;
  for (const item of open.filter((o) => o.t.reppo.status === "pending")) {
    const before = item.t.reppo;
    item.t.reppo = await fetchEvaluation((before as { evalId: string }).evalId);
    if (item.t.reppo.status === "pending") busy = true;
    else {
      console.log(`  ${item.agent.name} / ${item.t.taskId}: Reppo ${item.t.reppo.status === "done" ? item.t.reppo.score + "/100" : item.t.reppo.status}`);
      await finish(item);
    }
  }

  if (!busy) {
    const next = open.find((o) => o.t.reppo.status === "queued");
    if (next) {
      const task = next.agent.tasks.find((x) => x.id === next.t.taskId)!;
      const outcome = await submitEvaluation({ prompt: task.prompt, criteria: task.criteria, output: next.t.output });
      if (outcome.status === "busy") console.log("  Reppo says an evaluation is already pending on this account; will retry.");
      else {
        next.t.reppo = outcome;
        console.log(`  Sent ${next.agent.name} / ${next.t.taskId} to Reppo: ${outcome.status}${outcome.status === "error" ? ` (${outcome.message})` : ""}`);
        saveReport(next.report);
      }
    }
  }
  return open.filter((o) => o.t.reppo.status === "queued" || o.t.reppo.status === "pending").length;
}

async function finish(item: { agent: AgentConfig; report: ReturnType<typeof loadReport>; run: GradingRun }) {
  const idx = item.report.runs.indexOf(item.run);
  item.report.runs[idx] = await buildRun(item.agent, item.run.tasks, item.run.date);
  saveReport(item.report);
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
  const watch = args.includes("--watch");
  const only = args.filter((a) => !a.startsWith("--"));
  const agents = loadAgents().filter((a) => only.length === 0 || only.includes(a.id));
  if (!servConfigured()) console.log("Note: SERV_API_KEY is not set, so agents on SERV can't run and SERV checks are skipped.");
  if (!reppoConfigured()) console.log("Note: Reppo isn't configured, so grades stay provisional.");
  if (!refresh && !watch) for (const agent of agents) await gradeAgent(agent);
  if (!reppoConfigured()) return;
  // Reppo's one-pending-evaluation limit is per account, so the queue always
  // covers every agent, even when only one agent was graded this time.
  const allAgents = loadAgents();
  let waiting = await stepReppoQueue(allAgents);
  console.log(`${waiting} answer(s) still waiting on Reppo.`);
  while (watch && waiting > 0) {
    await new Promise((r) => setTimeout(r, 60_000));
    waiting = await stepReppoQueue(allAgents);
    console.log(`${new Date().toISOString()}: ${waiting} answer(s) still waiting on Reppo.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
